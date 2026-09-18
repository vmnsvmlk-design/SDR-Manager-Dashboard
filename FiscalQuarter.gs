/**
 * Fiscal year runs 1-May to 30-Apr. Computed fresh on every call (no caching/hardcoding),
 * so the dashboard always reflects the fiscal quarter containing the current moment.
 * All math is done in UTC so results don't drift with the Apps Script project's timezone setting.
 */
function getCurrentFiscalQuarter(now) {
  now = now || new Date();
  var y = now.getUTCFullYear();
  var may1ThisYear = Date.UTC(y, 4, 1);
  var fyStartYear = now.getTime() >= may1ThisYear ? y : y - 1;

  var monthsSinceFyStart = (now.getUTCFullYear() - fyStartYear) * 12 + (now.getUTCMonth() - 4);
  var quarterIndex = Math.floor(monthsSinceFyStart / 3); // 0-3

  var qStartMonth = 4 + quarterIndex * 3; // 0-based month index, may exceed 11 (Date() normalizes it)
  var qStart = new Date(Date.UTC(fyStartYear, qStartMonth, 1, 0, 0, 0, 0));
  var qEnd = new Date(Date.UTC(fyStartYear, qStartMonth + 3, 0, 23, 59, 59, 999)); // last day of quarter

  var fyEndYear = fyStartYear + 1;
  return {
    fyLabel: 'FY' + String(fyStartYear).slice(-2) + '-' + String(fyEndYear).slice(-2),
    quarterNumber: quarterIndex + 1,
    start: qStart,
    end: qEnd,
    label: 'Q' + (quarterIndex + 1) + ' FY' + String(fyStartYear).slice(-2) + '-' + String(fyEndYear).slice(-2)
  };
}

/**
 * Returns all 4 quarters of the CURRENT fiscal year (the one `now` falls in), each with a
 * stable `key` like "FY26-27 Q1" usable as a dropdown value. Used by the MOFU Activity
 * quarter filter, the Inputs tab's quarter columns, and the SDR Performance table.
 */
function getFiscalYearQuarters(now) {
  now = now || new Date();
  var y = now.getUTCFullYear();
  var may1ThisYear = Date.UTC(y, 4, 1);
  var fyStartYear = now.getTime() >= may1ThisYear ? y : y - 1;
  var fyEndYear = fyStartYear + 1;
  var fyLabel = 'FY' + String(fyStartYear).slice(-2) + '-' + String(fyEndYear).slice(-2);

  var quarters = [];
  for (var i = 0; i < 4; i++) {
    var qStartMonth = 4 + i * 3;
    var qStart = new Date(Date.UTC(fyStartYear, qStartMonth, 1, 0, 0, 0, 0));
    var qEnd = new Date(Date.UTC(fyStartYear, qStartMonth + 3, 0, 23, 59, 59, 999));
    quarters.push({
      key: fyLabel + ' Q' + (i + 1),
      label: fyLabel + ' Q' + (i + 1),
      quarterNumber: i + 1,
      start: qStart,
      end: qEnd
    });
  }
  return { fyLabel: fyLabel, quarters: quarters };
}

/**
 * Resolves a quarter dropdown value (a `key` from getFiscalYearQuarters(), or "FULL_FY")
 * into concrete start/end dates.
 */
function resolveQuarterSelection(selectionKey) {
  var fy = getFiscalYearQuarters();
  if (!selectionKey) {
    // No explicit selection (first load) - default to the CURRENT quarter, not the full year.
    var current = getCurrentFiscalQuarter();
    selectionKey = fy.fyLabel + ' Q' + current.quarterNumber;
  }
  if (selectionKey === 'FULL_FY') {
    return {
      key: 'FULL_FY',
      label: fy.fyLabel + ' Full Fiscal Year',
      start: fy.quarters[0].start,
      end: fy.quarters[3].end
    };
  }
  var match = null;
  for (var i = 0; i < fy.quarters.length; i++) {
    if (fy.quarters[i].key === selectionKey) { match = fy.quarters[i]; break; }
  }
  if (!match) throw new Error('Unknown quarter selection: ' + selectionKey);
  return match;
}

/**
 * Returns the Monday (UTC) of the week containing `date`, as a "YYYY-MM-DD" string - a
 * stable, sortable key for bucketing engagements/deals into weekly cohorts.
 */
function isoWeekKey(date) {
  var d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  var day = d.getUTCDay() || 7; // Sun=0 -> 7, so Mon=1..Sun=7
  d.setUTCDate(d.getUTCDate() - day + 1); // back up to Monday
  return d.toISOString().slice(0, 10);
}
