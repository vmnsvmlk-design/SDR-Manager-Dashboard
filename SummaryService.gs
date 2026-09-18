/**
 * Builds the payload for the "Summary" tab: per-region leaderboard (top 3 SDRs by SQLs
 * created this fiscal quarter) plus region-wide Total SQLs and Total Meetings tiles.
 * Everything is recomputed from live HubSpot data on every call, so rankings are always
 * current (a 4th-place SDR who overtakes 3rd will appear automatically on the next refresh).
 */
function buildSummaryPayload() {
  var quarter = getCurrentFiscalQuarter();
  var ownerIds = getAllOwnerIds();

  // SQLs: deals in Sales Pipeline, in one of the SQL stages, that became qualified to buy
  // within the current fiscal quarter, owned (SDR Owner - Deal) by one of our tracked SDRs.
  var sqlDeals = hubspotSearch('deals', [{
    filters: [
      eqFilter('pipeline', PIPELINE_ID),
      inFilter('dealstage', SQL_STAGE_IDS),
      dateFilter(BECAME_QUALIFIED_PROP, quarter.start, quarter.end),
      inFilter(DEAL_SDR_OWNER_PROP, ownerIds)
    ]
  }], [DEAL_SDR_OWNER_PROP]);

  // Meetings: deals in Sales Pipeline (any stage) that entered "Scheduled" within the
  // current fiscal quarter, excluding ones disqualified as junk, owned by a tracked SDR.
  var meetingDeals = hubspotSearch('deals', [{
    filters: [
      eqFilter('pipeline', PIPELINE_ID),
      dateFilter(SCHEDULED_STAGE_ENTERED_PROP, quarter.start, quarter.end),
      inFilter(DEAL_SDR_OWNER_PROP, ownerIds)
    ]
  }], [DEAL_SDR_OWNER_PROP, DEAL_DISQUALIFIED_REASON_PROP]);

  var sqlCountByOwner = {};
  sqlDeals.forEach(function (d) {
    var owner = d.properties[DEAL_SDR_OWNER_PROP];
    if (!owner || !SDR_ROSTER[owner]) return;
    sqlCountByOwner[owner] = (sqlCountByOwner[owner] || 0) + 1;
  });

  var meetingCountByOwner = {};
  meetingDeals.forEach(function (d) {
    var owner = d.properties[DEAL_SDR_OWNER_PROP];
    if (!owner || !SDR_ROSTER[owner]) return;
    var reason = (d.properties[DEAL_DISQUALIFIED_REASON_PROP] || '').trim().toLowerCase();
    if (reason === JUNK_DISQUALIFIED_REASON.toLowerCase()) return;
    meetingCountByOwner[owner] = (meetingCountByOwner[owner] || 0) + 1;
  });

  var regions = {};
  REGIONS.forEach(function (region) {
    var regionOwnerIds = getOwnerIdsForRegion(region);

    var leaderboard = regionOwnerIds
      .map(function (id) {
        return { ownerId: id, name: SDR_ROSTER[id].name, sqls: sqlCountByOwner[id] || 0 };
      })
      .sort(function (a, b) { return b.sqls - a.sqls; })
      .slice(0, 3);

    var totalSQLs = regionOwnerIds.reduce(function (sum, id) { return sum + (sqlCountByOwner[id] || 0); }, 0);
    var totalMeetings = regionOwnerIds.reduce(function (sum, id) { return sum + (meetingCountByOwner[id] || 0); }, 0);

    regions[region] = { leaderboard: leaderboard, totalSQLs: totalSQLs, totalMeetings: totalMeetings };
  });

  return { quarterLabel: quarter.label, generatedAt: new Date().toISOString(), regions: regions };
}
