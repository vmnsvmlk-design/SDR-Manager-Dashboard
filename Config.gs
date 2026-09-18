/**
 * Central configuration: HubSpot property internal names, pipeline/stage IDs,
 * and the SDR roster. Confirmed against the live HubSpot portal schema at build time -
 * if HubSpot properties or your team roster change, update them here only.
 */

var HUBSPOT_BASE_URL = 'https://api.hubapi.com';

// "Sales Pipeline" pipeline id for deals.
var PIPELINE_ID = 'default';

// Deal stages (Sales Pipeline) that count as an SQL/opportunity for the leaderboard + Total SQLs tile:
// Qualified to buy, Presentation done, Proposal Shared / Negotiations, Contracting (New Business),
// Closed won, Closed lost.
var SQL_STAGE_IDS = [
  'qualifiedtobuy',
  'presentationscheduled',
  'decisionmakerboughtin',
  '10679404',
  'closedwon',
  'closedlost'
];

// Deal property: "Became Qualified to Buy Date (Sales Pipeline)"
var BECAME_QUALIFIED_PROP = 'became_qualified_to_buy__sales_pipeline_';

// Deal property: date the deal entered the "Scheduled (Sales Pipeline)" stage - used for the Meetings tile.
var SCHEDULED_STAGE_ENTERED_PROP = 'hs_v2_date_entered_144930627';

// Deal property: "SDR Owner (Deal)" (a HubSpot owner-reference property, value = ownerId).
var DEAL_SDR_OWNER_PROP = 'sales_owner';

// Deal property: "Disqualified/ Not Interested Reason Custom"
var DEAL_DISQUALIFIED_REASON_PROP = 'disqualified__not_interested_reason_custom';

// Closest matching dropdown option to "junk deal" ("Junk Lead" is the actual stored value).
// Double-check this is the intended value for your team.
var JUNK_DISQUALIFIED_REASON = 'Junk Lead';

// Company property: "SDR Owner (Company)" (owner-reference property, value = ownerId).
var COMPANY_SDR_OWNER_PROP = 'sdr_owner';

// Company property: record name, used only for the click-through drill-down list.
var COMPANY_NAME_PROP = 'name';

// Company property: "Account worked after Allocation?" (free-text; "Yes"/"yes" mean worked).
var COMPANY_WORKED_PROP = 'account_worked_after_allocation';

// Company property: "Num of reached out contacts"
var COMPANY_REACHED_OUT_PROP = 'num_of_reached_out_contacts';

// Company property: "TAGS- SDR Categories"
var COMPANY_TAG_PROP = 'newtags___sdr';

// Company property: "Lifecycle Stage (Custom)"
var COMPANY_LIFECYCLE_PROP = 'tam_bucket';

// Company property: "Incumbent CLM"
var COMPANY_INCUMBENT_CLM_PROP = 'incumbent_clm';

// Exact stored VALUES (not the display labels!) for TAGS- SDR Categories.
// NOTE: "Warm Accounts" is stored with a quarter baked into the value
// ("Warm Accounts- FY 25-26 Q2"). Re-check this in HubSpot
// (Settings > Properties > Company > TAGS- SDR Categories) if your team creates a
// new dated option for the current fiscal year/quarter - this list will need the new value added.
var WARM_TAG_VALUES = ['Warm Accounts- FY 25-26 Q2', 'Surging accounts'];
var THIRD_PARTY_TAG_VALUES = ['3rd Party Signals'];
var EVENT_TAG_VALUES = ['Event Allocations'];

// Exact stored VALUES for Lifecycle Stage (Custom) that count as "converted to a meeting"
// (Marketing Qualified Account, Opportunity, Current Customer).
var CONVERTED_LIFECYCLE_VALUES = [
  'Deal in Sales Pipeline (MQL Stages)',
  'Deal in Sales Pipeline',
  'Customer/ Churned Customer'
];

// Seed SDR roster: HubSpot ownerId (string) -> { name, region }. Used ONLY the first time
// the app runs, to populate the Roster Google Sheet (see RosterService.gs). After that,
// the Sheet is the source of truth - edit rosters/regions on the Inputs tab or directly in
// the Sheet, not here. getAllOwnerIds()/getOwnerIdsForRegion() live in RosterService.gs.
var DEFAULT_ROSTER = {
  '97411405':   { name: 'Jody Walker',        region: 'NAM' },
  '97411438':   { name: 'Jonathan Hurt',      region: 'NAM' },
  '87607260':   { name: 'Bobbi Bukovac',      region: 'NAM' },
  '92977365':   { name: 'Danielle Shannon',   region: 'NAM' },
  '2125691021': { name: 'Anshu Chaudhary',    region: 'EMEA' },
  '77920055':   { name: 'Natasha Maheshwari', region: 'APAC' },
  '89396590':   { name: 'Varun Seth',         region: 'APAC' },
  '76114362':   { name: 'Anjali Vijayakumar', region: 'APAC' },
  '1200648252': { name: 'Manisha Sharma',     region: 'APAC' },
  '88722653':   { name: 'Disha Ojha',         region: 'APAC' },
  '879250802':  { name: 'Anil Pillay',        region: 'APAC' }
};

