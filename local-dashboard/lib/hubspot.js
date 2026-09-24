/**
 * Thin HubSpot CRM Search API wrapper - port of HubSpotUtil.gs to Node's built-in fetch.
 * Token is read from the HUBSPOT_TOKEN environment variable (set in .env), never hardcoded.
 *
 * Unlike Apps Script (single-threaded, one UrlFetchApp call at a time), Node can run several
 * HubSpot requests concurrently - batchGetFirstAssociation, batchGetObjects, and the per-SDR
 * engagement queries in contactActivityService.js all fire their chunks/owners in parallel via
 * Promise.all, which is the main reason this local version loads faster than the live one.
 */

const { HUBSPOT_BASE_URL, PIPELINE_ID, DEAL_SDR_OWNER_PROP } = require('./config');

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

/**
 * fetch() wrapper with retry + exponential backoff on HubSpot's 429 rate-limit response -
 * same behavior as fetchWithRetry() in HubSpotUtil.gs. Reads the body once (fetch streams
 * can't be read twice) and returns { status, json, text } so callers can use either.
 */
async function hubspotFetch(url, options, maxRetries) {
  maxRetries = maxRetries || 5;
  let attempt = 0;
  while (true) {
    const response = await fetch(url, options);
    if (response.status !== 429 || attempt >= maxRetries) {
      const text = await response.text();
      let json = null;
      try { json = text ? JSON.parse(text) : null; } catch (e) { /* leave json null */ }
      return { status: response.status, json, text };
    }
    attempt++;
    await sleep(500 * Math.pow(2, attempt)); // 1s, 2s, 4s, 8s, 16s
  }
}

function authHeaders(extra) {
  return Object.assign({ Authorization: 'Bearer ' + getHubSpotToken() }, extra || {});
}

/**
 * Runs a HubSpot CRM Search API query, paginating through all results.
 * https://developers.hubspot.com/docs/api/crm/search
 */
async function hubspotSearch(objectType, filterGroups, properties, maxRecords) {
  maxRecords = maxRecords || 10000;
  const url = HUBSPOT_BASE_URL + '/crm/v3/objects/' + objectType + '/search';
  let results = [];
  let after = null;

  do {
    const payload = { filterGroups, properties, limit: 100 };
    if (after) payload.after = after;

    const { status, json, text } = await hubspotFetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(payload)
    });

    if (status >= 300) {
      throw new Error('HubSpot API error (' + status + ') on ' + objectType + ': ' + text);
    }

    results = results.concat((json && json.results) || []);
    after = json && json.paging && json.paging.next ? json.paging.next.after : null;
  } while (after && results.length < maxRecords);

  return results;
}

// ---- tiny in-memory cache, standing in for Apps Script's CacheService (6-hour TTLs kept
// the same; resets whenever the local server restarts, same as CacheService resets per project) ----
const memoryCache = {};
function cacheGet(key) {
  const entry = memoryCache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { delete memoryCache[key]; return null; }
  return entry.value;
}
function cachePut(key, value, ttlSeconds) {
  memoryCache[key] = { value, expiresAt: Date.now() + ttlSeconds * 1000 };
}

async function getHubSpotPortalId() {
  const cached = cacheGet('HUBSPOT_PORTAL_ID');
  if (cached) return cached;
  try {
    const { status, json } = await hubspotFetch(HUBSPOT_BASE_URL + '/account-info/v3/details', {
      method: 'GET',
      headers: authHeaders()
    });
    if (status >= 300) return null;
    const portalId = String(json.portalId);
    cachePut('HUBSPOT_PORTAL_ID', portalId, 21600);
    return portalId;
  } catch (e) {
    return null;
  }
}

async function getHubSpotOwnerByEmail(email) {
  const url = HUBSPOT_BASE_URL + '/crm/v3/owners?email=' + encodeURIComponent(email);
  const { status, json, text } = await hubspotFetch(url, { method: 'GET', headers: authHeaders() });
  if (status >= 300) {
    throw new Error('HubSpot API error (' + status + ') looking up owner: ' + text);
  }
  const results = (json && json.results) || [];
  if (!results.length) throw new Error('No HubSpot user found with email ' + email + '.');
  const owner = results[0];
  return { ownerId: String(owner.id), name: (owner.firstName + ' ' + owner.lastName).trim() };
}

