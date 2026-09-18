/**
 * Thin HubSpot CRM Search API wrapper. Token is read from Script Properties -
 * never hardcode it here (see README for setup steps).
 */
function getHubSpotToken() {
  var token = PropertiesService.getScriptProperties().getProperty('HUBSPOT_TOKEN');
  if (!token) {
    throw new Error('HUBSPOT_TOKEN is not set. Go to Project Settings > Script Properties and add it.');
  }
  return token;
}

/**
 * Runs a HubSpot CRM Search API query, paginating through all results.
 * https://developers.hubspot.com/docs/api/crm/search
 */
function hubspotSearch(objectType, filterGroups, properties, maxRecords) {
  maxRecords = maxRecords || 10000;
  var token = getHubSpotToken();
  var url = HUBSPOT_BASE_URL + '/crm/v3/objects/' + objectType + '/search';
  var results = [];
  var after = null;

  do {
    var payload = {
      filterGroups: filterGroups,
      properties: properties,
      limit: 100
    };
    if (after) payload.after = after;

    var response = fetchWithRetry(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + token },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });

    var code = response.getResponseCode();
    if (code >= 300) {
      throw new Error('HubSpot API error (' + code + ') on ' + objectType + ': ' + response.getContentText());
    }

    var json = JSON.parse(response.getContentText());
    results = results.concat(json.results || []);
    after = json.paging && json.paging.next ? json.paging.next.after : null;
  } while (after && results.length < maxRecords);

  return results;
}

/**
 * UrlFetchApp.fetch with retry + exponential backoff on HubSpot's 429 rate-limit response.
 * HubSpot enforces a short per-second call limit, which multiple dashboard tabs/searches
 * can hit if they fire at nearly the same moment - this makes those transient errors
 * self-heal instead of surfacing to the user.
 */
function fetchWithRetry(url, options, maxRetries) {
  maxRetries = maxRetries || 5;
  var attempt = 0;
  while (true) {
    var response = UrlFetchApp.fetch(url, options);
    if (response.getResponseCode() !== 429 || attempt >= maxRetries) {
      return response;
    }
    attempt++;
    Utilities.sleep(500 * Math.pow(2, attempt)); // 1s, 2s, 4s, 8s, 16s
  }
}

/**
 * Fetches this HubSpot portal's Hub ID, needed to build "open in HubSpot" links
 * (https://app.hubspot.com/contacts/<portalId>/company/<id>). Cached for the script's
 * lifetime since it never changes. Returns null (rather than throwing) if the token
 * lacks the scope for this endpoint - drill-down lists still work, just without links.
 */
function getHubSpotPortalId() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('HUBSPOT_PORTAL_ID');
  if (cached) return cached;

  try {
    var response = fetchWithRetry(HUBSPOT_BASE_URL + '/account-info/v3/details', {
      method: 'get',
      headers: { Authorization: 'Bearer ' + getHubSpotToken() },
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) return null;
    var portalId = String(JSON.parse(response.getContentText()).portalId);
    cache.put('HUBSPOT_PORTAL_ID', portalId, 21600); // 6 hours
    return portalId;
  } catch (e) {
    return null;
  }
}

/**
 * Looks up a HubSpot user/owner by email (used by the Inputs tab's "add SDR" form, so the
 * manager only needs to know the person's email rather than their internal owner ID).
 */
function getHubSpotOwnerByEmail(email) {
  var url = HUBSPOT_BASE_URL + '/crm/v3/owners?email=' + encodeURIComponent(email);
  var response = fetchWithRetry(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + getHubSpotToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() >= 300) {
    throw new Error('HubSpot API error (' + response.getResponseCode() + ') looking up owner: ' + response.getContentText());
  }
  var results = JSON.parse(response.getContentText()).results || [];
  if (!results.length) throw new Error('No HubSpot user found with email ' + email + '.');
  var owner = results[0];
  return { ownerId: String(owner.id), name: (owner.firstName + ' ' + owner.lastName).trim() };
}

/**
 * Batch-resolves the first associated object id for each `fromObjectType` record, using the
 * CRM v3 batch/read endpoint's built-in `associations` parameter (chunked to HubSpot's
 * 100-per-request batch limit). Used to find which contact each call/email engagement
 * belongs to. This reuses the same well-established v3 batch/read endpoint as
 * batchGetObjects() rather than the separate v4 associations API, whose exact response
 * field naming turned out to be unreliable in testing.
 * Returns a map of { [fromId]: toId }. Records with no association are omitted.
 */
