/**
 * Builds the payload for the "Actionables" tab - current state only, no date filter:
 *  - 3rd party / warm / event accounts owned by an SDR that have NOT been worked
 *    (Account worked after Allocation? is not Yes)
 *  - accounts worked but not converted to a meeting (Lifecycle Stage (Custom) not converted)
 *  - where deals are stuck: No Shows (worked vs not), and Scheduled / Sales Accepted deals
 *    sitting in that stage for 30+ / 60+ / 90+ days
 */

const {
  COMPANY_SDR_OWNER_PROP, COMPANY_NAME_PROP, COMPANY_WORKED_PROP, COMPANY_TAG_PROP,
  COMPANY_LIFECYCLE_PROP, COMPANY_ICP_CATEGORY_PROP, COMPANY_OWNER_PROP, COMPANY_LAST_ACTIVITY_PROP,
  COMPANY_ALLOCATION_DATE_PROP, CONVERTED_LIFECYCLE_VALUES,
  PIPELINE_ID, DEAL_SDR_OWNER_PROP, STAGE_NO_SHOW, STAGE_SCHEDULED, STAGE_SALES_ACCEPTED,
  DEAL_WORKED_AFTER_NO_SHOW_PROP, DEAL_DATE_ENTERED_CURRENT_STAGE_PROP, CACHE_TTL_SECONDS
} = require('./config');
const {
  hubspotSearch, getHubSpotPortalId, getAllHubSpotOwnersMap, getPropertyOptionLabels, eqFilter, inFilter, cached
} = require('./hubspot');
const { REGIONS, getRoster, getAllOwnerIds, getOwnersPayload } = require('./roster');
const { DEAL_PROPERTIES, toDealRecord, classifyTags } = require('./records');

const COMPANY_PROPERTIES = [
  COMPANY_SDR_OWNER_PROP, COMPANY_NAME_PROP, COMPANY_WORKED_PROP, COMPANY_TAG_PROP, COMPANY_LIFECYCLE_PROP,
  'domain', COMPANY_ICP_CATEGORY_PROP, COMPANY_OWNER_PROP, COMPANY_LAST_ACTIVITY_PROP, COMPANY_ALLOCATION_DATE_PROP
];

function buildActionablesPayload(forceRefresh) {
  return cached('actionables', CACHE_TTL_SECONDS, build, forceRefresh);
}

async function build() {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();

  const [portalId, ownersMap, tagLabels, companiesPerOwner, noShowDeals, scheduledDeals, saaDeals] = await Promise.all([
    getHubSpotPortalId(),
    getAllHubSpotOwnersMap(),
    getPropertyOptionLabels('companies', COMPANY_TAG_PROP),
    // One search per SDR so no single search approaches HubSpot's 10,000-result cap.
    Promise.all(ownerIds.map((id) => hubspotSearch('companies', [{ filters: [eqFilter(COMPANY_SDR_OWNER_PROP, id)] }], COMPANY_PROPERTIES))),
    dealsCurrentlyInStage(STAGE_NO_SHOW, ownerIds, [DEAL_WORKED_AFTER_NO_SHOW_PROP]),
    dealsCurrentlyInStage(STAGE_SCHEDULED, ownerIds, [DEAL_DATE_ENTERED_CURRENT_STAGE_PROP]),
    dealsCurrentlyInStage(STAGE_SALES_ACCEPTED, ownerIds, [DEAL_DATE_ENTERED_CURRENT_STAGE_PROP])
  ]);

  // ---- accounts ----
  const accounts = { thirdParty: {}, warm: {}, event: {}, notConverted: {} };
  ownerIds.forEach((id, i) => {
    Object.keys(accounts).forEach((k) => { accounts[k][id] = []; });
    companiesPerOwner[i].forEach((c) => {
      const p = c.properties;
      const worked = (p[COMPANY_WORKED_PROP] || '').trim().toLowerCase() === 'yes';
      const lifecycle = p[COMPANY_LIFECYCLE_PROP] || '';
      const tags = classifyTags(p[COMPANY_TAG_PROP], tagLabels);
      const record = {
        id: c.id,
        name: p[COMPANY_NAME_PROP] || '(unnamed company)',
        domain: p.domain || '',
        icpCategory: p[COMPANY_ICP_CATEGORY_PROP] || '',
        lifecycleStage: lifecycle,
        sdrOwner: roster[id].name,
        companyOwner: ownersMap[p[COMPANY_OWNER_PROP]] || p[COMPANY_OWNER_PROP] || '',
        lastActivityDate: p[COMPANY_LAST_ACTIVITY_PROP] || '',
        allocationDate: p[COMPANY_ALLOCATION_DATE_PROP] || '',
        tagCategory: tagLabels[p[COMPANY_TAG_PROP]] || p[COMPANY_TAG_PROP] || ''
      };
      if (!worked) {
        ['thirdParty', 'warm', 'event'].forEach((k) => { if (tags[k]) accounts[k][id].push(record); });
      } else if (CONVERTED_LIFECYCLE_VALUES.indexOf(lifecycle) === -1) {
        accounts.notConverted[id].push(record);
      }
    });
  });

  // ---- where deals are stuck ----
  const toRec = (d) => toDealRecord(d, roster, ownersMap);

  const noShow = {};
  ownerIds.forEach((id) => { noShow[id] = { worked: [], notWorked: [] }; });
  noShowDeals.forEach((d) => {
    const bucket = noShow[d.properties[DEAL_SDR_OWNER_PROP]];
    if (!bucket) return;
    const worked = (d.properties[DEAL_WORKED_AFTER_NO_SHOW_PROP] || '').trim().toLowerCase() === 'yes';
    bucket[worked ? 'worked' : 'notWorked'].push(toRec(d));
  });

  function ageing(deals) {
    const byOwner = {};
    ownerIds.forEach((id) => { byOwner[id] = { over30: [], over60: [], over90: [] }; });
    deals.forEach((d) => {
      const bucket = byOwner[d.properties[DEAL_SDR_OWNER_PROP]];
      if (!bucket) return;
      const entered = parseHubSpotDate(d.properties[DEAL_DATE_ENTERED_CURRENT_STAGE_PROP]);
      if (entered === null) return;
      const days = (Date.now() - entered) / 86400000;
      const key = days >= 90 ? 'over90' : days >= 60 ? 'over60' : days >= 30 ? 'over30' : null;
      if (!key) return;
      const rec = toRec(d);
      rec.daysInStage = Math.floor(days);
      bucket[key].push(rec);
    });
    return byOwner;
  }

  return {
    generatedAt: new Date().toISOString(),
    portalId,
    regions: REGIONS,
    owners: getOwnersPayload(),
    accounts,
    stuck: { noShow, mql: ageing(scheduledDeals), saa: ageing(saaDeals) }
  };
}

// HubSpot datetime values arrive as ISO strings or epoch-millisecond strings.
function parseHubSpotDate(value) {
  if (!value) return null;
  const ms = /^\d+$/.test(String(value)) ? Number(value) : new Date(value).getTime();
  return isNaN(ms) ? null : ms;
}

function dealsCurrentlyInStage(stageId, ownerIds, extraProperties) {
  const filters = [eqFilter('pipeline', PIPELINE_ID), eqFilter('dealstage', stageId), inFilter(DEAL_SDR_OWNER_PROP, ownerIds)];
  return hubspotSearch('deals', [{ filters }], DEAL_PROPERTIES.concat(extraProperties));
}

module.exports = { buildActionablesPayload };