/**
 * Batch-resolves the first associated object id for each `fromObjectType` record, using the
 * CRM v4 associations batch/read endpoint (same one HubSpotUtil.gs uses, confirmed against
 * this portal's live data as the reliable one - see that file's comment for why). Chunks of
 * 100 run concurrently via Promise.all rather than one at a time.
 * Returns a map of { [fromId]: toId }. Records with no association are omitted.
 */
async function batchGetFirstAssociation(fromObjectType, toObjectType, fromIds) {
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < fromIds.length; i += chunkSize) chunks.push(fromIds.slice(i, i + chunkSize));

  const map = {};
  await Promise.all(chunks.map(async (chunk) => {
    const url = HUBSPOT_BASE_URL + '/crm/v4/associations/' + fromObjectType + '/' + toObjectType + '/batch/read';
    const { status, json, text } = await hubspotFetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ inputs: chunk.map((id) => ({ id: String(id) })) })
    });
    if (status >= 300) {
      throw new Error('HubSpot API error (' + status + ') on v4 associations batch read ' + fromObjectType + '->' + toObjectType + ': ' + text);
    }
    (json.results || []).forEach((r) => {
      const fromId = r.from && r.from.id;
      const toList = r.to;
      if (fromId && toList && toList.length) map[fromId] = String(toList[0].toObjectId);
    });
  }));

  return map;
}

/**
 * Shared query shape used by Summary, MOFU, and SDR Performance: deals in Sales Pipeline,
 * owned by one of `ownerIds`, whose `dateProp` falls within [start, end], plus any
 * additional filters.
 */
async function searchDealsInWindow(dateProp, start, end, ownerIds, extraFilters, properties) {
  const filters = [
    eqFilter('pipeline', PIPELINE_ID),
    dateFilter(dateProp, start, end),
    inFilter(DEAL_SDR_OWNER_PROP, ownerIds)
  ].concat(extraFilters || []);
  return hubspotSearch('deals', [{ filters }], properties);
}

/**
 * Batch-fetches full records (with the given properties) for a list of object ids, chunked
 * to HubSpot's 100-per-request batch limit, run concurrently. Returns { [id]: record }.
 */
async function batchGetObjects(objectType, ids, properties) {
  const chunkSize = 100;
  const chunks = [];
  for (let i = 0; i < ids.length; i += chunkSize) chunks.push(ids.slice(i, i + chunkSize));

  const result = {};
  await Promise.all(chunks.map(async (chunk) => {
    const url = HUBSPOT_BASE_URL + '/crm/v3/objects/' + objectType + '/batch/read';
    const { status, json, text } = await hubspotFetch(url, {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({ properties, inputs: chunk.map((id) => ({ id: String(id) })) })
    });
    if (status >= 300) {
      throw new Error('HubSpot API error (' + status + ') on batch read ' + objectType + ': ' + text);
    }
    (json.results || []).forEach((r) => { result[r.id] = r; });
  }));

  return result;
}

/**
 * Full HubSpot owner directory (ownerId -> display name). Cached for 6 hours, same as the
 * Apps Script version. Best-effort: returns {} rather than throwing on access issues.
 */
async function getAllHubSpotOwnersMap() {
  const cached = cacheGet('HUBSPOT_OWNERS_MAP');
  if (cached) return cached;

  const map = {};
  try {
    let after = null;
    do {
      const url = HUBSPOT_BASE_URL + '/crm/v3/owners?limit=100' + (after ? '&after=' + after : '');
      const { status, json } = await hubspotFetch(url, { method: 'GET', headers: authHeaders() });
      if (status >= 300) break;
      (json.results || []).forEach((o) => {
        map[String(o.id)] = ((o.firstName || '') + ' ' + (o.lastName || '')).trim() || o.email || String(o.id);
      });
      after = json.paging && json.paging.next ? json.paging.next.after : null;
    } while (after);
  } catch (e) {
    // best-effort - fall through with whatever was collected
  }

  cachePut('HUBSPOT_OWNERS_MAP', map, 21600);
  return map;
}

function dateFilter(propertyName, startDate, endDate) {
  return {
    propertyName,
    operator: 'BETWEEN',
    value: String(startDate.getTime()),
    highValue: String(endDate.getTime())
  };
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
  getHubSpotPortalId,
  getHubSpotOwnerByEmail,
  batchGetFirstAssociation,
  searchDealsInWindow,
  batchGetObjects,
  getAllHubSpotOwnersMap,
  dateFilter,
  inFilter,
  eqFilter,
  neqFilter
};
