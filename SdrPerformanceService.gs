/**
 * Builds the "SDR Performance" table shown on the Summary tab: Target (entered on the
 * Inputs tab) vs Achieved (SQLs created that quarter, restricted to deals whose "Final
 * Lead Source (For org reporting)" is Allbound or Pure Outbound) for each of the 4
 * quarters of the current fiscal year. Runs 4 additional deal searches (one per quarter)
 * on top of Summary's own 2, so the Summary tab takes a bit longer to load with this
 * table included.
 */
function buildSdrPerformancePayload() {
  var roster = getRoster();
  var targets = getTargets();
  var ownerIds = getAllOwnerIds();
  var fy = getFiscalYearQuarters();
  var ownersMap = getAllHubSpotOwnersMap();

  var achievedByOwnerByQuarter = {};
  var recordsByOwnerByQuarter = {};
  ownerIds.forEach(function (id) {
    achievedByOwnerByQuarter[id] = {};
    recordsByOwnerByQuarter[id] = {};
  });

  fy.quarters.forEach(function (q) {
    var deals = searchDealsInWindow(
      BECAME_QUALIFIED_PROP, q.start, q.end, ownerIds,
      [
        inFilter('dealstage', SQL_STAGE_IDS),
        inFilter(DEAL_FINAL_LEAD_SOURCE_PROP, SQL_ALLOWED_LEAD_SOURCE_VALUES)
      ],
      [DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage']
    );

    deals.forEach(function (d) {
      var ownerId = d.properties[DEAL_SDR_OWNER_PROP];
      if (!ownerId || !roster[ownerId]) return;
      achievedByOwnerByQuarter[ownerId][q.quarterNumber] = (achievedByOwnerByQuarter[ownerId][q.quarterNumber] || 0) + 1;
      var list = recordsByOwnerByQuarter[ownerId][q.quarterNumber] =
        recordsByOwnerByQuarter[ownerId][q.quarterNumber] || [];
      list.push({
        id: d.id,
        name: d.properties[DEAL_NAME_PROP] || '(unnamed deal)',
        leadSource: d.properties[DEAL_LEAD_SOURCE_PROP] || '',
        finalLeadSource: d.properties[DEAL_FINAL_LEAD_SOURCE_PROP] || '',
        sdrOwner: roster[ownerId].name,
        dealOwner: ownersMap[d.properties.hubspot_owner_id] || d.properties.hubspot_owner_id || '',
        region: roster[ownerId].region,
        stage: d.properties.dealstage || ''
      });
    });
  });

  var rows = ownerIds.map(function (id) {
    var t = targets[id] || {};
    var row = { ownerId: id, name: roster[id].name, region: roster[id].region };
    [1, 2, 3, 4].forEach(function (qn) {
      var targetVal = t['q' + qn];
      row['q' + qn + 'Target'] = (targetVal === null || typeof targetVal === 'undefined') ? null : targetVal;
      row['q' + qn + 'Achieved'] = achievedByOwnerByQuarter[id][qn] || 0;
    });
    return row;
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });

  return {
    fyLabel: fy.fyLabel,
    rows: rows,
    records: recordsByOwnerByQuarter // { ownerId: { quarterNumber: [dealRecord, ...] } }
  };
}
