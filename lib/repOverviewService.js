/**
 * Builds the payload for the "Rep Overview" tab for one granularity (week / month / quarter).
 *
 * Contact metrics (reached out / emailed / LinkedIn / called):
 *   a contact counts in a period if the SDR logged an outgoing call, outgoing email or LinkedIn
 *   message against them in that period (by "Activity assigned to"), AND the contact's own
 *   SDR owner (Contact) is that same SDR. A contact touched in two periods counts in both.
 * Account metrics (3rd party / warm / event accounts with activity):
 *   the companies (primary company of those same contacts) whose TAGS- SDR Categories matches,
 *   counted in every period they had such activity.
 * Deal metrics (meetings booked / sales accepted / opportunities / allbound+outbound opps):
 *   deals by SDR Owner (Deal), bucketed by the date of the stage/qualification event.
 *
 * Engagements are fetched one SDR at a time (and one time window at a time if a single SDR has
 * more than HubSpot's 10,000-result search cap) - see searchInWindow in hubspot.js.
 */

const {
  ENGAGEMENT_OWNER_PROP, ENGAGEMENT_TIMESTAMP_PROP,
  CALL_DIRECTION_PROP, CALL_DIRECTION_INBOUND, EMAIL_DIRECTION_PROP, EMAIL_DIRECTION_OUTGOING,
  COMMUNICATION_CHANNEL_PROP, LINKEDIN_CHANNEL_VALUE,
  CONTACT_SDR_OWNER_PROP, CONTACT_COMPANY_DOMAIN_PROP, CONTACT_PRIMARY_COMPANY_PROP,
  COMPANY_NAME_PROP, COMPANY_TAG_PROP, COMPANY_SDR_OWNER_PROP,
  BECAME_QUALIFIED_PROP, STAGE_ENTERED_SCHEDULED_PROP, STAGE_ENTERED_SALES_ACCEPTED_PROP,
  OPPORTUNITY_STAGE_IDS, DEAL_SDR_OWNER_PROP, CACHE_TTL_SECONDS
} = require('./config');
const {
  searchInWindow, searchDealsInWindow, batchGetAssociations, batchGetObjects, cached,
  getHubSpotPortalId, getAllHubSpotOwnersMap, getPropertyOptionLabels, eqFilter, neqFilter, inFilter
} = require('./hubspot');
const { getReportingPeriods, periodKeyFor } = require('./fiscalQuarter');
const { REGIONS, getRoster, getAllOwnerIds, getOwnersPayload } = require('./roster');
const { DEAL_PROPERTIES, isJunk, isAllboundOrOutbound, toDealRecord, classifyTags } = require('./records');

const CHANNELS = [
  { key: 'called', objectType: 'calls', label: 'Call', filter: neqFilter(CALL_DIRECTION_PROP, CALL_DIRECTION_INBOUND) },
  { key: 'emailed', objectType: 'emails', label: 'Email', filter: eqFilter(EMAIL_DIRECTION_PROP, EMAIL_DIRECTION_OUTGOING) },
  { key: 'linkedin', objectType: 'communications', label: 'LinkedIn', filter: eqFilter(COMMUNICATION_CHANNEL_PROP, LINKEDIN_CHANNEL_VALUE) }
];
const ACCOUNT_CATEGORIES = ['thirdParty', 'warm', 'event'];

function buildRepOverviewPayload(granularity, forceRefresh) {
  granularity = granularity || 'week';
  return cached('rep-overview:' + granularity, CACHE_TTL_SECONDS, () => build(granularity), forceRefresh);
}

