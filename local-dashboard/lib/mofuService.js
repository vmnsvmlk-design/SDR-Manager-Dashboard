/**
 * Builds the payload for the "MOFU Activity" tab. Direct port of MofuService.gs.
 */

const {
  DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP,
  DEAL_DISQUALIFIED_REASON_PROP, JUNK_DISQUALIFIED_REASON, SCHEDULED_STAGE_ENTERED_PROP,
  STAGE_ENTERED_SALES_ACCEPTED_PROP, STAGE_ENTERED_NO_SHOW_PROP, BECAME_QUALIFIED_PROP,
  OPPORTUNITY_STAGE_IDS, STAGE_NO_SHOW, STAGE_SCHEDULED, STAGE_SALES_ACCEPTED,
  DEAL_WORKED_AFTER_NO_SHOW_PROP, DEAL_TIME_IN_CURRENT_STAGE_PROP, PIPELINE_ID
} = require('./config');
const {
  searchDealsInWindow, hubspotSearch, getHubSpotPortalId, getAllHubSpotOwnersMap,
  eqFilter, inFilter
} = require('./hubspot');
const { resolveQuarterSelection, getFiscalYearQuarters, isoWeekKey } = require('./fiscalQuarter');
const { getRoster, getAllOwnerIds, getRegionsInUse } = require('./roster');

function formatWeekLabel(key) {
  const d = new Date(key + 'T00:00:00Z');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

async function buildMofuPayload(quarterKey) {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();
  const quarter = resolveQuarterSelection(quarterKey);
  const dealProps = [DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage'];

  const [portalId, ownersMap] = await Promise.all([getHubSpotPortalId(), getAllHubSpotOwnersMap()]);

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

  function notJunk(d) {
    const reasons = (d.properties[DEAL_DISQUALIFIED_REASON_PROP] || '').split(';').map((r) => r.trim().toLowerCase());
    return reasons.indexOf(JUNK_DISQUALIFIED_REASON.toLowerCase()) === -1;
  }

  function weeksInRange(start, end) {
    const weeks = [];
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    while (cursor.getTime() <= end.getTime()) {
      const key = isoWeekKey(cursor);
      if (!weeks.length || weeks[weeks.length - 1].key !== key) {
        weeks.push({ key, label: formatWeekLabel(key) });
      }
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
    return weeks;
  }
  const weeks = weeksInRange(quarter.start, quarter.end);

  async function buildQuarterMetric(dateProp, extraFilters, excludeJunk) {
    const deals = await searchDealsInWindow(dateProp, quarter.start, quarter.end, ownerIds, extraFilters, dealProps.concat([dateProp]));
    const countByOwner = {};
    const weeklyByOwner = {};
    const recordsByOwner = {};
    ownerIds.forEach((id) => { countByOwner[id] = 0; weeklyByOwner[id] = {}; recordsByOwner[id] = []; });

    deals.forEach((d) => {
      const ownerId = d.properties[DEAL_SDR_OWNER_PROP];
      if (!ownerId || !roster[ownerId]) return;
      if (excludeJunk && !notJunk(d)) return;
      const dateVal = d.properties[dateProp];
      if (!dateVal) return;
      const weekKey = isoWeekKey(new Date(dateVal));

      countByOwner[ownerId]++;
      weeklyByOwner[ownerId][weekKey] = (weeklyByOwner[ownerId][weekKey] || 0) + 1;
      const rec = toDrillRecord(d);
      rec.weekKey = weekKey;
      recordsByOwner[ownerId].push(rec);
    });

    return { countByOwner, weeklyByOwner, recordsByOwner };
  }

  function currentlyInStage(stageId, extraProperties) {
    const filters = [eqFilter('pipeline', PIPELINE_ID), eqFilter('dealstage', stageId), inFilter(DEAL_SDR_OWNER_PROP, ownerIds)];
    return hubspotSearch('deals', [{ filters }], dealProps.concat(extraProperties || []));
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

  async function buildAgeingChart(stageId) {
    const deals = await currentlyInStage(stageId, [DEAL_TIME_IN_CURRENT_STAGE_PROP]);
    const byOwner = {};
    ownerIds.forEach((id) => {
      byOwner[id] = { over30: 0, over60: 0, over90: 0, over30Records: [], over60Records: [], over90Records: [] };
    });
    deals.forEach((d) => {
      const ownerId = d.properties[DEAL_SDR_OWNER_PROP];
      const bucket = byOwner[ownerId];
      if (!bucket) return;
      const days = Number(d.properties[DEAL_TIME_IN_CURRENT_STAGE_PROP] || 0) / 86400;
      const key = ageingBucket(days);
      if (!key) return;
      bucket[key]++;
      bucket[key + 'Records'].push(toDrillRecord(d));
    });
    return byOwner;
  }

  const [
    meetingsBooked, salesAccepted, opportunities, noShows,
    noShowDeals, mqlStuckByOwner, saaStuckByOwner
  ] = await Promise.all([
    buildQuarterMetric(SCHEDULED_STAGE_ENTERED_PROP, [], true),
    buildQuarterMetric(STAGE_ENTERED_SALES_ACCEPTED_PROP, [], true),
    buildQuarterMetric(BECAME_QUALIFIED_PROP, [inFilter('dealstage', OPPORTUNITY_STAGE_IDS)], false),
    buildQuarterMetric(STAGE_ENTERED_NO_SHOW_PROP, [], true),
    currentlyInStage(STAGE_NO_SHOW, [DEAL_WORKED_AFTER_NO_SHOW_PROP]),
    buildAgeingChart(STAGE_SCHEDULED),
    buildAgeingChart(STAGE_SALES_ACCEPTED)
  ]);

  const noShowStuckByOwner = {};
  ownerIds.forEach((id) => { noShowStuckByOwner[id] = { worked: 0, notWorked: 0, workedRecords: [], notWorkedRecords: [] }; });
  noShowDeals.forEach((d) => {
    const ownerId = d.properties[DEAL_SDR_OWNER_PROP];
    const bucket = noShowStuckByOwner[ownerId];
    if (!bucket) return;
    if (isWorkedAfterNoShow(d.properties)) { bucket.worked++; bucket.workedRecords.push(toDrillRecord(d)); }
    else { bucket.notWorked++; bucket.notWorkedRecords.push(toDrillRecord(d)); }
  });

  const owners = {};
  ownerIds.forEach((id) => { owners[id] = { ownerId: id, name: roster[id].name, region: roster[id].region }; });

  return {
    generatedAt: new Date().toISOString(),
    portalId,
    quarterOptions: getFiscalYearQuarters().quarters.map((q) => ({ key: q.key, label: q.label }))
      .concat([{ key: 'FULL_FY', label: getFiscalYearQuarters().fyLabel + ' Full Fiscal Year' }]),
    selectedQuarter: { key: quarter.key, label: quarter.label },
    weeks,
    regions: getRegionsInUse(),
    owners,
    tiles: { meetingsBooked, salesAccepted, opportunities, noShows },
    stuck: { noShow: noShowStuckByOwner, mql: mqlStuckByOwner, saa: saaStuckByOwner }
  };
}

module.exports = { buildMofuPayload };
