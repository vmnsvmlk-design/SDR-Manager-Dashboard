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
