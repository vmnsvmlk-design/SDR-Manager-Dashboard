/**
 * Central configuration: HubSpot property internal names, pipeline/stage IDs, tag rules.
 * If HubSpot properties change, update them here only.
 */

module.exports = {
  HUBSPOT_BASE_URL: 'https://api.hubapi.com',

  PIPELINE_ID: 'default',

  REGIONS: ['NAM', 'EMEA', 'APAC'],

  // ---- deals ----
  DEAL_SDR_OWNER_PROP: 'sales_owner',
  DEAL_NAME_PROP: 'dealname',
  DEAL_LEAD_SOURCE_PROP: 'lead_source_deal',
  DEAL_FINAL_LEAD_SOURCE_PROP: 'final_lead_source__for_org_reporting_',
  DEAL_DISQUALIFIED_REASON_PROP: 'disqualified__not_interested_reason_custom',
  JUNK_DISQUALIFIED_REASON: 'Junk Lead',
  DEAL_WORKED_AFTER_NO_SHOW_PROP: 'worked_after_no_show',
  // Ageing is computed as now minus this date (hs_v2_time_in_current_stage comes back from the API
  // as a timestamp, not a duration, so it can't be used directly).
  DEAL_DATE_ENTERED_CURRENT_STAGE_PROP: 'hs_v2_date_entered_current_stage',

  // "Opportunities created" = Became Qualified to Buy Date set, deal currently in one of these stages:
  // Qualified to buy, Presentation done, Proposal Shared / Negotiations, Contracting, Closed won,
  // Closed lost, Debook, Deal Desk Verified Closed Won.
  BECAME_QUALIFIED_PROP: 'became_qualified_to_buy__sales_pipeline_',
  OPPORTUNITY_STAGE_IDS: [
    'qualifiedtobuy',
    'presentationscheduled',
    'decisionmakerboughtin',
    '10679404',
    'closedwon',
    'closedlost',
    '1422037570',
    '1365874062'
  ],
  // "Revenue" = won deals (Closed won, Deal Desk Verified Closed Won), dated by Close Date and
  // summed on Annual Subscription Fee $ (USD). Open deals carry forecast values in that field,
  // so they are deliberately left out.
  DEAL_CLOSE_DATE_PROP: 'closedate',
  DEAL_REVENUE_PROP: 'annual_license_fee__',
  WON_STAGE_IDS: ['closedwon', '1365874062'],
  // "Allbound + Outbound" opportunities additionally require one of these Final Lead Sources.
  ALLBOUND_OUTBOUND_LEAD_SOURCE_VALUES: ['Allbound', 'Pure Outbound'],

  STAGE_SCHEDULED: '144930627',
  STAGE_SALES_ACCEPTED: '144930628',
  STAGE_NO_SHOW: '198705765',
  STAGE_ENTERED_SCHEDULED_PROP: 'hs_v2_date_entered_144930627', // "Meetings booked"
  STAGE_ENTERED_SALES_ACCEPTED_PROP: 'hs_v2_date_entered_144930628',

  // ---- companies ----
  COMPANY_SDR_OWNER_PROP: 'sdr_owner',
  COMPANY_NAME_PROP: 'name',
  COMPANY_WORKED_PROP: 'account_worked_after_allocation',
  COMPANY_TAG_PROP: 'newtags___sdr', // "TAGS- SDR Categories"
  COMPANY_LIFECYCLE_PROP: 'tam_bucket',
  COMPANY_ICP_CATEGORY_PROP: 'icp_category_20',
  COMPANY_LAST_ACTIVITY_PROP: 'notes_last_updated',
  COMPANY_OWNER_PROP: 'hubspot_owner_id',
  COMPANY_ALLOCATION_DATE_PROP: 'allocation_date',

  // Tag rules for "TAGS- SDR Categories". Keywords match the option's stored value OR its label
  // as shown in HubSpot (case-insensitive), e.g. "Warm Event Accounts" (stored as
  // "Event Allocations") counts as both warm and event.
  THIRD_PARTY_TAG_VALUES: ['3rd Party Signals'],
  WARM_TAG_KEYWORDS: ['warm'],
  WARM_EXTRA_TAG_VALUES: ['Surging accounts'],
  EVENT_TAG_KEYWORDS: ['event'],

  // Lifecycle (custom) values that count as "converted to a meeting".
  CONVERTED_LIFECYCLE_VALUES: [
    'Deal in Sales Pipeline (MQL Stages)',
    'Deal in Sales Pipeline',
    'Customer/ Churned Customer'
  ],

  // ---- contacts ----
  CONTACT_SDR_OWNER_PROP: 'sdr_from_company',
  CONTACT_COMPANY_DOMAIN_PROP: 'company_domain_name',
  CONTACT_PRIMARY_COMPANY_PROP: 'associatedcompanyid',

  // ---- engagements (calls, emails, LinkedIn messages) ----
  ENGAGEMENT_OWNER_PROP: 'hubspot_owner_id', // "Activity assigned to"
  ENGAGEMENT_TIMESTAMP_PROP: 'hs_timestamp',
  CALL_DIRECTION_PROP: 'hs_call_direction',
  CALL_DIRECTION_INBOUND: 'INBOUND', // most calls never get a direction, so exclude only INBOUND
  EMAIL_DIRECTION_PROP: 'hs_email_direction',
  EMAIL_DIRECTION_OUTGOING: 'EMAIL',
  // LinkedIn InMails synced by HubSpot's built-in LinkedIn Sales Navigator integration are
  // logged as "communications" with this channel type.
  COMMUNICATION_CHANNEL_PROP: 'hs_communication_channel_type',
  LINKEDIN_CHANNEL_VALUE: 'LINKEDIN_MESSAGE',

  // Server-side cache lifetime for each tab's HubSpot data. The server re-pulls everything in the
  // background every 20 minutes (server.js), so this only matters if that loop falls behind.
  CACHE_TTL_SECONDS: 30 * 60
};
