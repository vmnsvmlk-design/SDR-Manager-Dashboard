/**
 * Fiscal year runs 1-May to 30-Apr. All math is in UTC.
 * Also builds the reporting periods (weeks / months / quarters) used by the Rep Overview tab.
 */

function fyStartYearFor(date) {
  const y = date.getUTCFullYear();
  return date.getTime() >= Date.UTC(y, 4, 1) ? y : y - 1;
}

function fyLabelFor(fyStartYear) {
  return 'FY' + String(fyStartYear).slice(-2) + '-' + String(fyStartYear + 1).slice(-2);
}

// Fiscal quarter `index` (0-3) of the fiscal year starting May `fyStartYear`. Indexes outside
// 0-3 roll into neighbouring fiscal years, so (fy, -1) is Q4 of the previous year.
function fiscalQuarter(fyStartYear, index) {
  const fy = fyStartYear + Math.floor(index / 4);
  const qi = ((index % 4) + 4) % 4;
  const startMonth = 4 + qi * 3;
  const fyLabel = fyLabelFor(fy);
  return {
    key: fyLabel + '-Q' + (qi + 1),
    label: 'Q' + (qi + 1) + ' ' + fyLabel,
    fyLabel,
    quarterNumber: qi + 1,
    start: new Date(Date.UTC(fy, startMonth, 1)),
    end: new Date(Date.UTC(fy, startMonth + 3, 0, 23, 59, 59, 999))
  };
}

function getCurrentFiscalQuarter(now) {
  now = now || new Date();
  const fy = fyStartYearFor(now);
  const monthsSinceFyStart = (now.getUTCFullYear() - fy) * 12 + (now.getUTCMonth() - 4);
  return fiscalQuarter(fy, Math.floor(monthsSinceFyStart / 3));
}

function getCurrentFiscalYear(now) {
  now = now || new Date();
  const fy = fyStartYearFor(now);
  const quarters = [0, 1, 2, 3].map((i) => fiscalQuarter(fy, i));
  return {
    fyLabel: fyLabelFor(fy),
    start: quarters[0].start,
    end: quarters[3].end,
    quarters
  };
}

function mondayOf(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Reporting periods for the Rep Overview tab, oldest first, the last one always containing now:
 *  - week:    last 8 Monday-Sunday weeks ("Week 1 (Sep 1)" ... "Week 8 (Oct 20)")
 *  - month:   last 6 calendar months ("May 2026" ...)
 *  - quarter: last 3 fiscal quarters ("Q4 FY25-26" ...)
 */
function getReportingPeriods(granularity, now) {
  now = now || new Date();
  const periods = [];

  if (granularity === 'week') {
    const thisMonday = mondayOf(now);
    for (let i = 7; i >= 0; i--) {
      const start = new Date(thisMonday.getTime() - i * 7 * 86400000);
      const end = new Date(start.getTime() + 7 * 86400000 - 1);
      periods.push({
        key: start.toISOString().slice(0, 10),
        label: 'Week ' + (8 - i) + ' (' + MONTHS[start.getUTCMonth()] + ' ' + start.getUTCDate() + ')',
        start,
        end
      });
    }
  } else if (granularity === 'month') {
    for (let i = 5; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1) - 1);
      periods.push({
        key: start.toISOString().slice(0, 7),
        label: MONTHS[start.getUTCMonth()] + ' ' + start.getUTCFullYear(),
        start,
        end
      });
    }
  } else if (granularity === 'quarter') {
    const current = getCurrentFiscalQuarter(now);
    const fy = fyStartYearFor(now);
    for (let i = 2; i >= 0; i--) {
      const q = fiscalQuarter(fy, current.quarterNumber - 1 - i);
      periods.push({ key: q.key, label: q.label, start: q.start, end: q.end });
    }
  } else {
    throw new Error('Unknown granularity: ' + granularity + ' (expected week, month or quarter)');
  }

  return periods;
}

// Returns the key of the period containing `timeMs`, or null if it falls outside all of them.
function periodKeyFor(periods, timeMs) {
  for (let i = 0; i < periods.length; i++) {
    if (timeMs >= periods[i].start.getTime() && timeMs <= periods[i].end.getTime()) return periods[i].key;
  }
  return null;
}

module.exports = {
  getCurrentFiscalQuarter,
  getCurrentFiscalYear,
  getReportingPeriods,
  periodKeyFor
};
