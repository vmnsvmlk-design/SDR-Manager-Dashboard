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

    var response = UrlFetchApp.fetch(url, {
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
