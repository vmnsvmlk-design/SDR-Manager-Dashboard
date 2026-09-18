/**
 * Builds the payload for the "Account Activity" tab. Pulls every company currently
 * allocated to a tracked SDR (irrespective of allocation date - see spec point 10) ONCE,
 * and returns per-SDR raw aggregates. The client then slices/sums this by the selected
 * Region or SDR Owner filter without any extra round-trips to HubSpot.
 */
function buildAccountActivityPayload() {
  var ownerIds = getAllOwnerIds();
  var properties = [
    COMPANY_SDR_OWNER_PROP,
    COMPANY_WORKED_PROP,
    COMPANY_REACHED_OUT_PROP,
    COMPANY_TAG_PROP,
    COMPANY_LIFECYCLE_PROP,
    COMPANY_INCUMBENT_CLM_PROP
  ];

  var companies = hubspotSearch('companies', [{
    filters: [inFilter(COMPANY_SDR_OWNER_PROP, ownerIds)]
  }], properties);

  var perOwner = {};
  ownerIds.forEach(function (id) {
    perOwner[id] = {
      ownerId: id,
      name: SDR_ROSTER[id].name,
      region: SDR_ROSTER[id].region,
      accountsOwned: 0,
      accountsWorked: 0,
      reachedOutContactsSum: 0,
      warm: { worked: 0, notWorked: 0, statusCounts: {} },
      thirdParty: { worked: 0, notWorked: 0, statusCounts: {} },
      displacement: { worked: 0, notWorked: 0, statusCounts: {} },
      event: { worked: 0, notWorked: 0, statusCounts: {} },
      notYetConverted: 0
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

    if (WARM_TAG_VALUES.indexOf(tag) !== -1) bump(bucket.warm, worked, lifecycle);
    if (THIRD_PARTY_TAG_VALUES.indexOf(tag) !== -1) bump(bucket.thirdParty, worked, lifecycle);
    if (incumbentClm) bump(bucket.displacement, worked, lifecycle);
    if (EVENT_TAG_VALUES.indexOf(tag) !== -1) bump(bucket.event, worked, lifecycle);
  });

  return { generatedAt: new Date().toISOString(), owners: perOwner, regions: REGIONS };
}
