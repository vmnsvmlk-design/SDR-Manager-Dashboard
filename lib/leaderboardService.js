/**
 * Builds the payload for the "Leaderboard" tab: every deal behind the three leaderboard
 * metrics for the current fiscal year (1 May onwards), plus targets for the SDR Performance
 * table. Ranking, per-region podiums and the per-quarter split are done in the browser, so the
 * podium, the rep-wise comparison popup and the drill-downs all read the same records.
 */

const {
  BECAME_QUALIFIED_PROP, STAGE_ENTERED_SCHEDULED_PROP, OPPORTUNITY_STAGE_IDS, DEAL_SDR_OWNER_PROP, CACHE_TTL_SECONDS
} = require('./config');
const {
  searchDealsInWindow, getHubSpotPortalId, getAllHubSpotOwnersMap, inFilter, cached
} = require('./hubspot');
const { getCurrentFiscalYear, getCurrentFiscalQuarter } = require('./fiscalQuarter');
const { REGIONS, getRoster, getAllOwnerIds, getOwnersPayload, getTargetsFiscalYear } = require('./roster');
const { DEAL_PROPERTIES, isJunk, isAllboundOrOutbound, toDealRecord } = require('./records');

function buildLeaderboardPayload(mode) {
  return cached('leaderboard', CACHE_TTL_SECONDS, build, mode);
}

async function build() {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();
  const fy = getCurrentFiscalYear();

  const [portalId, ownersMap, oppDeals, meetingDeals] = await Promise.all([
    getHubSpotPortalId(),
    getAllHubSpotOwnersMap(),
    searchDealsInWindow(BECAME_QUALIFIED_PROP, fy.start, fy.end, ownerIds,
      [inFilter('dealstage', OPPORTUNITY_STAGE_IDS)], DEAL_PROPERTIES.concat([BECAME_QUALIFIED_PROP])),
    searchDealsInWindow(STAGE_ENTERED_SCHEDULED_PROP, fy.start, fy.end, ownerIds,
      [], DEAL_PROPERTIES.concat([STAGE_ENTERED_SCHEDULED_PROP]))
  ]);

  function toRecord(deal, dateProp) {
    const rec = toDealRecord(deal, roster, ownersMap, dateProp);
    rec.quarterNumber = rec.date ? getCurrentFiscalQuarter(new Date(rec.date)).quarterNumber : null;
    return rec;
  }
  const onRoster = (d) => !!roster[d.properties[DEAL_SDR_OWNER_PROP]];

  const allOpps = oppDeals.filter(onRoster);
  const metrics = {
    allboundOpps: allOpps.filter(isAllboundOrOutbound).map((d) => toRecord(d, BECAME_QUALIFIED_PROP)),
    allOpps: allOpps.map((d) => toRecord(d, BECAME_QUALIFIED_PROP)),
    meetings: meetingDeals.filter(onRoster).filter((d) => !isJunk(d)).map((d) => toRecord(d, STAGE_ENTERED_SCHEDULED_PROP))
  };

  const targets = {};
  ownerIds.forEach((id) => { targets[id] = roster[id].targets; });

  return {
    generatedAt: new Date().toISOString(),
    portalId,
    fyLabel: fy.fyLabel,
    quarters: fy.quarters.map((q) => ({ quarterNumber: q.quarterNumber, label: q.label })),
    currentQuarterNumber: getCurrentFiscalQuarter().quarterNumber,
    regions: REGIONS,
    owners: getOwnersPayload(),
    metrics,
    targets,
    targetsFiscalYear: getTargetsFiscalYear()
  };
}

module.exports = { buildLeaderboardPayload };
