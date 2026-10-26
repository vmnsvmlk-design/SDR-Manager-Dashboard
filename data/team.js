/**
 * The SDR team and their quarterly targets - the single source of truth for every tab.
 *
 * This file is intentionally hard-coded (there is no in-app editor). To add/remove an SDR,
 * move someone to another region, or change a target, edit this file and push to the repo.
 *
 *  - ownerId: the SDR's HubSpot owner ID (HubSpot > Settings > Users, or ask Claude to look it up)
 *  - region:  one of NAM, EMEA, APAC
 *  - targets: Allbound + Outbound SQL targets for each quarter of TARGETS_FISCAL_YEAR - the only
 *             metric with a target; it drives the SDR Performance table on the Leaderboard tab
 *             (Allbound + Outbound SQL = deal with Final Lead Source Allbound or Pure Outbound whose
 *             Became Qualified to Buy Date falls in the quarter; fiscal year starts 1 May:
 *             Q1 = May-Jul, Q2 = Aug-Oct, Q3 = Nov-Jan, Q4 = Feb-Apr).
 *             Use null where no target is set - it shows as N/A.
 *
 * SDRs who have left can stay listed so their historical numbers still count; anyone with no
 * data in a given chart is simply left out of that chart.
 */

const TARGETS_FISCAL_YEAR = 'FY26-27';

const SDRS = [
  // ---- NAM ----
  { ownerId: '87607260', name: 'Bobbi Bukovac', region: 'NAM', targets: { q1: 21, q2: 20, q3: null, q4: null } },
  { ownerId: '97411405', name: 'Jody Walker', region: 'NAM', targets: { q1: 0, q2: 15, q3: null, q4: null } },
  { ownerId: '97411438', name: 'Jonathan Hurt', region: 'NAM', targets: { q1: 0, q2: 15, q3: null, q4: null } },
  { ownerId: '92977365', name: 'Danielle Shannon', region: 'NAM', targets: { q1: 10, q2: 15, q3: null, q4: null } },

  // ---- EMEA ----
  { ownerId: '2125691021', name: 'Anshu Chaudhary', region: 'EMEA', targets: { q1: 11, q2: 11, q3: null, q4: null } },

  // ---- APAC ----
  { ownerId: '77920055', name: 'Natasha Maheshwari', region: 'APAC', targets: { q1: 9, q2: 9, q3: null, q4: null } },
  { ownerId: '89396590', name: 'Varun Seth', region: 'APAC', targets: { q1: 9, q2: 7, q3: null, q4: null } },
  { ownerId: '76286398', name: 'Nikhil GS', region: 'APAC', targets: { q1: null, q2: null, q3: null, q4: null } }, // left the company; kept for Q1 history
  { ownerId: '76114362', name: 'Anjali Vijayakumar', region: 'APAC', targets: { q1: 9, q2: 7, q3: null, q4: null } },
  { ownerId: '1200648252', name: 'Manisha Sharma', region: 'APAC', targets: { q1: 11, q2: 9, q3: null, q4: null } },
  { ownerId: '88722653', name: 'Disha Ojha', region: 'APAC', targets: { q1: 11, q2: 11, q3: null, q4: null } },
  { ownerId: '879250802', name: 'Anil Pillay', region: 'APAC', targets: { q1: 9, q2: 11, q3: null, q4: null } },
  { ownerId: '100015175', name: 'Lakshay Bahl', region: 'APAC', targets: { q1: null, q2: null, q3: null, q4: null } },
  { ownerId: '101025460', name: 'Pradyumna Pohekar', region: 'APAC', targets: { q1: null, q2: null, q3: null, q4: null } }
];

module.exports = { TARGETS_FISCAL_YEAR, SDRS };
