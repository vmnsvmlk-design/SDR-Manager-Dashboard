/**
 * Backs the SDR roster (name + region) and quarterly targets in a Google Sheet, so the
 * "Inputs" tab can add/edit rows without ever touching code. The sheet is created once
 * (its ID cached in Script Properties) and seeded from DEFAULT_ROSTER in Config.gs.
 *
 * Every other service (Summary, Account Activity, Contact Activity, MOFU, SDR
 * Performance) reads the roster through getAllOwnerIds()/getOwnerIdsForRegion() below -
 * a person added on the Inputs tab automatically shows up everywhere else.
 */
var ROSTER_SHEET_PROP_KEY = 'ROSTER_SHEET_ID';
var ROSTER_TAB_NAME = 'Roster';
var TARGETS_TAB_NAME = 'Targets';

function getRosterSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty(ROSTER_SHEET_PROP_KEY);
  var ss = null;
  if (sheetId) {
    try {
      ss = SpreadsheetApp.openById(sheetId);
    } catch (e) {
      ss = null; // stored id is stale/deleted - recreate below
    }
  }
  if (!ss) {
    ss = SpreadsheetApp.create('SDR Manager Dashboard - Roster & Targets');
    props.setProperty(ROSTER_SHEET_PROP_KEY, ss.getId());
    seedRosterSpreadsheet(ss);
  }
  return ss;
}

function seedRosterSpreadsheet(ss) {
  var rosterSheet = ss.getSheets()[0];
  rosterSheet.setName(ROSTER_TAB_NAME);
  rosterSheet.appendRow(['Owner ID', 'Name', 'Region']);
  Object.keys(DEFAULT_ROSTER).forEach(function (id) {
    rosterSheet.appendRow([id, DEFAULT_ROSTER[id].name, DEFAULT_ROSTER[id].region]);
  });
  rosterSheet.setFrozenRows(1);

  var targetsSheet = ss.insertSheet(TARGETS_TAB_NAME);
  targetsSheet.appendRow(['Owner ID', 'Name', 'Q1 Target', 'Q2 Target', 'Q3 Target', 'Q4 Target']);
  Object.keys(DEFAULT_ROSTER).forEach(function (id) {
    targetsSheet.appendRow([id, DEFAULT_ROSTER[id].name, '', '', '', '']);
  });
  targetsSheet.setFrozenRows(1);
}

function getRosterSheetUrl() {
  return getRosterSpreadsheet().getUrl();
}

function readSheetRows_(sheet) {
  var values = sheet.getDataRange().getValues();
  return values.slice(1).filter(function (row) { return row[0] !== '' && row[0] !== null; });
}

function getRoster() {
  var rows = readSheetRows_(getRosterSpreadsheet().getSheetByName(ROSTER_TAB_NAME));
  var roster = {};
  rows.forEach(function (row) {
    var id = String(row[0]).trim();
    if (!id) return;
    roster[id] = { name: String(row[1] || '').trim(), region: String(row[2] || '').trim() };
  });
  return roster;
}

function getTargets() {
  var rows = readSheetRows_(getRosterSpreadsheet().getSheetByName(TARGETS_TAB_NAME));
  var targets = {};
  var toNumOrNull = function (v) { return (v === '' || v === null || typeof v === 'undefined') ? null : Number(v); };
  rows.forEach(function (row) {
    var id = String(row[0]).trim();
    if (!id) return;
    targets[id] = {
      name: String(row[1] || '').trim(),
      q1: toNumOrNull(row[2]),
      q2: toNumOrNull(row[3]),
      q3: toNumOrNull(row[4]),
      q4: toNumOrNull(row[5])
    };
  });
  return targets;
}

function getAllOwnerIds() {
  return Object.keys(getRoster());
}

function getOwnerIdsForRegion(region) {
  var roster = getRoster();
  return Object.keys(roster).filter(function (id) { return roster[id].region === region; });
}

