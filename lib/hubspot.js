/**
 * Thin HubSpot CRM API wrapper on Node's built-in fetch.
 * Token is read from the HUBSPOT_TOKEN environment variable (set in .env), never hardcoded.
 *
 * Every request goes through a rate limiter that spaces out request starts to stay under
 * HubSpot's limits (Search API: 5 requests/second per account; other CRM APIs: ~100-190
 * requests per 10 seconds). 429 responses are retried after the delay HubSpot asks for.
 */

const { HUBSPOT_BASE_URL, PIPELINE_ID, DEAL_SDR_OWNER_PROP } = require('./config');

// HubSpot's Search API refuses to page past 10,000 results for any single query.
const SEARCH_RESULT_CAP = 10000;
// Largest page HubSpot's Search API returns.
const SEARCH_PAGE_SIZE = 200;

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

// Rate limiter: request starts are spaced at least 1000/perSecond ms apart, with at most
// `maxConcurrent` in flight. Tasks run in the order they were queued.
function createRateLimiter(perSecond, maxConcurrent) {
  const gapMs = 1000 / perSecond;
  let active = 0;
  let nextStartAt = 0;
  let timer = null;
  const queue = [];
  function pump() {
    if (timer || !queue.length || active >= maxConcurrent) return;
    const wait = nextStartAt - Date.now();
    if (wait > 0) { timer = setTimeout(() => { timer = null; pump(); }, wait); return; }
    nextStartAt = Date.now() + gapMs;
    active++;
    const { task, resolve, reject } = queue.shift();
    task().then(resolve, reject).finally(() => { active--; pump(); });
    pump();
  }
  return (task) => new Promise((resolve, reject) => { queue.push({ task, resolve, reject }); pump(); });
}
const searchLimiter = createRateLimiter(4, 4);
const otherLimiter = createRateLimiter(9, 6);

/**
 * fetch() wrapper: rate limited, and retries HubSpot's 429 rate-limit response after the
 * Retry-After delay (or an exponential backoff). Reads the body once and returns
 * { status, json, text } so callers can use either.
 */
async function hubspotFetch(url, options, maxRetries) {
  maxRetries = maxRetries || 8;
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
    const retryAfter = Number(response.headers && response.headers.get ? response.headers.get('retry-after') : NaN);
    const backoff = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 1s, 2s, 4s, 8s, 10s...
    await sleep((retryAfter > 0 ? retryAfter * 1000 : backoff) + Math.random() * 500);
  }
}

function authHeaders(extra) {
  return Object.assign({ Authorization: 'Bearer ' + getHubSpotToken() }, extra || {});
}

async function searchPage(objectType, filterGroups, properties, after) {
  const payload = { filterGroups, properties, limit: SEARCH_PAGE_SIZE };
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
 *
 * Results are remembered for the life of the process: an email/call/message's contacts don't
 * change, so each engagement is only ever looked up once.
 */
const associationMemo = {};
async function batchGetAssociations(fromObjectType, toObjectType, fromIds) {
  const memoKey = fromObjectType + '->' + toObjectType;
  const memo = associationMemo[memoKey] = associationMemo[memoKey] || new Map();
  const missing = fromIds.map(String).filter((id) => !memo.has(id));

  async function readChunk(ids) {
    const url = HUBSPOT_BASE_URL + '/crm/v4/associations/' + fromObjectType + '/' + toObjectType + '/batch/read';
    const { status, json, text } = await hubspotFetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ inputs: ids.map((id) => ({ id })) })
    });
    // Too many inputs for this portal's limit: fall back to HubSpot's documented 100 per request.
    if (status === 400 && ids.length > 100) {
      await Promise.all(chunk(ids, 100).map(readChunk));
      return;
    }
    // 207 Multi-Status = some inputs had no associations; the rest are still in `results`.
    if (status >= 300 && status !== 207) {
      throw new Error('HubSpot API error (' + status + ') on v4 associations batch read ' + fromObjectType + '->' + toObjectType + ': ' + text);
    }
    ids.forEach((id) => memo.set(id, []));
    ((json && json.results) || []).forEach((r) => {
      const fromId = r.from && String(r.from.id);
      if (fromId && r.to) memo.set(fromId, r.to.map((t) => String(t.toObjectId)));
    });
  }
  await Promise.all(chunk(missing, 1000).map(readChunk));

  const map = {};
  fromIds.forEach((id) => {
    const to = memo.get(String(id));
    if (to && to.length) map[id] = to;
  });
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

// ---- in-memory cache (stale-while-revalidate) ----
// mode 'normal':     fresh value if there is one; if it has expired, the last good value is
//                    returned immediately while a refresh runs in the background.
// mode 'force':      always fetch anew and wait for it (the UI's Refresh button).
// mode 'background': fetch anew and return that promise, but keep serving the last good value
//                    to everyone else until it lands (used by the server's warm-up loop).
// Concurrent callers share one in-flight fetch. A failed refresh keeps the last good value.
const memoryCache = {};
function cached(key, ttlSeconds, producer, mode) {
  if (mode === true) mode = 'force';
  mode = mode || 'normal';
  const entry = memoryCache[key] = memoryCache[key] || { hasValue: false, value: undefined, expiresAt: 0, inflight: null };

  function refresh() {
    if (entry.inflight) return entry.inflight;
    const p = Promise.resolve().then(producer).then((value) => {
      entry.value = value;
      entry.hasValue = true;
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
      return value;
    }).finally(() => { if (entry.inflight === p) entry.inflight = null; });
    entry.inflight = p;
    p.catch((err) => { if (entry.hasValue) console.error('Refresh of ' + key + ' failed, keeping last good data:', err.message); });
    return p;
  }

  if (mode === 'force' || mode === 'background') return refresh();
  if (entry.hasValue) {
    if (Date.now() >= entry.expiresAt) refresh().catch(() => {});
    return Promise.resolve(entry.value);
  }
  return refresh();
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
