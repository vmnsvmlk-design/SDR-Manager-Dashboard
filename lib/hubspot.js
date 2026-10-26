/**
 * Thin HubSpot CRM API wrapper on Node's built-in fetch.
 * Token is read from the HUBSPOT_TOKEN environment variable (set in .env), never hardcoded.
 *
 * Requests run concurrently, but through a small limiter so a page load doesn't fire hundreds
 * of requests at once and trip HubSpot's rate limits (Search API: ~5 requests/second).
 * 429 responses are still retried with exponential backoff as a safety net.
 */

const { HUBSPOT_BASE_URL, PIPELINE_ID, DEAL_SDR_OWNER_PROP } = require('./config');

// HubSpot's Search API refuses to page past 10,000 results for any single query.
const SEARCH_RESULT_CAP = 10000;

function getHubSpotToken() {
  const token = process.env.HUBSPOT_TOKEN;
  if (!token) {
    throw new Error('HUBSPOT_TOKEN is not set. Copy .env.example to .env and paste your HubSpot private app token in.');
  }
  return token;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Minimal concurrency limiter: at most `max` tasks in flight per lane.
function createLimiter(max) {
  let active = 0;
  const queue = [];
  function next() {
    if (active >= max || !queue.length) return;
    active++;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => { active--; next(); });
  }
  return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); next(); });
}
const searchLimiter = createLimiter(4);
const otherLimiter = createLimiter(8);

/**
 * fetch() wrapper with retry + exponential backoff on HubSpot's 429 rate-limit response.
 * Reads the body once and returns { status, json, text } so callers can use either.
 */
async function hubspotFetch(url, options, maxRetries) {
  maxRetries = maxRetries || 6;
  const limiter = url.indexOf('/search') !== -1 ? searchLimiter : otherLimiter;
  let attempt = 0;
  while (true) {
    const response = await limiter(() => fetch(url, options));
    if (response.status !== 429 || attempt >= maxRetries) {
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* leave json null */ }
      return { status: response.status, json, text };
    }
    attempt++;
    await sleep(500 * Math.pow(2, attempt)); // 1s, 2s, 4s, ...
  }
}

function authHeaders(extra) {
  return Object.assign({ Authorization: 'Bearer ' + getHubSpotToken() }, extra || {});
}

async function searchPage(objectType, filterGroups, properties, after) {
  const payload = { filterGroups, properties, limit: 100 };
  if (after) payload.after = after;
  const { status, json, text } = await hubspotFetch(HUBSPOT_BASE_URL + '/crm/v3/objects/' + objectType + '/search', {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(payload)
  });
  if (status >= 300) {
    throw new Error('HubSpot API error (' + status + ') on ' + objectType + ': ' + text);
  }
  return {
    results: (json && json.results) || [],
    total: (json && json.total) || 0,
    after: json && json.paging && json.paging.next ? json.paging.next.after : null
  };
}

/**
 * Runs a HubSpot CRM Search API query, paginating through all results (up to HubSpot's cap).
 * https://developers.hubspot.com/docs/api/crm/search
 */
async function hubspotSearch(objectType, filterGroups, properties) {
  let results = [];
  let after = null;
  do {
    const page = await searchPage(objectType, filterGroups, properties, after);
    results = results.concat(page.results);
    after = page.after;
  } while (after && results.length < SEARCH_RESULT_CAP);
  return results;
}

/**
 * Like hubspotSearch, for records whose `dateProp` falls in [start, end] - but if the window
 * holds more than HubSpot's 10,000-result cap, it is split in half (recursively) so nothing is
 * silently dropped. `filters` must not include the date filter itself.
 */
async function searchInWindow(objectType, filters, dateProp, start, end, properties) {
  const filterGroups = [{ filters: filters.concat([dateFilter(dateProp, start, end)]) }];
  const first = await searchPage(objectType, filterGroups, properties, null);
  const spanMs = end.getTime() - start.getTime();

  if (first.total > SEARCH_RESULT_CAP && spanMs > 60 * 60 * 1000) {
    const mid = new Date(start.getTime() + Math.floor(spanMs / 2));
    const [a, b] = await Promise.all([
      searchInWindow(objectType, filters, dateProp, start, mid, properties),
      searchInWindow(objectType, filters, dateProp, new Date(mid.getTime() + 1), end, properties)
    ]);
    return a.concat(b);
  }

  let results = first.results;
  let after = first.after;
  while (after && results.length < SEARCH_RESULT_CAP) {
    const page = await searchPage(objectType, filterGroups, properties, after);
    results = results.concat(page.results);
    after = page.after;
  }
  return results;
}

/**
 * Deals in the Sales pipeline, with SDR Owner (Deal) in `ownerIds`, whose `dateProp` falls
 * within [start, end], plus any additional filters.
 */
function searchDealsInWindow(dateProp, start, end, ownerIds, extraFilters, properties) {
  const filters = [eqFilter('pipeline', PIPELINE_ID), inFilter(DEAL_SDR_OWNER_PROP, ownerIds)].concat(extraFilters || []);
  return searchInWindow('deals', filters, dateProp, start, end, properties);
}

function chunk(list, size) {
  const chunks = [];
  for (let i = 0; i < list.length; i += size) chunks.push(list.slice(i, i + size));
  return chunks;
}