async function build(granularity) {
  const roster = getRoster();
  const ownerIds = getAllOwnerIds();
  const periods = getReportingPeriods(granularity);
  const start = periods[0].start;
  const end = periods[periods.length - 1].end;
  const warnings = [];

  const [portalId, ownersMap, tagLabels, engagementsByChannel, deals] = await Promise.all([
    getHubSpotPortalId(),
    getAllHubSpotOwnersMap(),
    getPropertyOptionLabels('companies', COMPANY_TAG_PROP),
    Promise.all(CHANNELS.map((ch) => fetchChannel(ch, ownerIds, start, end).catch((err) => {
      // One channel failing (e.g. a token without the communications scope) shouldn't blank the tab.
      warnings.push(ch.label + ' activity could not be loaded: ' + err.message);
      return [];
    }))),
    fetchDeals(ownerIds, start, end)
  ]);

  // ---- contact + account activity ----
  const associations = await Promise.all(CHANNELS.map((ch, i) =>
    batchGetAssociations(ch.objectType, 'contacts', engagementsByChannel[i].map((e) => e.id))));

  const contactIdSet = {};
  associations.forEach((map) => Object.keys(map).forEach((k) => map[k].forEach((cid) => { contactIdSet[cid] = true; })));
  const contactsById = await batchGetObjects('contacts', Object.keys(contactIdSet), [
    CONTACT_SDR_OWNER_PROP, 'firstname', 'lastname', 'email', CONTACT_COMPANY_DOMAIN_PROP, CONTACT_PRIMARY_COMPANY_PROP
  ]);

  // touches[owner][period][contactId] = { lastTouch, channels: { called, emailed, linkedin } }
  const touches = {};
  ownerIds.forEach((id) => { touches[id] = {}; });

  CHANNELS.forEach((ch, i) => {
    engagementsByChannel[i].forEach((e) => {
      const ownerId = e.properties[ENGAGEMENT_OWNER_PROP];
      if (!touches[ownerId]) return;
      const ts = new Date(e.properties[ENGAGEMENT_TIMESTAMP_PROP]).getTime();
      const periodKey = periodKeyFor(periods, ts);
      if (!periodKey) return;
      (associations[i][e.id] || []).forEach((contactId) => {
        const contact = contactsById[contactId];
        if (!contact || contact.properties[CONTACT_SDR_OWNER_PROP] !== ownerId) return;
        const byPeriod = touches[ownerId][periodKey] = touches[ownerId][periodKey] || {};
        const t = byPeriod[contactId] = byPeriod[contactId] || { lastTouch: 0, channels: {} };
        if (ts > t.lastTouch) t.lastTouch = ts;
        t.channels[ch.key] = true;
      });
    });
  });

  const companyIdSet = {};
  Object.keys(touches).forEach((o) => Object.keys(touches[o]).forEach((p) => Object.keys(touches[o][p]).forEach((cid) => {
    const companyId = contactsById[cid].properties[CONTACT_PRIMARY_COMPANY_PROP];
    if (companyId) companyIdSet[companyId] = true;
  })));
  const companiesById = await batchGetObjects('companies', Object.keys(companyIdSet), [COMPANY_NAME_PROP, 'domain', COMPANY_TAG_PROP, COMPANY_SDR_OWNER_PROP]);

  const activity = { reached: {}, called: {}, emailed: {}, linkedin: {} };
  const accounts = { thirdParty: {}, warm: {}, event: {} };
  ownerIds.forEach((o) => {
    Object.keys(activity).forEach((k) => { activity[k][o] = {}; });
    ACCOUNT_CATEGORIES.forEach((k) => { accounts[k][o] = {}; });

    Object.keys(touches[o]).forEach((p) => {
      const companyTouches = {};
      Object.keys(touches[o][p]).forEach((cid) => {
        const t = touches[o][p][cid];
        const channels = Object.keys(t.channels);
        const row = { id: cid, lastTouch: new Date(t.lastTouch).toISOString(), channels };
        (activity.reached[o][p] = activity.reached[o][p] || []).push(row);
        channels.forEach((ch) => { (activity[ch][o][p] = activity[ch][o][p] || []).push(row); });

        const companyId = contactsById[cid].properties[CONTACT_PRIMARY_COMPANY_PROP];
        if (!companyId || !companiesById[companyId]) return;
        const c = companyTouches[companyId] = companyTouches[companyId] || { id: companyId, lastTouch: 0, contacts: 0 };
        c.contacts++;
        if (t.lastTouch > c.lastTouch) c.lastTouch = t.lastTouch;
      });

      Object.keys(companyTouches).forEach((companyId) => {
        const tags = classifyTags(companiesById[companyId].properties[COMPANY_TAG_PROP], tagLabels);
        const c = companyTouches[companyId];
        const row = { id: companyId, lastTouch: new Date(c.lastTouch).toISOString(), contacts: c.contacts };
        ACCOUNT_CATEGORIES.forEach((k) => { if (tags[k]) (accounts[k][o][p] = accounts[k][o][p] || []).push(row); });
      });
    });
  });

  // Directories so per-period rows above can stay small (ids only).
  const contacts = {};
  Object.keys(contactsById).forEach((cid) => {
    const p = contactsById[cid].properties;
    const companyId = p[CONTACT_PRIMARY_COMPANY_PROP];
    contacts[cid] = {
      name: ((p.firstname || '') + ' ' + (p.lastname || '')).trim() || '(unnamed contact)',
      email: p.email || '',
      companyDomain: p[CONTACT_COMPANY_DOMAIN_PROP] || '',
      companyName: companyId && companiesById[companyId] ? (companiesById[companyId].properties[COMPANY_NAME_PROP] || '') : ''
    };
  });
  const companies = {};
  Object.keys(companiesById).forEach((id) => {
    const p = companiesById[id].properties;
    companies[id] = {
      name: p[COMPANY_NAME_PROP] || '(unnamed company)',
      domain: p.domain || '',
      tagCategory: tagLabels[p[COMPANY_TAG_PROP]] || p[COMPANY_TAG_PROP] || '',
      sdrOwner: roster[p[COMPANY_SDR_OWNER_PROP]] ? roster[p[COMPANY_SDR_OWNER_PROP]].name : (ownersMap[p[COMPANY_SDR_OWNER_PROP]] || '')
    };
  });

  // ---- deal metrics ----
  function bucketDeals(list, dateProp) {
    const byOwner = {};
    ownerIds.forEach((o) => { byOwner[o] = {}; });
    list.forEach((d) => {
      const rec = toDealRecord(d, roster, ownersMap, dateProp);
      if (!byOwner[rec.ownerId] || !rec.date) return;
      const p = periodKeyFor(periods, new Date(rec.date).getTime());
      if (!p) return;
      (byOwner[rec.ownerId][p] = byOwner[rec.ownerId][p] || []).push(rec);
    });
    return byOwner;
  }
  const dealMetrics = {
    meetings: bucketDeals(deals.meetings.filter((d) => !isJunk(d)), STAGE_ENTERED_SCHEDULED_PROP),
    salesAccepted: bucketDeals(deals.salesAccepted.filter((d) => !isJunk(d)), STAGE_ENTERED_SALES_ACCEPTED_PROP),
    opps: bucketDeals(deals.opps, BECAME_QUALIFIED_PROP),
    allboundOpps: bucketDeals(deals.opps.filter(isAllboundOrOutbound), BECAME_QUALIFIED_PROP)
  };

  return {
    generatedAt: new Date().toISOString(),
    portalId,
    granularity,
    periods: periods.map((p) => ({ key: p.key, label: p.label, start: p.start.toISOString(), end: p.end.toISOString() })),
    regions: REGIONS,
    owners: getOwnersPayload(),
    warnings,
    activity,
    accounts,
    deals: dealMetrics,
    contacts,
    companies
  };
}

