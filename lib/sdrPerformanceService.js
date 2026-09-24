/**
 * Builds the "SDR Performance" table (Target vs Achieved per quarter). Direct port of
 * SdrPerformanceService.gs - the 4 per-quarter deal searches run concurrently via Promise.all
 * instead of one after another.
 */

const {
  BECAME_QUALIFIED_PROP, SQL_STAGE_IDS, DEAL_FINAL_LEAD_SOURCE_PROP, SQL_ALLOWED_LEAD_SOURCE_VALUES,
  DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP
} = require('./config');
const { searchDealsInWindow, getAllHubSpotOwnersMap, inFilter } = require('./hubspot');
const { getFiscalYearQuarters } = require('./fiscalQuarter');
const { getRoster, getTargets, getAllOwnerIds } = require('./roster');

async function buildSdrPerformancePayload() {
  const roster = getRoster();
  const targets = getTargets();
  const ownerIds = getAllOwnerIds();
  const fy = getFiscalYearQuarters();
  const ownersMap = await getAllHubSpotOwnersMap();

  const achievedByOwnerByQuarter = {};
  const recordsByOwnerByQuarter = {};
  ownerIds.forEach((id) => {
    achievedByOwnerByQuarter[id] = {};
    recordsByOwnerByQuarter[id] = {};
  });

  await Promise.all(fy.quarters.map(async (q) => {
    const deals = await searchDealsInWindow(
      BECAME_QUALIFIED_PROP, q.start, q.end, ownerIds,
      [
        inFilter('dealstage', SQL_STAGE_IDS),
        inFilter(DEAL_FINAL_LEAD_SOURCE_PROP, SQL_ALLOWED_LEAD_SOURCE_VALUES)
      ],
      [DEAL_SDR_OWNER_PROP, DEAL_NAME_PROP, DEAL_LEAD_SOURCE_PROP, DEAL_FINAL_LEAD_SOURCE_PROP, 'hubspot_owner_id', 'dealstage']
    );

    deals.forEach((d) => {
      const ownerId = d.properties[DEAL_SDR_OWNER_PROP];
      if (!ownerId || !roster[ownerId]) return;
      achievedByOwnerByQuarter[ownerId][q.quarterNumber] = (achievedByOwnerByQuarter[ownerId][q.quarterNumber] || 0) + 1;
      const list = recordsByOwnerByQuarter[ownerId][q.quarterNumber] =
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
  }));

  const rows = ownerIds.map((id) => {
    const t = targets[id] || {};
    const row = { ownerId: id, name: roster[id].name, region: roster[id].region };
    [1, 2, 3, 4].forEach((qn) => {
      const targetVal = t['q' + qn];
      row['q' + qn + 'Target'] = (targetVal === null || typeof targetVal === 'undefined') ? null : targetVal;
      row['q' + qn + 'Achieved'] = achievedByOwnerByQuarter[id][qn] || 0;
    });
    return row;
  }).sort((a, b) => a.name.localeCompare(b.name));

  return {
    fyLabel: fy.fyLabel,
    rows,
    records: recordsByOwnerByQuarter
  };
}

module.exports = { buildSdrPerformancePayload };
