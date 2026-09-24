/**
 * Builds the payload for the "Account Activity" tab. Direct port of AccountActivityService.gs,
 * including the G2-buyer-intent-based "3rd party accounts" logic.
 */

const {
  COMPANY_SDR_OWNER_PROP, COMPANY_NAME_PROP, COMPANY_WORKED_PROP, COMPANY_REACHED_OUT_PROP,
  COMPANY_TAG_PROP, COMPANY_LIFECYCLE_PROP, COMPANY_INCUMBENT_CLM_PROP, COMPANY_ICP_CATEGORY_PROP,
  COMPANY_OWNER_PROP, COMPANY_LAST_ACTIVITY_PROP, COMPANY_ALLOCATION_DATE_PROP,
  COMPANY_G2_BUYER_INTENT_DETAILS_PROP, COMPANY_G2_RELATED_PRODUCTS_DETAILS_PROP,
  G2_ZERO_PAGES_VIEWED_TEXT, WARM_TAG_VALUES, EVENT_TAG_VALUES, CONVERTED_LIFECYCLE_VALUES
} = require('./config');
const { hubspotSearch, getHubSpotPortalId, getAllHubSpotOwnersMap, inFilter } = require('./hubspot');
const { getRoster, getAllOwnerIds, getRegionsInUse } = require('./roster');

async function buildAccountActivityPayload() {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();
  const properties = [
    COMPANY_SDR_OWNER_PROP,
    COMPANY_NAME_PROP,
    COMPANY_WORKED_PROP,
    COMPANY_REACHED_OUT_PROP,
    COMPANY_TAG_PROP,
    COMPANY_LIFECYCLE_PROP,
    COMPANY_INCUMBENT_CLM_PROP,
    'domain',
    COMPANY_ICP_CATEGORY_PROP,
    COMPANY_OWNER_PROP,
    COMPANY_LAST_ACTIVITY_PROP,
    COMPANY_ALLOCATION_DATE_PROP,
    COMPANY_G2_BUYER_INTENT_DETAILS_PROP,
    COMPANY_G2_RELATED_PRODUCTS_DETAILS_PROP
  ];

  const [companies, ownersMap, portalId] = await Promise.all([
    hubspotSearch('companies', [{ filters: [inFilter(COMPANY_SDR_OWNER_PROP, ownerIds)] }], properties),
    getAllHubSpotOwnersMap(),
    getHubSpotPortalId()
  ]);

  const perOwner = {};
  ownerIds.forEach((id) => {
    perOwner[id] = {
      ownerId: id,
      name: roster[id].name,
      region: roster[id].region,
      accountsOwned: 0,
      accountsWorked: 0,
      reachedOutContactsSum: 0,
      warm: { worked: 0, notWorked: 0, statusCounts: {} },
      thirdParty: { worked: 0, notWorked: 0, statusCounts: {} },
      displacement: { worked: 0, notWorked: 0, statusCounts: {} },
      event: { worked: 0, notWorked: 0, statusCounts: {} },
      notYetConverted: 0,
      records: []
    };
  });

  function isWorked(props) {
    const v = (props[COMPANY_WORKED_PROP] || '').trim().toLowerCase();
    return v === 'yes';
  }

  function bump(bucket, worked, lifecycleValue) {
    if (worked) {
      bucket.worked++;
      const key = lifecycleValue || 'Unknown';
      bucket.statusCounts[key] = (bucket.statusCounts[key] || 0) + 1;
    } else {
      bucket.notWorked++;
    }
  }

  companies.forEach((c) => {
    const props = c.properties;
    const ownerId = props[COMPANY_SDR_OWNER_PROP];
    const bucket = perOwner[ownerId];
    if (!bucket) return;

    const worked = isWorked(props);
    const tag = props[COMPANY_TAG_PROP];
    const lifecycle = props[COMPANY_LIFECYCLE_PROP];
    const incumbentClm = props[COMPANY_INCUMBENT_CLM_PROP];

    bucket.accountsOwned++;
    if (worked) {
      bucket.accountsWorked++;
      bucket.reachedOutContactsSum += Number(props[COMPANY_REACHED_OUT_PROP] || 0);
      if (CONVERTED_LIFECYCLE_VALUES.indexOf(lifecycle) === -1) {
        bucket.notYetConverted++;
      }
    }

    const g2BuyerIntent = (props[COMPANY_G2_BUYER_INTENT_DETAILS_PROP] || '').trim();
    const g2RelatedProducts = (props[COMPANY_G2_RELATED_PRODUCTS_DETAILS_PROP] || '').trim();
    const hasG2BuyerIntent = g2BuyerIntent !== '' && g2BuyerIntent.toLowerCase().indexOf(G2_ZERO_PAGES_VIEWED_TEXT) === -1;
    const hasG2RelatedProducts = g2RelatedProducts !== '';

    const isWarm = WARM_TAG_VALUES.indexOf(tag) !== -1;
    const isThirdParty = hasG2BuyerIntent || hasG2RelatedProducts;
    const isDisplacement = !!incumbentClm;
    const isEvent = EVENT_TAG_VALUES.indexOf(tag) !== -1;

    if (isWarm) bump(bucket.warm, worked, lifecycle);
    if (isThirdParty) bump(bucket.thirdParty, worked, lifecycle);
    if (isDisplacement) bump(bucket.displacement, worked, lifecycle);
    if (isEvent) bump(bucket.event, worked, lifecycle);

    bucket.records.push({
      id: c.id,
      name: props[COMPANY_NAME_PROP] || '(unnamed company)',
      worked,
      warm: isWarm,
      thirdParty: isThirdParty,
      displacement: isDisplacement,
      event: isEvent,
      lifecycle: lifecycle || 'Unknown',
      converted: worked && CONVERTED_LIFECYCLE_VALUES.indexOf(lifecycle) !== -1,
      domain: props.domain || '',
      icpCategory: props[COMPANY_ICP_CATEGORY_PROP] || '',
      lifecycleStage: lifecycle || '',
      sdrOwner: roster[ownerId] ? roster[ownerId].name : ownerId,
      companyOwner: ownersMap[props[COMPANY_OWNER_PROP]] || props[COMPANY_OWNER_PROP] || '',
      lastActivityDate: props[COMPANY_LAST_ACTIVITY_PROP] || '',
      allocationDate: props[COMPANY_ALLOCATION_DATE_PROP] || '',
      tagCategory: tag || ''
    });
  });

  return {
    generatedAt: new Date().toISOString(),
    portalId,
    owners: perOwner,
    regions: getRegionsInUse()
  };
}

module.exports = { buildAccountActivityPayload };