async function fetchChannel(channel, ownerIds, start, end) {
  const perOwner = await Promise.all(ownerIds.map((ownerId) => searchInWindow(
    channel.objectType,
    [channel.filter, eqFilter(ENGAGEMENT_OWNER_PROP, ownerId)],
    ENGAGEMENT_TIMESTAMP_PROP, start, end,
    [ENGAGEMENT_OWNER_PROP, ENGAGEMENT_TIMESTAMP_PROP]
  )));
  return perOwner.reduce((all, list) => all.concat(list), []);
}

async function fetchDeals(ownerIds, start, end) {
  const [meetings, salesAccepted, opps] = await Promise.all([
    searchDealsInWindow(STAGE_ENTERED_SCHEDULED_PROP, start, end, ownerIds, [], DEAL_PROPERTIES.concat([STAGE_ENTERED_SCHEDULED_PROP])),
    searchDealsInWindow(STAGE_ENTERED_SALES_ACCEPTED_PROP, start, end, ownerIds, [], DEAL_PROPERTIES.concat([STAGE_ENTERED_SALES_ACCEPTED_PROP])),
    searchDealsInWindow(BECAME_QUALIFIED_PROP, start, end, ownerIds, [inFilter('dealstage', OPPORTUNITY_STAGE_IDS)], DEAL_PROPERTIES.concat([BECAME_QUALIFIED_PROP]))
  ]);
  const onRoster = (d) => ownerIds.indexOf(d.properties[DEAL_SDR_OWNER_PROP]) !== -1;
  return { meetings: meetings.filter(onRoster), salesAccepted: salesAccepted.filter(onRoster), opps: opps.filter(onRoster) };
}

module.exports = { buildRepOverviewPayload };
