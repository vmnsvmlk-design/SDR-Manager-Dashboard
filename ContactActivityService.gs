/**
 * Builds the payload for the "Contact Activity" tab: for each SDR, how many contacts THEY
 * OWN (per "SDR owner (Contact)") they have personally called / emailed - split into "last
 * 7 days" and "all-time, bucketed by the week of each contact's most recent touch".
 *
 * A call/email only counts if the person who logged it ("Activity assigned to") is the
 * SAME person as that contact's own SDR owner - a call an AE or a different SDR made on
 * someone else's contact is excluded, per spec.
 *
 * "Activity date does not matter" per spec, but engagement history is capped to
 * ENGAGEMENT_LOOKBACK_DAYS (Config.gs) to keep load times reasonable on an active team -
 * raise that constant for a longer look-back at the cost of a slower load.
 */
function buildContactActivityPayload() {
  var roster = getRoster();
  var ownerIds = getAllOwnerIds();
  var portalId = getHubSpotPortalId();
  var now = new Date();
  var lookbackStart = new Date(now.getTime() - ENGAGEMENT_LOOKBACK_DAYS * 86400000);
  var sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  var calls = fetchEngagementsInWindow_('calls', CALL_DIRECTION_PROP, CALL_DIRECTION_OUTBOUND, ownerIds, lookbackStart, now);
  var emails = fetchEngagementsInWindow_('emails', EMAIL_DIRECTION_PROP, EMAIL_DIRECTION_OUTGOING, ownerIds, lookbackStart, now);

  var owners = {};
  ownerIds.forEach(function (id) { owners[id] = { ownerId: id, name: roster[id].name, region: roster[id].region }; });

  return {
    generatedAt: new Date().toISOString(),
    portalId: portalId,
    lookbackDays: ENGAGEMENT_LOOKBACK_DAYS,
    regions: getRegionsInUse(),
    owners: owners,
    calls: aggregateEngagements_(calls, 'calls', ownerIds, roster, sevenDaysAgo),
    emails: aggregateEngagements_(emails, 'emails', ownerIds, roster, sevenDaysAgo)
  };
}

function fetchEngagementsInWindow_(objectType, directionProp, directionValue, ownerIds, start, end) {
  var filters = [
    eqFilter(directionProp, directionValue),
    inFilter(ENGAGEMENT_OWNER_PROP, ownerIds),
    dateFilter(ENGAGEMENT_TIMESTAMP_PROP, start, end)
  ];
  return hubspotSearch(objectType, [{ filters: filters }], [ENGAGEMENT_OWNER_PROP, ENGAGEMENT_TIMESTAMP_PROP]);
}

function aggregateEngagements_(engagements, objectType, ownerIds, roster, sevenDaysAgo) {
  var perOwner = {};
  ownerIds.forEach(function (id) { perOwner[id] = { last7Days: 0, allTime: 0, weekly: {}, records: [] }; });

  if (!engagements.length) return perOwner;

  // Resolve each engagement's associated contact.
  var engagementIds = engagements.map(function (e) { return e.id; });
  var contactIdByEngagement = batchGetFirstAssociation(objectType, 'contacts', engagementIds);

  // Collapse to one row per (owner, contact) pair: the timestamp of their MOST RECENT touch.
  // (This is what makes "40 all-time, 5 of them only in the last 7 days" work out: a
  // contact who was called both 3 weeks ago and yesterday is attributed to yesterday's week.)
  var lastTouch = {};
  engagements.forEach(function (e) {
    var ownerId = e.properties[ENGAGEMENT_OWNER_PROP];
    var contactId = contactIdByEngagement[e.id];
    if (!ownerId || !contactId || !roster[ownerId]) return;
    var ts = new Date(e.properties[ENGAGEMENT_TIMESTAMP_PROP]).getTime();
    var key = ownerId + '|' + contactId;
    if (!lastTouch[key] || ts > lastTouch[key].ts) {
      lastTouch[key] = { ts: ts, ownerId: ownerId, contactId: contactId };
    }
  });

  var pairs = Object.keys(lastTouch).map(function (k) { return lastTouch[k]; });
  if (!pairs.length) return perOwner;

  var contactIds = pairs.reduce(function (acc, p) {
    if (acc.indexOf(p.contactId) === -1) acc.push(p.contactId);
    return acc;
  }, []);
  var contactsById = batchGetObjects('contacts', contactIds,
    [CONTACT_SDR_OWNER_PROP, 'firstname', 'lastname', 'email', CONTACT_COMPANY_DOMAIN_PROP]);

  pairs.forEach(function (p) {
    var contact = contactsById[p.contactId];
    if (!contact) return;
    // "activity assignee is the same as the SDR Owner (Contact)" - exclude cross-assigned touches.
    if (contact.properties[CONTACT_SDR_OWNER_PROP] !== p.ownerId) return;

    var bucket = perOwner[p.ownerId];
    if (!bucket) return;

    bucket.allTime++;
    var weekKey = isoWeekKey(new Date(p.ts));
    bucket.weekly[weekKey] = (bucket.weekly[weekKey] || 0) + 1;
    if (p.ts >= sevenDaysAgo.getTime()) bucket.last7Days++;

    bucket.records.push({
      id: p.contactId,
      name: ((contact.properties.firstname || '') + ' ' + (contact.properties.lastname || '')).trim() || '(unnamed contact)',
      firstName: contact.properties.firstname || '',
      lastName: contact.properties.lastname || '',
      email: contact.properties.email || '',
      companyDomain: contact.properties[CONTACT_COMPANY_DOMAIN_PROP] || '',
      lastTouch: new Date(p.ts).toISOString(),
      weekKey: weekKey
    });
  });

  return perOwner;
}