var REGIONS = ['NAM', 'EMEA', 'APAC'];

// ---- Contact Activity tab ----

// Contact property: "SDR owner (Contact)" (owner-reference property, value = ownerId).
var CONTACT_SDR_OWNER_PROP = 'sdr_from_company';
var CONTACT_COMPANY_DOMAIN_PROP = 'company_domain_name';

// Engagement (call/email) properties - both objects share these internal names.
var ENGAGEMENT_OWNER_PROP = 'hubspot_owner_id';
var ENGAGEMENT_TIMESTAMP_PROP = 'hs_timestamp';
var CALL_DIRECTION_PROP = 'hs_call_direction';
var CALL_DIRECTION_OUTBOUND = 'OUTBOUND';
var EMAIL_DIRECTION_PROP = 'hs_email_direction';
var EMAIL_DIRECTION_OUTGOING = 'EMAIL'; // HubSpot's internal value for "Outgoing"

// "Activity date does not matter" per spec, but pulling truly all-time call/email history
// can be very large and slow for an active team. Capped to a rolling window as a practical
// default - raise this if you need a longer look-back (costs more load time / API volume).
var ENGAGEMENT_LOOKBACK_DAYS = 120;

// ---- MOFU Activity tab ----

var STAGE_SCHEDULED = '144930627';        // "Scheduled" - meetings booked / MQL-aging bucket
var STAGE_SALES_ACCEPTED = '144930628';   // "Sales Accepted Account"
var STAGE_NO_SHOW = '198705765';          // "No Show/ Cancelled/ Rescheduled"

var STAGE_ENTERED_SCHEDULED_PROP = SCHEDULED_STAGE_ENTERED_PROP; // reuse from above
var STAGE_ENTERED_SALES_ACCEPTED_PROP = 'hs_v2_date_entered_144930628';
var STAGE_ENTERED_NO_SHOW_PROP = 'hs_v2_date_entered_198705765';

// Deal stages that count as an "Opportunity" for MOFU (deliberately different from the
// Summary tab's SQL_STAGE_IDS - no closed won/lost, but includes Debook + Deal Desk Verified).
// NOTE: could not independently confirm "Debook" (1422037570) belongs to the Sales Pipeline
// pipeline (no hs_v2_date_entered_1422037570 property exists on this portal) - included per
// spec anyway; since it's always AND-ed with pipeline = Sales Pipeline, it safely contributes
// zero rather than over-counting if it turns out to belong to a different pipeline.
var OPPORTUNITY_STAGE_IDS = [
  'qualifiedtobuy',
  'presentationscheduled',
  'decisionmakerboughtin',
  '10679404',    // Contracting (New Business)
  '1422037570',  // Debook (unconfirmed pipeline - see note above)
  '1365874062'   // Deal Desk Verified Closed Won (Sales Pipeline - confirmed)
];

var DEAL_WORKED_AFTER_NO_SHOW_PROP = 'worked_after_no_show'; // free-text; "Yes"/"yes" = worked
var DEAL_TIME_IN_CURRENT_STAGE_PROP = 'hs_v2_time_in_current_stage'; // seconds, number

// ---- SDR Performance table (Summary tab) ----

var DEAL_FINAL_LEAD_SOURCE_PROP = 'final_lead_source__for_org_reporting_';
var SQL_ALLOWED_LEAD_SOURCE_VALUES = ['Allbound', 'Pure Outbound'];

// ---- Drill-down modal columns (shown across every tab) ----

var DEAL_LEAD_SOURCE_PROP = 'lead_source_deal';
var DEAL_NAME_PROP = 'dealname';
var COMPANY_ICP_CATEGORY_PROP = 'icp_category_20';
var COMPANY_LAST_ACTIVITY_PROP = 'notes_last_updated';
var COMPANY_OWNER_PROP = 'hubspot_owner_id';
var COMPANY_ALLOCATION_DATE_PROP = 'allocation_date';
