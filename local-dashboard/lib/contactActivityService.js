/**
 * Builds the payload for the "Contact Activity" tab. Direct port of ContactActivityService.gs,
 * including both fixes discovered debugging the live dashboard:
 *  - calls use NEQ INBOUND rather than EQ OUTBOUND (most calls never get a direction logged)
 *  - one search per SDR rather than one combined search (HubSpot's search API hard-caps any
 *    single search at 10,000 results and will not paginate past it)
 * Unlike Apps Script, the per-SDR searches below run concurrently via Promise.all.
 */

const {
  ENGAGEMENT_LOOKBACK_DAYS, ENGAGEMENT_OWNER_PROP, ENGAGEMENT_TIMESTAMP_PROP,
  CALL_DIRECTION_PROP, CALL_DIRECTION_INBOUND, EMAIL_DIRECTION_PROP, EMAIL_DIRECTION_OUTGOING,
  CONTACT_SDR_OWNER_PROP, CONTACT_COMPANY_DOMAIN_PROP
} = require('./config');
const {
  hubspotSearch, batchGetFirstAssociation, batchGetObjects, getHubSpotPortalId,
  dateFilter, eqFilter, neqFilter
} = require('./hubspot');
const { isoWeekKey } = require('./fiscalQuarter');
const { getRoster, getAllOwnerIds, getRegionsInUse } = require('./roster');

async function buildContactActivityPayload() {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();
  const now = new Date();
  const lookbackStart = new Date(now.getTime() - ENGAGEMENT_LOOKBACK_DAYS * 86400000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);

  const [portalId, calls, emails] = await Promise.all([
    getHubSpotPortalId(),
    fetchEngagementsInWindow('calls', neqFilter(CALL_DIRECTION_PROP, CALL_DIRECTION_INBOUND), ownerIds, lookbackStart, now),
    fetchEngagementsInWindow('emails', eqFilter(EMAIL_DIRECTION_PROP, EMAIL_DIRECTION_OUTGOING), ownerIds, lookbackStart, now)
  ]);

  const owners = {};
  ownerIds.forEach((id) => { owners[id] = { ownerId: id, name: roster[id].name, region: roster[id].region }; });

  const [callsAgg, emailsAgg] = await Promise.all([
    aggregateEngagements(calls, 'calls', ownerIds, roster, sevenDaysAgo),
    aggregateEngagements(emails, 'emails', ownerIds, roster, sevenDaysAgo)
  ]);

  return {
    generatedAt: new Date().toISOString(),
    portalId,
    lookbackDays: ENGAGEMENT_LOOKBACK_DAYS,
    regions: getRegionsInUse(),
    owners,
    calls: callsAgg,
    emails: emailsAgg
  };
}

// One search per SDR, run concurrently, rather than one IN-filter search across all of them -
// see the comment in ContactActivityService.gs for why (HubSpot's 10,000-result search cap).
async function fetchEngagementsInWindow(objectType, directionFilter, ownerIds, start, end) {
  const perOwnerResults = await Promise.all(ownerIds.map((ownerId) => {
    const filters = [
      directionFilter,
      eqFilter(ENGAGEMENT_OWNER_PROP, ownerId),
      dateFilter(ENGAGEMENT_TIMESTAMP_PROP, start, end)
    ];
    return hubspotSearch(objectType, [{ filters }], [ENGAGEMENT_OWNER_PROP, ENGAGEMENT_TIMESTAMP_PROP]);
  }));
  return perOwnerResults.reduce((all, r) => all.concat(r), []);
}

async function aggregateEngagements(engagements, objectType, ownerIds, roster, sevenDaysAgo) {
  const perOwner = {};
  ownerIds.forEach((id) => { perOwner[id] = { last7Days: 0, allTime: 0, weekly: {}, records: [] }; });

  if (!engagements.length) return perOwner;

  const engagementIds = engagements.map((e) => e.id);
  const contactIdByEngagement = await batchGetFirstAssociation(objectType, 'contacts', engagementIds);

  const lastTouch = {};
  engagements.forEach((e) => {
    const ownerId = e.properties[ENGAGEMENT_OWNER_PROP];
    const contactId = contactIdByEngagement[e.id];
    if (!ownerId || !contactId || !roster[ownerId]) return;
    const ts = new Date(e.properties[ENGAGEMENT_TIMESTAMP_PROP]).getTime();
    const key = ownerId + '|' + contactId;
    if (!lastTouch[key] || ts > lastTouch[key].ts) {
      lastTouch[key] = { ts, ownerId, contactId };
    }
  });

  const pairs = Object.keys(lastTouch).map((k) => lastTouch[k]);
  if (!pairs.length) return perOwner;

  const contactIds = pairs.reduce((acc, p) => {
    if (acc.indexOf(p.contactId) === -1) acc.push(p.contactId);
    return acc;
  }, []);
  const contactsById = await batchGetObjects('contacts', contactIds,
    [CONTACT_SDR_OWNER_PROP, 'firstname', 'lastname', 'email', CONTACT_COMPANY_DOMAIN_PROP]);

  pairs.forEach((p) => {
    const contact = contactsById[p.contactId];
    if (!contact) return;
    if (contact.properties[CONTACT_SDR_OWNER_PROP] !== p.ownerId) return;

    const bucket = perOwner[p.ownerId];
    if (!bucket) return;

    bucket.allTime++;
    const weekKey = isoWeekKey(new Date(p.ts));
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
      weekKey
    });
  });

  return perOwner;
}

module.exports = { buildContactActivityPayload };