function getRegionsInUse() {
  var roster = getRoster();
  var set = {};
  Object.keys(roster).forEach(function (id) { if (roster[id].region) set[roster[id].region] = true; });
  var regions = Object.keys(set);
  return regions.length ? regions : REGIONS;
}

// ---- Inputs tab: read + write, called via google.script.run ----

function getInputsPayload() {
  var roster = getRoster();
  var targets = getTargets();
  var rosterRows = Object.keys(roster).map(function (id) {
    return { ownerId: id, name: roster[id].name, region: roster[id].region };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  var targetRows = Object.keys(targets).map(function (id) {
    var t = targets[id];
    return { ownerId: id, name: t.name, q1: t.q1, q2: t.q2, q3: t.q3, q4: t.q4 };
  }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  var fy = getFiscalYearQuarters();
  return {
    rosterRows: rosterRows,
    targetRows: targetRows,
    fyLabel: fy.fyLabel,
    sheetUrl: getRosterSheetUrl()
  };
}

/** Adds (or updates, if the email already exists) a roster member. Name comes from HubSpot itself. */
function addRosterMember(email, region) {
  var owner = getHubSpotOwnerByEmail(email);
  return saveRosterRow(owner.ownerId, owner.name, region);
}

function updateRosterRegion(ownerId, region) {
  var roster = getRoster();
  var current = roster[String(ownerId)];
  if (!current) throw new Error('Unknown owner ' + ownerId);
  return saveRosterRow(ownerId, current.name, region);
}

function saveRosterRow(ownerId, name, region) {
  ownerId = String(ownerId).trim();
  if (!ownerId) throw new Error('Owner ID is required.');
  var ss = getRosterSpreadsheet();
  var sheet = ss.getSheetByName(ROSTER_TAB_NAME);
  var values = sheet.getDataRange().getValues();
  var found = false;
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === ownerId) {
      sheet.getRange(i + 1, 2, 1, 2).setValues([[name, region]]);
      found = true;
      break;
    }
  }
  if (!found) sheet.appendRow([ownerId, name, region]);

  // Keep the Targets sheet in sync so a newly added SDR also gets a target row.
  var targetsSheet = ss.getSheetByName(TARGETS_TAB_NAME);
  var targetValues = targetsSheet.getDataRange().getValues();
  var existsInTargets = targetValues.slice(1).some(function (row) { return String(row[0]).trim() === ownerId; });
  if (!existsInTargets) targetsSheet.appendRow([ownerId, name, '', '', '', '']);

  return getInputsPayload();
}

function removeRosterMember(ownerId) {
  ownerId = String(ownerId).trim();
  var ss = getRosterSpreadsheet();
  removeRowById_(ss.getSheetByName(ROSTER_TAB_NAME), ownerId);
  removeRowById_(ss.getSheetByName(TARGETS_TAB_NAME), ownerId);
  return getInputsPayload();
}

function removeRowById_(sheet, ownerId) {
  var values = sheet.getDataRange().getValues();
  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]).trim() === ownerId) sheet.deleteRow(i + 1);
  }
}

function saveTargetRow(ownerId, q1, q2, q3, q4) {
  ownerId = String(ownerId).trim();
  if (!ownerId) throw new Error('Owner ID is required.');
  var sheet = getRosterSpreadsheet().getSheetByName(TARGETS_TAB_NAME);
  var values = sheet.getDataRange().getValues();
  var toNumOrBlank = function (v) { return (v === '' || v === null || typeof v === 'undefined') ? '' : Number(v); };
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim() === ownerId) {
      sheet.getRange(i + 1, 3, 1, 4).setValues([[toNumOrBlank(q1), toNumOrBlank(q2), toNumOrBlank(q3), toNumOrBlank(q4)]]);
      return getInputsPayload();
    }
  }
  throw new Error('No roster row found for owner ' + ownerId + ' - add them to the roster table first.');
}
