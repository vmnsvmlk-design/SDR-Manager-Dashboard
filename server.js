/**
 * SDR Manager Dashboard server: serves public/index.html and one JSON endpoint per tab.
 * Requires HUBSPOT_TOKEN in .env (see README.md) - it is never sent to the browser, only used
 * server-side for HubSpot calls.
 *
 * HubSpot data is cached in memory and kept warm by a background loop (see warmUp below), so
 * page loads are served from cache instead of waiting on HubSpot's rate-limited APIs. Add
 * ?refresh=1 to force a fresh pull (the Refresh button in the UI does this).
 */

require('dotenv').config();
const express = require('express');
const compression = require('compression');
const path = require('path');

const { buildLeaderboardPayload } = require('./lib/leaderboardService');
const { buildRepOverviewPayload } = require('./lib/repOverviewService');
const { buildActionablesPayload } = require('./lib/actionablesService');

const app = express();
app.use(compression());
app.use(express.static(path.join(__dirname, 'public')));

// Wraps an async handler so a thrown Error becomes a JSON { message } error response,
// matching how the frontend's apiGet() helper (in public/index.html) expects failures.
function handle(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req, req.query.refresh === '1' ? 'force' : 'normal'));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err && err.message ? err.message : String(err) });
    }
  };
}

const GRANULARITIES = ['week', 'month', 'quarter'];

app.get('/api/leaderboard', handle((req, mode) => buildLeaderboardPayload(mode)));
app.get('/api/rep-overview', handle((req, mode) => {
  const granularity = GRANULARITIES.indexOf(req.query.granularity) !== -1 ? req.query.granularity : 'week';
  return buildRepOverviewPayload(granularity, mode);
}));
app.get('/api/actionables', handle((req, mode) => buildActionablesPayload(mode)));

// Pre-loads every tab one after another (so they don't compete for HubSpot's rate limit) at
// startup and then every WARM_INTERVAL_MINUTES. Visitors keep getting the previous data while a
// refresh runs; it is swapped in only once the new pull succeeds.
const WARM_INTERVAL_MINUTES = 20;
const WARM_STEPS = [
  ['Leaderboard', () => buildLeaderboardPayload('background')],
  ['Actionables', () => buildActionablesPayload('background')],
  ['Rep Overview (week)', () => buildRepOverviewPayload('week', 'background')],
  ['Rep Overview (month)', () => buildRepOverviewPayload('month', 'background')],
  ['Rep Overview (quarter)', () => buildRepOverviewPayload('quarter', 'background')]
];
let warming = false;
async function warmUp() {
  if (warming || !process.env.HUBSPOT_TOKEN) return;
  warming = true;
  for (const [name, step] of WARM_STEPS) {
    const t = Date.now();
    try {
      await step();
      console.log('Warmed ' + name + ' in ' + Math.round((Date.now() - t) / 1000) + 's');
    } catch (err) {
      console.error('Warm-up of ' + name + ' failed:', err.message);
    }
  }
  warming = false;
}

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('SDR Manager Dashboard running at http://localhost:' + PORT);
  if (!process.env.HUBSPOT_TOKEN) {
    console.warn('WARNING: HUBSPOT_TOKEN is not set in .env - every tab will fail to load until it is.');
  }
  warmUp();
  setInterval(warmUp, WARM_INTERVAL_MINUTES * 60 * 1000);
});