function batchGetFirstAssociation(fromObjectType, toObjectType, fromIds) {
  var map = {};
  var chunkSize = 100;
  for (var i = 0; i < fromIds.length; i += chunkSize) {
    var chunk = fromIds.slice(i, i + chunkSize);
    var url = HUBSPOT_BASE_URL + '/crm/v3/objects/' + fromObjectType + '/batch/read';
    var response = fetchWithRetry(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + getHubSpotToken() },
      payload: JSON.stringify({
        properties: [],
        inputs: chunk.map(function (id) { return { id: String(id) }; }),
        associations: [toObjectType]
      }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) {
      throw new Error('HubSpot API error (' + response.getResponseCode() + ') on batch read+associations ' + fromObjectType + '->' + toObjectType + ': ' + response.getContentText());
    }
    var json = JSON.parse(response.getContentText());
    (json.results || []).forEach(function (r) {
      var assoc = r.associations && r.associations[toObjectType];
      var results = assoc && assoc.results;
      if (results && results.length) map[r.id] = results[0].id;
    });
  }
  return map;
}

/**
 * Shared query shape used by Summary, MOFU, and SDR Performance: deals in Sales Pipeline,
 * owned by one of `ownerIds`, whose `dateProp` falls within [start, end], plus any
 * additional filters (e.g. a dealstage IN[...] restriction).
 */
function searchDealsInWindow(dateProp, start, end, ownerIds, extraFilters, properties) {
  var filters = [
    eqFilter('pipeline', PIPELINE_ID),
    dateFilter(dateProp, start, end),
    inFilter(DEAL_SDR_OWNER_PROP, ownerIds)
  ].concat(extraFilters || []);
  return hubspotSearch('deals', [{ filters: filters }], properties);
}

/**
 * Batch-fetches full records (with the given properties) for a list of object ids,
 * chunked to HubSpot's 100-per-request batch limit. Returns a map of { [id]: record }.
 */
function batchGetObjects(objectType, ids, properties) {
  var result = {};
  var chunkSize = 100;
  for (var i = 0; i < ids.length; i += chunkSize) {
    var chunk = ids.slice(i, i + chunkSize);
    var url = HUBSPOT_BASE_URL + '/crm/v3/objects/' + objectType + '/batch/read';
    var response = fetchWithRetry(url, {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + getHubSpotToken() },
      payload: JSON.stringify({ properties: properties, inputs: chunk.map(function (id) { return { id: String(id) }; }) }),
      muteHttpExceptions: true
    });
    if (response.getResponseCode() >= 300) {
      throw new Error('HubSpot API error (' + response.getResponseCode() + ') on batch read ' + objectType + ': ' + response.getContentText());
    }
    var json = JSON.parse(response.getContentText());
    (json.results || []).forEach(function (r) { result[r.id] = r; });
  }
  return result;
}

/**
 * Full HubSpot owner directory (ownerId -> display name), used to resolve generic "Deal
 * owner"/"Company owner" columns in drill-down tables (which may be an AE or anyone else,
 * not just our tracked SDRs). Cached for a few hours since it changes rarely. Best-effort:
 * returns {} rather than throwing if the token lacks access, so a drill-down column just
 * falls back to showing the raw owner id instead of breaking the whole payload.
 */
function getAllHubSpotOwnersMap() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get('HUBSPOT_OWNERS_MAP');
  if (cached) return JSON.parse(cached);

  var map = {};
  try {
    var after = null;
    do {
      var url = HUBSPOT_BASE_URL + '/crm/v3/owners?limit=100' + (after ? '&after=' + after : '');
      var response = fetchWithRetry(url, {
        method: 'get',
        headers: { Authorization: 'Bearer ' + getHubSpotToken() },
        muteHttpExceptions: true
      });
      if (response.getResponseCode() >= 300) break;
      var json = JSON.parse(response.getContentText());
      (json.results || []).forEach(function (o) {
        map[String(o.id)] = ((o.firstName || '') + ' ' + (o.lastName || '')).trim() || o.email || String(o.id);
      });
      after = json.paging && json.paging.next ? json.paging.next.after : null;
    } while (after);
  } catch (e) {
    // best-effort - fall through with whatever was collected
  }

  cache.put('HUBSPOT_OWNERS_MAP', JSON.stringify(map), 21600); // 6 hours
  return map;
}

function dateFilter(propertyName, startDate, endDate) {
  return {
    propertyName: propertyName,
    operator: 'BETWEEN',
    value: String(startDate.getTime()),
    highValue: String(endDate.getTime())
  };
}

function inFilter(propertyName, values) {
  return { propertyName: propertyName, operator: 'IN', values: values };
}

function eqFilter(propertyName, value) {
  return { propertyName: propertyName, operator: 'EQ', value: value };
}