/**
 * Batch-resolves ALL associated object ids for each `fromObjectType` record, using the CRM v4
 * associations batch/read endpoint (the batch/read `associations` parameter silently returns
 * nothing on this portal; this dedicated endpoint works).
 * Returns { [fromId]: [toId, ...] }. Records with no association are omitted.
 */
async function batchGetAssociations(fromObjectType, toObjectType, fromIds) {
  const map = {};
  await Promise.all(chunk(fromIds, 100).map(async (ids) => {
    const url = HUBSPOT_BASE_URL + '/crm/v4/associations/' + fromObjectType + '/' + toObjectType + '/batch/read';
    const { status, json, text } = await hubspotFetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ inputs: ids.map((id) => ({ id: String(id) })) })
    });
    // 207 Multi-Status = some inputs had no associations; the rest are still in `results`.
    if (status >= 300 && status !== 207) {
      throw new Error('HubSpot API error (' + status + ') on v4 associations batch read ' + fromObjectType + '->' + toObjectType + ': ' + text);
    }
    ((json && json.results) || []).forEach((r) => {
      const fromId = r.from && r.from.id;
      if (fromId && r.to && r.to.length) map[fromId] = r.to.map((t) => String(t.toObjectId));
    });
  }));
  return map;
}

/**
 * Batch-fetches records (with the given properties) for a list of ids, chunked to HubSpot's
 * 100-per-request limit. Returns { [id]: record }.
 */
async function batchGetObjects(objectType, ids, properties) {
  const result = {};
  await Promise.all(chunk(ids, 100).map(async (part) => {
    const url = HUBSPOT_BASE_URL + '/crm/v3/objects/' + objectType + '/batch/read';
    const { status, json, text } = await hubspotFetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ properties, inputs: part.map((id) => ({ id: String(id) })) })
    });
    if (status >= 300 && status !== 207) {
      throw new Error('HubSpot API error (' + status + ') on batch read ' + objectType + ': ' + text);
    }
    ((json && json.results) || []).forEach((r) => { result[r.id] = r; });
  }));
  return result;
}

// ---- in-memory cache. Values are promises, so concurrent requests for the same key share one
// HubSpot fetch; failed fetches are evicted so the next request retries. ----
const memoryCache = {};
function cached(key, ttlSeconds, producer, forceRefresh) {
  const entry = memoryCache[key];
  if (!forceRefresh && entry && Date.now() < entry.expiresAt) return entry.promise;
  const promise = Promise.resolve().then(producer);
  memoryCache[key] = { promise, expiresAt: Date.now() + ttlSeconds * 1000 };
  promise.catch(() => { if (memoryCache[key] && memoryCache[key].promise === promise) delete memoryCache[key]; });
  return promise;
}

function getHubSpotPortalId() {
  return cached('HUBSPOT_PORTAL_ID', 21600, async () => {
    const { status, json } = await hubspotFetch(HUBSPOT_BASE_URL + '/account-info/v3/details', { method: 'GET', headers: authHeaders() });
    return status >= 300 || !json ? null : String(json.portalId);
  }).catch(() => null);
}

/**
 * Full HubSpot owner directory (ownerId -> display name), including deactivated owners.
 * Best-effort: returns {} rather than throwing on access issues.
 */
function getAllHubSpotOwnersMap() {
  return cached('HUBSPOT_OWNERS_MAP', 21600, async () => {
    const map = {};
    for (const archived of [false, true]) {
      let after = null;
      do {
        const url = HUBSPOT_BASE_URL + '/crm/v3/owners?limit=100&archived=' + archived + (after ? '&after=' + after : '');
        const { status, json } = await hubspotFetch(url, { method: 'GET', headers: authHeaders() });
        if (status >= 300 || !json) break;
        (json.results || []).forEach((o) => {
          map[String(o.id)] = ((o.firstName || '') + ' ' + (o.lastName || '')).trim() || o.email || String(o.id);
        });
        after = json.paging && json.paging.next ? json.paging.next.after : null;
      } while (after);
    }
    return map;
  }).catch(() => ({}));
}

/** { [optionValue]: optionLabel } for an enumeration property. Best-effort: {} on failure. */
function getPropertyOptionLabels(objectType, propertyName) {
  return cached('PROPERTY_OPTIONS:' + objectType + ':' + propertyName, 21600, async () => {
    const url = HUBSPOT_BASE_URL + '/crm/v3/properties/' + objectType + '/' + propertyName;
    const { status, json } = await hubspotFetch(url, { method: 'GET', headers: authHeaders() });
    const labels = {};
    if (status < 300 && json && json.options) json.options.forEach((o) => { labels[o.value] = o.label; });
    return labels;
  }).catch(() => ({}));
}

function dateFilter(propertyName, startDate, endDate) {
  return { propertyName, operator: 'BETWEEN', value: String(startDate.getTime()), highValue: String(endDate.getTime()) };
}

function inFilter(propertyName, values) {
  return { propertyName, operator: 'IN', values };
}

function eqFilter(propertyName, value) {
  return { propertyName, operator: 'EQ', value };
}

function neqFilter(propertyName, value) {
  return { propertyName, operator: 'NEQ', value };
}

module.exports = {
  getHubSpotToken,
  hubspotSearch,
  searchInWindow,
  searchDealsInWindow,
  batchGetAssociations,
  batchGetObjects,
  cached,
  getHubSpotPortalId,
  getAllHubSpotOwnersMap,
  getPropertyOptionLabels,
  dateFilter,
  inFilter,
  eqFilter,
  neqFilter
};
