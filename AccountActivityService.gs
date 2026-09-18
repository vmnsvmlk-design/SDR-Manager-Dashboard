/**
 * Builds the payload for the "Account Activity" tab. Pulls every company currently
 * allocated to a tracked SDR (irrespective of allocation date - see spec point 10) ONCE,
 * and returns per-SDR raw aggregates. The client then slices/sums this by the selected
 * Region or SDR Owner filter without any extra round-trips to HubSpot.
 */
function buildAccountActivityPayload() {
  var roster = getRoster();
  var ownerIds = getAllOwnerIds();
  var ownersMap = getAllHubSpotOwnersMap();
  var properties = [
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

  var companies = hubspotSearch('companies', [{
    filters: [inFilter(COMPANY_SDR_OWNER_PROP, ownerIds)]
  }], properties);

  var perOwner = {};
  ownerIds.forEach(function (id) {
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
      records: [] // raw per-company rows, for the dashboard's click-through drill-down
    };
  });

  function isWorked(props) {
    var v = (props[COMPANY_WORKED_PROP] || '').trim().toLowerCase();
    return v === 'yes';
  }

  function bump(bucket, worked, lifecycleValue) {
    if (worked) {
      bucket.worked++;
      var key = lifecycleValue || 'Unknown';
      bucket.statusCounts[key] = (bucket.statusCounts[key] || 0) + 1;
    } else {
      bucket.notWorked++;
    }
  }

  companies.forEach(function (c) {
    var props = c.properties;
    var ownerId = props[COMPANY_SDR_OWNER_PROP];
    var bucket = perOwner[ownerId];
    if (!bucket) return; // not one of our tracked SDRs

    var worked = isWorked(props);
    var tag = props[COMPANY_TAG_PROP];
    var lifecycle = props[COMPANY_LIFECYCLE_PROP];
    var incumbentClm = props[COMPANY_INCUMBENT_CLM_PROP];

    bucket.accountsOwned++;
    if (worked) {
      bucket.accountsWorked++;
      bucket.reachedOutContactsSum += Number(props[COMPANY_REACHED_OUT_PROP] || 0);
      if (CONVERTED_LIFECYCLE_VALUES.indexOf(lifecycle) === -1) {
        bucket.notYetConverted++;
      }
    }

    var g2BuyerIntent = (props[COMPANY_G2_BUYER_INTENT_DETAILS_PROP] || '').trim();
    var g2RelatedProducts = (props[COMPANY_G2_RELATED_PRODUCTS_DETAILS_PROP] || '').trim();
    var hasG2BuyerIntent = g2BuyerIntent !== '' && g2BuyerIntent.toLowerCase().indexOf(G2_ZERO_PAGES_VIEWED_TEXT) === -1;
    var hasG2RelatedProducts = g2RelatedProducts !== '';

    var isWarm = WARM_TAG_VALUES.indexOf(tag) !== -1;
    var isThirdParty = hasG2BuyerIntent || hasG2RelatedProducts;
    var isDisplacement = !!incumbentClm;
    var isEvent = EVENT_TAG_VALUES.indexOf(tag) !== -1;

    if (isWarm) bump(bucket.warm, worked, lifecycle);
    if (isThirdParty) bump(bucket.thirdParty, worked, lifecycle);
    if (isDisplacement) bump(bucket.displacement, worked, lifecycle);
    if (isEvent) bump(bucket.event, worked, lifecycle);

    bucket.records.push({
      id: c.id,
      name: props[COMPANY_NAME_PROP] || '(unnamed company)',
      worked: worked,
      warm: isWarm,
      thirdParty: isThirdParty,
      displacement: isDisplacement,
      event: isEvent,
      lifecycle: lifecycle || 'Unknown',
      converted: worked && CONVERTED_LIFECYCLE_VALUES.indexOf(lifecycle) !== -1,
      // Extra columns shown only in the drill-down modal table, not used for chart math.
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
    portalId: getHubSpotPortalId(),
    owners: perOwner,
    regions: getRegionsInUse()
  };
}
