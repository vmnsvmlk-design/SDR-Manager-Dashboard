/**
 * Fiscal year runs 1-May to 30-Apr. Direct port of FiscalQuarter.gs - same UTC-based math,
 * so results match the live Apps Script dashboard exactly.
 */

function getCurrentFiscalQuarter(now) {
  now = now || new Date();
  const y = now.getUTCFullYear();
  const may1ThisYear = Date.UTC(y, 4, 1);
  const fyStartYear = now.getTime() >= may1ThisYear ? y : y - 1;

  const monthsSinceFyStart = (now.getUTCFullYear() - fyStartYear) * 12 + (now.getUTCMonth() - 4);
  const quarterIndex = Math.floor(monthsSinceFyStart / 3);

  const qStartMonth = 4 + quarterIndex * 3;
  const qStart = new Date(Date.UTC(fyStartYear, qStartMonth, 1, 0, 0, 0, 0));
  const qEnd = new Date(Date.UTC(fyStartYear, qStartMonth + 3, 0, 23, 59, 59, 999));

  const fyEndYear = fyStartYear + 1;
  return {
    fyLabel: 'FY' + String(fyStartYear).slice(-2) + '-' + String(fyEndYear).slice(-2),
    quarterNumber: quarterIndex + 1,
    start: qStart,
    end: qEnd,
    label: 'Q' + (quarterIndex + 1) + ' FY' + String(fyStartYear).slice(-2) + '-' + String(fyEndYear).slice(-2)
  };
}

function getFiscalYearQuarters(now) {
  now = now || new Date();
  const y = now.getUTCFullYear();
  const may1ThisYear = Date.UTC(y, 4, 1);
  const fyStartYear = now.getTime() >= may1ThisYear ? y : y - 1;
  const fyEndYear = fyStartYear + 1;
  const fyLabel = 'FY' + String(fyStartYear).slice(-2) + '-' + String(fyEndYear).slice(-2);

  const quarters = [];
  for (let i = 0; i < 4; i++) {
    const qStartMonth = 4 + i * 3;
    const qStart = new Date(Date.UTC(fyStartYear, qStartMonth, 1, 0, 0, 0, 0));
    const qEnd = new Date(Date.UTC(fyStartYear, qStartMonth + 3, 0, 23, 59, 59, 999));
    quarters.push({
      key: fyLabel + ' Q' + (i + 1),
      label: fyLabel + ' Q' + (i + 1),
      quarterNumber: i + 1,
      start: qStart,
      end: qEnd
    });
  }
  return { fyLabel, quarters };
}

function resolveQuarterSelection(selectionKey) {
  const fy = getFiscalYearQuarters();
  if (!selectionKey) {
    const current = getCurrentFiscalQuarter();
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
  let match = null;
  for (let i = 0; i < fy.quarters.length; i++) {
    if (fy.quarters[i].key === selectionKey) { match = fy.quarters[i]; break; }
  }
  if (!match) throw new Error('Unknown quarter selection: ' + selectionKey);
  return match;
}

function isoWeekKey(date) {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() - day + 1);
  return d.toISOString().slice(0, 10);
}

module.exports = { getCurrentFiscalQuarter, getFiscalYearQuarters, resolveQuarterSelection, isoWeekKey };
