/**
 * Builds the payload for the "MOFU Activity" tab.
 *
 * Two independent halves:
 *  1. Quarter-scoped: the 4 top tiles (Meetings Booked, Sales Accepted, Opportunities,
 *     No Shows) and the weekly trend charts for the first 3 - all driven by the quarter
 *     dropdown (a specific FYxx-yy Qn, or the full fiscal year).
 *  2. Current-state, NOT quarter-scoped: the 3 "where deals are stuck" charts, which look
 *     at whatever is sitting in a stage right now regardless of when it got there.
 * Both halves are still sliced by the page's Region/SDR Owner toggle, same pattern as
 * Account Activity: return raw per-owner data, let the client sum/filter instantly.
 */
function buildMofuPayload(quarterKey) {
  var roster = getRoster();
  var ownerIds = getAllOwnerIds();
  var quarter = resolveQuarterSelection(quarterKey);
  var portalId = getHubSpotPortalId();
  var ownersMap = getAllHubSpotOwnersMap();

  var dealProps = [DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage'];

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

  function notJunk(d) {
    var reasons = (d.properties[DEAL_DISQUALIFIED_REASON_PROP] || '').split(';').map(function (r) { return r.trim().toLowerCase(); });
    return reasons.indexOf(JUNK_DISQUALIFIED_REASON.toLowerCase()) === -1;
  }

  // Every week (Monday key) that falls inside the selected range, in order - used so every
  // weekly chart has a consistent, gap-free x-axis even for weeks with zero activity.
  function weeksInRange(start, end) {
    var weeks = [];
    var cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    while (cursor.getTime() <= end.getTime()) {
      var key = isoWeekKey(cursor);
      if (!weeks.length || weeks[weeks.length - 1].key !== key) {
        weeks.push({ key: key, label: Utilities.formatDate(new Date(key + 'T00:00:00Z'), 'Etc/UTC', 'MMM d') });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return weeks;
  }
  var weeks = weeksInRange(quarter.start, quarter.end);

  function buildQuarterMetric(dateProp, extraFilters, excludeJunk) {
    var deals = searchDealsInWindow(dateProp, quarter.start, quarter.end, ownerIds, extraFilters, dealProps.concat([dateProp]));
    var countByOwner = {};
    var weeklyByOwner = {};
    var recordsByOwner = {};
    ownerIds.forEach(function (id) { countByOwner[id] = 0; weeklyByOwner[id] = {}; recordsByOwner[id] = []; });

    deals.forEach(function (d) {
      var ownerId = d.properties[DEAL_SDR_OWNER_PROP];
      if (!ownerId || !roster[ownerId]) return;
      if (excludeJunk && !notJunk(d)) return;
      var dateVal = d.properties[dateProp];
      if (!dateVal) return;
      var weekKey = isoWeekKey(new Date(dateVal));

      countByOwner[ownerId]++;
      weeklyByOwner[ownerId][weekKey] = (weeklyByOwner[ownerId][weekKey] || 0) + 1;
      var rec = toDrillRecord(d);
      rec.weekKey = weekKey; // lets the client filter this metric's weekly trend chart drill-down
      recordsByOwner[ownerId].push(rec);
    });

    return { countByOwner: countByOwner, weeklyByOwner: weeklyByOwner, recordsByOwner: recordsByOwner };
  }

  var meetingsBooked = buildQuarterMetric(SCHEDULED_STAGE_ENTERED_PROP, [], true);
  var salesAccepted = buildQuarterMetric(STAGE_ENTERED_SALES_ACCEPTED_PROP, [], true);
  var opportunities = buildQuarterMetric(BECAME_QUALIFIED_PROP, [inFilter('dealstage', OPPORTUNITY_STAGE_IDS)], false);
  var noShows = buildQuarterMetric(STAGE_ENTERED_NO_SHOW_PROP, [], true);

  // ---- "Where deals are stuck" - current state, independent of the quarter filter ----

  function currentlyInStage(stageId, extraProperties) {
    var filters = [eqFilter('pipeline', PIPELINE_ID), eqFilter('dealstage', stageId), inFilter(DEAL_SDR_OWNER_PROP, ownerIds)];
    return hubspotSearch('deals', [{ filters: filters }], dealProps.concat(extraProperties || []));
  }

  function isWorkedAfterNoShow(props) {
    return (props[DEAL_WORKED_AFTER_NO_SHOW_PROP] || '').trim().toLowerCase() === 'yes';
  }

  function ageingBucket(days) {
    if (days >= 90) return 'over90';
    if (days >= 60) return 'over60';
    if (days >= 30) return 'over30';
    return null;
  }

  var noShowDeals = currentlyInStage(STAGE_NO_SHOW, [DEAL_WORKED_AFTER_NO_SHOW_PROP]);
  var noShowStuckByOwner = {};
  ownerIds.forEach(function (id) { noShowStuckByOwner[id] = { worked: 0, notWorked: 0, workedRecords: [], notWorkedRecords: [] }; });
  noShowDeals.forEach(function (d) {
    var ownerId = d.properties[DEAL_SDR_OWNER_PROP];
    var bucket = noShowStuckByOwner[ownerId];
    if (!bucket) return;
    if (isWorkedAfterNoShow(d.properties)) { bucket.worked++; bucket.workedRecords.push(toDrillRecord(d)); }
    else { bucket.notWorked++; bucket.notWorkedRecords.push(toDrillRecord(d)); }
  });

  function buildAgeingChart(stageId) {
    var deals = currentlyInStage(stageId, [DEAL_TIME_IN_CURRENT_STAGE_PROP]);
    var byOwner = {};
    ownerIds.forEach(function (id) {
      byOwner[id] = { over30: 0, over60: 0, over90: 0, over30Records: [], over60Records: [], over90Records: [] };
    });
    deals.forEach(function (d) {
      var ownerId = d.properties[DEAL_SDR_OWNER_PROP];
      var bucket = byOwner[ownerId];
      if (!bucket) return;
      var days = Number(d.properties[DEAL_TIME_IN_CURRENT_STAGE_PROP] || 0) / 86400;
      var key = ageingBucket(days);
      if (!key) return; // under 30 days - not "stuck" yet, excluded per spec
      bucket[key]++;
      bucket[key + 'Records'].push(toDrillRecord(d));
    });
    return byOwner;
  }

  var mqlStuckByOwner = buildAgeingChart(STAGE_SCHEDULED);
  var saaStuckByOwner = buildAgeingChart(STAGE_SALES_ACCEPTED);

  var owners = {};
  ownerIds.forEach(function (id) { owners[id] = { ownerId: id, name: roster[id].name, region: roster[id].region }; });

  return {
    generatedAt: new Date().toISOString(),
    portalId: portalId,
    quarterOptions: getFiscalYearQuarters().quarters.map(function (q) { return { key: q.key, label: q.label }; })
      .concat([{ key: 'FULL_FY', label: getFiscalYearQuarters().fyLabel + ' Full Fiscal Year' }]),
    selectedQuarter: { key: quarter.key, label: quarter.label },
    weeks: weeks,
    regions: getRegionsInUse(),
    owners: owners,
    tiles: { meetingsBooked: meetingsBooked, salesAccepted: salesAccepted, opportunities: opportunities, noShows: noShows },
    stuck: { noShow: noShowStuckByOwner, mql: mqlStuckByOwner, saa: saaStuckByOwner }
  };
}
