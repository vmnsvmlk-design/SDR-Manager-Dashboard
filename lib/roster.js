/**
 * Read-only access to the hard-coded SDR team in data/team.js. There is deliberately no write
 * path: roster and target changes are made by editing that file and pushing to the repo.
 */

const { REGIONS } = require('./config');
const { SDRS, TARGETS_FISCAL_YEAR } = require('../data/team');

const roster = {};
SDRS.forEach((s) => {
  const id = String(s.ownerId).trim();
  if (!id) return;
  roster[id] = {
    ownerId: id,
    name: String(s.name || '').trim(),
    region: String(s.region || '').trim(),
    targets: Object.assign({ q1: null, q2: null, q3: null, q4: null }, s.targets || {})
  };
});

function getRoster() {
  return roster;
}

function getAllOwnerIds() {
  return Object.keys(roster);
}

function getOwnerIdsForRegion(region) {
  return Object.keys(roster).filter((id) => roster[id].region === region);
}

// Roster rows as sent to the browser: { [ownerId]: { ownerId, name, region } }.
function getOwnersPayload() {
  const owners = {};
  Object.keys(roster).forEach((id) => {
    owners[id] = { ownerId: id, name: roster[id].name, region: roster[id].region };
  });
  return owners;
}

function getTargetsFiscalYear() {
  return TARGETS_FISCAL_YEAR;
}

module.exports = {
  REGIONS,
  getRoster,
  getAllOwnerIds,
  getOwnerIdsForRegion,
  getOwnersPayload,
  getTargetsFiscalYear
};
