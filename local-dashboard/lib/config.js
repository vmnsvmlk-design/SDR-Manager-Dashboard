/**
 * Central configuration: HubSpot property internal names, pipeline/stage IDs.
 * Direct port of Config.gs. If HubSpot properties change, update them here only.
 */

module.exports = {
  HUBSPOT_BASE_URL: 'https://api.hubapi.com',

  PIPELINE_ID: 'default',

  SQL_STAGE_IDS: [
    'qualifiedtobuy',
    'presentationscheduled',
    'decisionmakerboughtin',
    '10679404',
    'closedwon',
    'closedlost'
  ],

  BECAME_QUALIFIED_PROP: 'became_qualified_to_buy__sales_pipeline_',
  SCHEDULED_STAGE_ENTERED_PROP: 'hs_v2_date_entered_144930627',
  DEAL_SDR_OWNER_PROP: 'sales_owner',
  DEAL_DISQUALIFIED_REASON_PROP: 'disqualified__not_interested_reason_custom',
  JUNK_DISQUALIFIED_REASON: 'Junk Lead',

  COMPANY_SDR_OWNER_PROP: 'sdr_owner',
  COMPANY_NAME_PROP: 'name',
  COMPANY_WORKED_PROP: 'account_worked_after_allocation',
  COMPANY_REACHED_OUT_PROP: 'num_of_reached_out_contacts',
  COMPANY_TAG_PROP: 'newtags___sdr',
  COMPANY_LIFECYCLE_PROP: 'tam_bucket',
  COMPANY_INCUMBENT_CLM_PROP: 'incumbent_clm',

  WARM_TAG_VALUES: ['Warm Accounts- FY 25-26 Q2', 'Surging accounts'],
  EVENT_TAG_VALUES: ['Event Allocations'],

  COMPANY_G2_BUYER_INTENT_DETAILS_PROP: 'g2_buyer_intent_details',
  COMPANY_G2_RELATED_PRODUCTS_DETAILS_PROP: 'g2_buyer_intent_related_products_details',
  G2_ZERO_PAGES_VIEWED_TEXT: '0 pages viewed',

  CONVERTED_LIFECYCLE_VALUES: [
    'Deal in Sales Pipeline (MQL Stages)',
    'Deal in Sales Pipeline',
    'Customer/ Churned Customer'
  ],

  REGIONS: ['NAM', 'EMEA', 'APAC'],

  CONTACT_SDR_OWNER_PROP: 'sdr_from_company',
  CONTACT_COMPANY_DOMAIN_PROP: 'company_domain_name',

  ENGAGEMENT_OWNER_PROP: 'hubspot_owner_id',
  ENGAGEMENT_TIMESTAMP_PROP: 'hs_timestamp',
  CALL_DIRECTION_PROP: 'hs_call_direction',
  CALL_DIRECTION_INBOUND: 'INBOUND',
  EMAIL_DIRECTION_PROP: 'hs_email_direction',
  EMAIL_DIRECTION_OUTGOING: 'EMAIL',

  ENGAGEMENT_LOOKBACK_DAYS: 120,

  STAGE_SCHEDULED: '144930627',
  STAGE_SALES_ACCEPTED: '144930628',
  STAGE_NO_SHOW: '198705765',

  STAGE_ENTERED_SALES_ACCEPTED_PROP: 'hs_v2_date_entered_144930628',
  STAGE_ENTERED_NO_SHOW_PROP: 'hs_v2_date_entered_198705765',

  OPPORTUNITY_STAGE_IDS: [
    'qualifiedtobuy',
    'presentationscheduled',
    'decisionmakerboughtin',
    '10679404',
    '1422037570',
    '1365874062'
  ],

  DEAL_WORKED_AFTER_NO_SHOW_PROP: 'worked_after_no_show',
  DEAL_TIME_IN_CURRENT_STAGE_PROP: 'hs_v2_time_in_current_stage',

  DEAL_FINAL_LEAD_SOURCE_PROP: 'final_lead_source__for_org_reporting_',
  SQL_ALLOWED_LEAD_SOURCE_VALUES: ['Allbound', 'Pure Outbound'],

  DEAL_LEAD_SOURCE_PROP: 'lead_source_deal',
  DEAL_NAME_PROP: 'dealname',
  COMPANY_ICP_CATEGORY_PROP: 'icp_category_20',
  COMPANY_LAST_ACTIVITY_PROP: 'notes_last_updated',
  COMPANY_OWNER_PROP: 'hubspot_owner_id',
  COMPANY_ALLOCATION_DATE_PROP: 'allocation_date'
};

// STAGE_ENTERED_SCHEDULED_PROP reuses SCHEDULED_STAGE_ENTERED_PROP, same as Config.gs.
module.exports.STAGE_ENTERED_SCHEDULED_PROP = module.exports.SCHEDULED_STAGE_ENTERED_PROP;
