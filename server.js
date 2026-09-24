/**
 * Local server for the SDR Manager Dashboard - replaces Apps Script's doGet() + google.script.run
 * with a plain Express app: it serves public/index.html and exposes one HTTP endpoint per
 * build*Payload() function the live dashboard calls. Requires HUBSPOT_TOKEN in .env (see
 * README.md) - it is never sent to the browser, only used server-side for HubSpot calls.
 */

require('dotenv').config();
const express = require('express');
const path = require('path');

const { buildSummaryPayload } = require('./lib/summaryService');
const { buildAccountActivityPayload } = require('./lib/accountActivityService');
const { buildContactActivityPayload } = require('./lib/contactActivityService');
const { buildMofuPayload } = require('./lib/mofuService');
const roster = require('./lib/roster');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Wraps an async handler so a thrown Error becomes a JSON { message } error response,
// matching how the frontend's apiFetch() helper (in public/index.html) expects failures.
function handle(fn) {
  return async (req, res) => {
    try {
      const data = await fn(req);
      res.json(data);
    } catch (err) {
      console.error(err);
      res.status(500).json({ message: err && err.message ? err.message : String(err) });
    }
  };
}

app.get('/api/summary', handle(() => buildSummaryPayload()));
app.get('/api/account-activity', handle(() => buildAccountActivityPayload()));
app.get('/api/contact-activity', handle(() => buildContactActivityPayload()));
app.get('/api/mofu', handle((req) => buildMofuPayload(req.query.quarter || null)));

app.get('/api/inputs', handle(() => roster.getInputsPayload()));
app.post('/api/inputs/roster', handle((req) => roster.updateRosterRegion(req.body.ownerId, req.body.region)));
app.post('/api/inputs/roster/add', handle((req) => roster.addRosterMember(req.body.email, req.body.region)));
app.post('/api/inputs/roster/remove', handle((req) => roster.removeRosterMember(req.body.ownerId)));
app.post('/api/inputs/targets', handle((req) => roster.saveTargetRow(req.body.ownerId, req.body.q1, req.body.q2, req.body.q3, req.body.q4)));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log('SDR Manager Dashboard (local) running at http://localhost:' + PORT);
  if (!process.env.HUBSPOT_TOKEN) {
    console.warn('WARNING: HUBSPOT_TOKEN is not set in .env - every tab will fail to load until it is.');
  }
});
