/**
 * Builds the payload for the "Summary" tab. Direct port of SummaryService.gs.
 */

const {
  BECAME_QUALIFIED_PROP, SCHEDULED_STAGE_ENTERED_PROP, SQL_STAGE_IDS, DEAL_SDR_OWNER_PROP,
  DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, DEAL_DISQUALIFIED_REASON_PROP,
  JUNK_DISQUALIFIED_REASON, REGIONS
} = require('./config');
const { searchDealsInWindow, getHubSpotPortalId, getAllHubSpotOwnersMap, inFilter } = require('./hubspot');
const { getCurrentFiscalQuarter } = require('./fiscalQuarter');
const { getRoster, getAllOwnerIds, getOwnerIdsForRegion } = require('./roster');
const { buildSdrPerformancePayload } = require('./sdrPerformanceService');

async function buildSummaryPayload() {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();
  const quarter = getCurrentFiscalQuarter();

  const [portalId, ownersMap, sqlDeals, meetingDeals, sdrPerformance] = await Promise.all([
    getHubSpotPortalId(),
    getAllHubSpotOwnersMap(),
    searchDealsInWindow(
      BECAME_QUALIFIED_PROP, quarter.start, quarter.end, ownerIds,
      [inFilter('dealstage', SQL_STAGE_IDS)],
      [DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage']
    ),
    searchDealsInWindow(
      SCHEDULED_STAGE_ENTERED_PROP, quarter.start, quarter.end, ownerIds, [],
      [DEAL_SDR_OWNER_PROP, DEAL_DISQUALIFIED_REASON_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage']
    ),
    buildSdrPerformancePayload()
  ]);

  function toDrillRecord(d) {
    const ownerId = d.properties[DEAL_SDR_OWNER_PROP];
    return {
      id: d.id,
      name: d.properties[DEAL_NAME_PROP] || '(unnamed deal)',
      leadSource: d.properties[DEAL_LEAD_SOURCE_PROP] || '',
      finalLeadSource: d.properties[DEAL_FINAL_LEAD_SOURCE_PROP] || '',
      sdrOwner: roster[ownerId] ? roster[ownerId].name : ownerId,
      dealOwner: ownersMap[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id || '',
      region: roster[ownerId] ? roster[ownerId].region : '',
      stage: d.properties.dealstage || ''
    };
  }

  const sqlCountByOwner = {};
  const sqlRecordsByOwner = {};
  sqlDeals.forEach((d) => {
    const owner = d.properties[DEAL_SDR_OWNER_PROP];
    if (!owner || !roster[owner]) return;
    sqlCountByOwner[owner] = (sqlCountByOwner[owner] || 0) + 1;
    (sqlRecordsByOwner[owner] = sqlRecordsByOwner[owner] || []).push(toDrillRecord(d));
  });

  const meetingCountByOwner = {};
  const meetingRecordsByOwner = {};
  meetingDeals.forEach((d) => {
    const owner = d.properties[DEAL_SDR_OWNER_PROP];
    if (!owner || !roster[owner]) return;
    const reasons = (d.properties[DEAL_DISQUALIFIED_REASON_PROP] || '')
      .split(';')
      .map((r) => r.trim().toLowerCase());
    if (reasons.indexOf(JUNK_DISQUALIFIED_REASON.toLowerCase()) !== -1) return;
    meetingCountByOwner[owner] = (meetingCountByOwner[owner] || 0) + 1;
    (meetingRecordsByOwner[owner] = meetingRecordsByOwner[owner] || []).push(toDrillRecord(d));
  });

  const regions = {};
  REGIONS.forEach((region) => {
    const regionOwnerIds = getOwnerIdsForRegion(region);

    const leaderboard = regionOwnerIds
      .map((id) => ({ ownerId: id, name: roster[id].name, sqls: sqlCountByOwner[id] || 0 }))
      .sort((a, b) => b.sqls - a.sqls)
      .slice(0, 3);

    const totalSQLs = regionOwnerIds.reduce((sum, id) => sum + (sqlCountByOwner[id] || 0), 0);
    const totalMeetings = regionOwnerIds.reduce((sum, id) => sum + (meetingCountByOwner[id] || 0), 0);
    const sqlRecords = regionOwnerIds.reduce((list, id) => list.concat(sqlRecordsByOwner[id] || []), []);
    const meetingRecords = regionOwnerIds.reduce((list, id) => list.concat(meetingRecordsByOwner[id] || []), []);

    regions[region] = { leaderboard, totalSQLs, totalMeetings, sqlRecords, meetingRecords };
  });

  return {
    quarterLabel: quarter.label,
    generatedAt: new Date().toISOString(),
    portalId,
    regions,
    sdrPerformance
  };
}

module.exports = { buildSummaryPayload };
