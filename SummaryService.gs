/**
 * Builds the payload for the "Summary" tab: per-region leaderboard (top 3 SDRs by SQLs
 * created this fiscal quarter) plus region-wide Total SQLs and Total Meetings tiles, and
 * the SDR Performance table (Target vs Achieved per quarter of the current fiscal year).
 * Everything is recomputed from live HubSpot data on every call, so rankings are always
 * current (a 4th-place SDR who overtakes 3rd will appear automatically on the next refresh).
 */
function buildSummaryPayload() {
  var roster = getRoster();
  var ownerIds = getAllOwnerIds();
  var quarter = getCurrentFiscalQuarter();
  var portalId = getHubSpotPortalId();
  var ownersMap = getAllHubSpotOwnersMap();

  var sqlDeals = searchDealsInWindow(
    BECAME_QUALIFIED_PROP, quarter.start, quarter.end, ownerIds,
    [inFilter('dealstage', SQL_STAGE_IDS)],
    [DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage']
  );

  var meetingDeals = searchDealsInWindow(
    SCHEDULED_STAGE_ENTERED_PROP, quarter.start, quarter.end, ownerIds, [],
    [DEAL_SDR_OWNER_PROP, DEAL_DISQUALIFIED_REASON_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage']
  );

  function toDrillRecord(d) {
    var ownerId = d.properties[DEAL_SDR_OWNER_PROP];
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

  var sqlCountByOwner = {};
  var sqlRecordsByOwner = {};
  sqlDeals.forEach(function (d) {
    var owner = d.properties[DEAL_SDR_OWNER_PROP];
    if (!owner || !roster[owner]) return;
    sqlCountByOwner[owner] = (sqlCountByOwner[owner] || 0) + 1;
    (sqlRecordsByOwner[owner] = sqlRecordsByOwner[owner] || []).push(toDrillRecord(d));
  });

  var meetingCountByOwner = {};
  var meetingRecordsByOwner = {};
  meetingDeals.forEach(function (d) {
    var owner = d.properties[DEAL_SDR_OWNER_PROP];
    if (!owner || !roster[owner]) return;
    // "Disqualified/ Not Interested Reason Custom" is a multi-checkbox property - HubSpot
    // stores multiple selections as a single ";"-separated string (e.g. "Junk Lead;No Show").
    var reasons = (d.properties[DEAL_DISQUALIFIED_REASON_PROP] || '')
      .split(';')
      .map(function (r) { return r.trim().toLowerCase(); });
    if (reasons.indexOf(JUNK_DISQUALIFIED_REASON.toLowerCase()) !== -1) return;
    meetingCountByOwner[owner] = (meetingCountByOwner[owner] || 0) + 1;
    (meetingRecordsByOwner[owner] = meetingRecordsByOwner[owner] || []).push(toDrillRecord(d));
  });

  var regions = {};
  REGIONS.forEach(function (region) {
    var regionOwnerIds = getOwnerIdsForRegion(region);

    var leaderboard = regionOwnerIds
      .map(function (id) {
        return { ownerId: id, name: roster[id].name, sqls: sqlCountByOwner[id] || 0 };
      })
      .sort(function (a, b) { return b.sqls - a.sqls; })
      .slice(0, 3);

    var totalSQLs = regionOwnerIds.reduce(function (sum, id) { return sum + (sqlCountByOwner[id] || 0); }, 0);
    var totalMeetings = regionOwnerIds.reduce(function (sum, id) { return sum + (meetingCountByOwner[id] || 0); }, 0);
    var sqlRecords = regionOwnerIds.reduce(function (list, id) { return list.concat(sqlRecordsByOwner[id] || []); }, []);
    var meetingRecords = regionOwnerIds.reduce(function (list, id) { return list.concat(meetingRecordsByOwner[id] || []); }, []);

    regions[region] = {
      leaderboard: leaderboard,
      totalSQLs: totalSQLs,
      totalMeetings: totalMeetings,
      sqlRecords: sqlRecords,
      meetingRecords: meetingRecords
    };
  });

  return {
    quarterLabel: quarter.label,
    generatedAt: new Date().toISOString(),
    portalId: portalId,
    regions: regions,
    sdrPerformance: buildSdrPerformancePayload()
  };
}
