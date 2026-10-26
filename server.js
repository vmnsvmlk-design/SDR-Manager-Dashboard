/**
 * SDR Manager Dashboard server: serves public/index.html and one JSON endpoint per tab.
 * Requires HUBSPOT_TOKEN in .env (see README.md) - it is never sent to the browser, only used
 * server-side for HubSpot calls. Each endpoint's HubSpot data is cached in memory for 15
 * minutes; add ?refresh=1 to force a fresh pull (the Refresh button in the UI does this).
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const { buildLeaderboardPayload } = require('./lib/leaderboardService');
const { buildRepOverviewPayload } = require('./lib/repOverviewService');
const { buildActionablesPayload } = require('./lib/actionablesService');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

// Wraps an async handler so a thrown Error becomes a JSON { message } error response,
// matching how the frontend's apiGet() helper (in public/index.html) expects failures.
function handle(fn) {
  return async (req, res) => {
    try {
      res.json(await fn(req, req.query.refresh === '1'));
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err && err.message ? err.message : String(err) });
    }
  };
}

const GRANULARITIES = ['week', 'month', 'quarter'];

app.get('/api/leaderboard', handle((req, refresh) => buildLeaderboardPayload(refresh)));
app.get('/api/rep-overview', handle((req, refresh) => {
  const granularity = GRANULARITIES.indexOf(req.query.granularity) !== -1 ? req.query.granularity : 'week';
  return buildRepOverviewPayload(granularity, refresh);
}));
app.get('/api/actionables', handle((req, refresh) => buildActionablesPayload(refresh)));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('SDR Manager Dashboard running at http://localhost:' + PORT);
  if (!process.env.HUBSPOT_TOKEN) {
    console.warn('WARNING: HUBSPOT_TOKEN is not set in .env - every tab will fail to load until it is.');
  }
});
