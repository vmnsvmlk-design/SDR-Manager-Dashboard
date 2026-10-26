/**
 * Shared record helpers: deal drill-down rows, the Junk Lead exclusion, and the
 * "TAGS- SDR Categories" classification used by the Rep Overview and Actionables tabs.
 */

const {
  DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP,
  DEAL_DISQUALIFIED_REASON_PROP, JUNK_DISQUALIFIED_REASON, ALLBOUND_OUTBOUND_LEAD_SOURCE_VALUES,
  THIRD_PARTY_TAG_VALUES, WARM_TAG_KEYWORDS, WARM_EXTRA_TAG_VALUES, EVENT_TAG_KEYWORDS
} = require('./config');

const DEAL_PROPERTIES = [
  DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP,
  DEAL_DISQUALIFIED_REASON_PROP, 'hubspot_owner_id', 'dealstage'
];

function isJunk(deal) {
  const reasons = (deal.properties[DEAL_DISQUALIFIED_REASON_PROP] || '').split(';').map((r) => r.trim().toLowerCase());
  return reasons.indexOf(JUNK_DISQUALIFIED_REASON.toLowerCase()) !== -1;
}

function isAllboundOrOutbound(deal) {
  return ALLBOUND_OUTBOUND_LEAD_SOURCE_VALUES.indexOf(deal.properties[DEAL_FINAL_LEAD_SOURCE_PROP]) !== -1;
}

// Row shown in the drill-down modal. `dateProp` (optional) is the date the metric keys on.
function toDealRecord(deal, roster, ownersMap, dateProp) {
  const p = deal.properties;
  const ownerId = p[DEAL_SDR_OWNER_PROP];
  return {
    id: deal.id,
    ownerId,
    name: p[DEAL_NAME_PROP] || '(unnamed deal)',
    leadSource: p[DEAL_LEAD_SOURCE_PROP] || '',
    finalLeadSource: p[DEAL_FINAL_LEAD_SOURCE_PROP] || '',
    sdrOwner: roster[ownerId] ? roster[ownerId].name : ownerId,
    dealOwner: ownersMap[p.hubspot_owner_id] || p.hubspot_owner_id || '',
    region: roster[ownerId] ? roster[ownerId].region : '',
    stage: p.dealstage || '',
    date: dateProp && p[dateProp] ? new Date(p[dateProp]).toISOString() : ''
  };
}

/**
 * { thirdParty, warm, event } booleans for a raw "TAGS- SDR Categories" value. `labels` maps
 * option values to their HubSpot labels (getPropertyOptionLabels) so keywords can match either.
 */
function classifyTags(raw, labels) {
  labels = labels || {};
  const values = String(raw || '').split(';').map((t) => t.trim()).filter(Boolean);
  const lower = (list) => list.map((v) => v.toLowerCase());
  const thirdPartyValues = lower(THIRD_PARTY_TAG_VALUES);
  const warmExtra = lower(WARM_EXTRA_TAG_VALUES);
  const texts = (v) => [v.toLowerCase(), String(labels[v] || '').toLowerCase()];
  const hasKeyword = (v, keywords) => texts(v).some((t) => keywords.some((k) => t.indexOf(k) !== -1));
  return {
    thirdParty: values.some((v) => thirdPartyValues.indexOf(v.toLowerCase()) !== -1),
    warm: values.some((v) => hasKeyword(v, WARM_TAG_KEYWORDS) || warmExtra.indexOf(v.toLowerCase()) !== -1),
    event: values.some((v) => hasKeyword(v, EVENT_TAG_KEYWORDS))
  };
}

module.exports = { DEAL_PROPERTIES, isJunk, isAllboundOrOutbound, toDealRecord, classifyTags };
