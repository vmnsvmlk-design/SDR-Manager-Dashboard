/**
 * Backs the SDR roster (name + region) and quarterly targets in a local JSON file
 * (data/roster.json), standing in for the Google Sheet that RosterService.gs uses in the
 * live deployment. This is a deliberate simplification for local use - edits made here do
 * NOT sync with the live Google Sheet, and vice versa. If your live roster has diverged from
 * the defaults (people added/removed, regions changed, targets set), copy those changes into
 * data/roster.json by hand, or re-enter them via this local dashboard's Inputs tab.
 */

const fs = require('fs');
const path = require('path');
const { REGIONS } = require('./config');
const { getHubSpotOwnerByEmail } = require('./hubspot');
const { getFiscalYearQuarters } = require('./fiscalQuarter');

const ROSTER_FILE = path.join(__dirname, '..', 'data', 'roster.json');

function readData() {
  return JSON.parse(fs.readFileSync(ROSTER_FILE, 'utf8'));
}

function writeData(data) {
  fs.writeFileSync(ROSTER_FILE, JSON.stringify(data, null, 2) + '\n');
}

function getRoster() {
  const data = readData();
  const roster = {};
  data.roster.forEach((row) => {
    const id = String(row.ownerId).trim();
    if (!id) return;
    roster[id] = { name: String(row.name || '').trim(), region: String(row.region || '').trim() };
  });
  return roster;
}

function getTargets() {
  const data = readData();
  const targets = {};
  const toNumOrNull = (v) => (v === '' || v === null || typeof v === 'undefined') ? null : Number(v);
  data.targets.forEach((row) => {
    const id = String(row.ownerId).trim();
    if (!id) return;
    targets[id] = {
      name: String(row.name || '').trim(),
      q1: toNumOrNull(row.q1),
      q2: toNumOrNull(row.q2),
      q3: toNumOrNull(row.q3),
      q4: toNumOrNull(row.q4)
    };
  });
  return targets;
}

function getAllOwnerIds() {
  return Object.keys(getRoster());
}

function getOwnerIdsForRegion(region) {
  const roster = getRoster();
  return Object.keys(roster).filter((id) => roster[id].region === region);
}

function getRegionsInUse() {
  const roster = getRoster();
  const set = {};
  Object.keys(roster).forEach((id) => { if (roster[id].region) set[roster[id].region] = true; });
  const regions = Object.keys(set);
  return regions.length ? regions : REGIONS;
}

function getInputsPayload() {
  const roster = getRoster();
  const targets = getTargets();
  const rosterRows = Object.keys(roster)
    .map((id) => ({ ownerId: id, name: roster[id].name, region: roster[id].region }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const targetRows = Object.keys(targets)
    .map((id) => { const t = targets[id]; return { ownerId: id, name: t.name, q1: t.q1, q2: t.q2, q3: t.q3, q4: t.q4 }; })
    .sort((a, b) => a.name.localeCompare(b.name));
  const fy = getFiscalYearQuarters();
  return {
    rosterRows,
    targetRows,
    fyLabel: fy.fyLabel,
    sheetUrl: null // no Google Sheet locally - see README
  };
}

async function addRosterMember(email, region) {
  const owner = await getHubSpotOwnerByEmail(email);
  return saveRosterRow(owner.ownerId, owner.name, region);
}

function updateRosterRegion(ownerId, region) {
  const roster = getRoster();
  const current = roster[String(ownerId)];
  if (!current) throw new Error('Unknown owner ' + ownerId);
  return saveRosterRow(ownerId, current.name, region);
}

function saveRosterRow(ownerId, name, region) {
  ownerId = String(ownerId).trim();
  if (!ownerId) throw new Error('Owner ID is required.');
  const data = readData();

  const idx = data.roster.findIndex((r) => String(r.ownerId).trim() === ownerId);
  if (idx >= 0) { data.roster[idx].name = name; data.roster[idx].region = region; }
  else data.roster.push({ ownerId, name, region });

  const existsInTargets = data.targets.some((t) => String(t.ownerId).trim() === ownerId);
  if (!existsInTargets) data.targets.push({ ownerId, name, q1: null, q2: null, q3: null, q4: null });

  writeData(data);
  return getInputsPayload();
}

function removeRosterMember(ownerId) {
  ownerId = String(ownerId).trim();
  const data = readData();
  data.roster = data.roster.filter((r) => String(r.ownerId).trim() !== ownerId);
  data.targets = data.targets.filter((t) => String(t.ownerId).trim() !== ownerId);
  writeData(data);
  return getInputsPayload();
}

function saveTargetRow(ownerId, q1, q2, q3, q4) {
  ownerId = String(ownerId).trim();
  if (!ownerId) throw new Error('Owner ID is required.');
  const data = readData();
  const toNumOrNull = (v) => (v === '' || v === null || typeof v === 'undefined') ? null : Number(v);
  const idx = data.targets.findIndex((t) => String(t.ownerId).trim() === ownerId);
  if (idx < 0) throw new Error('No roster row found for owner ' + ownerId + ' - add them to the roster table first.');
  data.targets[idx].q1 = toNumOrNull(q1);
  data.targets[idx].q2 = toNumOrNull(q2);
  data.targets[idx].q3 = toNumOrNull(q3);
  data.targets[idx].q4 = toNumOrNull(q4);
  writeData(data);
  return getInputsPayload();
}

module.exports = {
  getRoster,
  getTargets,
  getAllOwnerIds,
  getOwnerIdsForRegion,
  getRegionsInUse,
  getInputsPayload,
  addRosterMember,
  updateRosterRegion,
  saveRosterRow,
  removeRosterMember,
  saveTargetRow
};
