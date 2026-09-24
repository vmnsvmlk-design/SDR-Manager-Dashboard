# SDR Manager Dashboard

A Node.js + Express dashboard pulling live data from HubSpot: per-region SQL/meeting
leaderboards, Account Activity, Contact Activity, MOFU Activity, and an editable SDR
roster/targets tab. Runnable locally from a terminal, or deployed on a host like Railway.

This project previously ran on Google Apps Script; it has since been fully ported to a
standalone Node server and no longer depends on Apps Script, `google.script.run`, or a
Google Sheet for the roster.

## How it's built

- **Backend** (`server.js` + `lib/*.js`): holds your HubSpot token server-side and exposes
  one `/api/*` endpoint per dashboard tab. Each `lib/*Service.js` file builds one tab's
  payload straight from HubSpot's CRM Search, batch/read, and v4 associations APIs -
  including the calls-direction fix (most calls never get `hs_call_direction` set, so the
  code excludes only explicit `INBOUND` rather than requiring an exact `OUTBOUND` match),
  the per-SDR query fix (HubSpot's Search API hard-caps any single search at 10,000 results,
  so engagements are queried one SDR at a time), and the v4-associations fix (this portal's
  `batch/read` `associations` parameter silently returns nothing; the dedicated v4 endpoint
  works). HubSpot requests run concurrently via `Promise.all` rather than one at a time.
- **Frontend** (`public/index.html`): the dashboard UI - same charts, colors, tooltips, and
  drill-down modals throughout - calling this server's `/api/*` endpoints via `fetch()`.
- **Roster/targets** (`lib/roster.js` + `data/roster.json`): the SDR roster and quarterly
  targets, editable from the Inputs tab, stored in a plain local JSON file rather than a
  database - simple, but see the Railway note below on persistence.

## Files

| File | Purpose |
|---|---|
| `server.js` | Starts the web server, defines the `/api/*` endpoints |
| `lib/config.js` | HubSpot property names, pipeline/stage IDs |
| `lib/fiscalQuarter.js` | Fiscal quarter math (FY starts 1-May), week bucketing |
| `lib/hubspot.js` | HubSpot API calls: search, batch read, v4 associations, retry/backoff |
| `lib/roster.js` | Roster + quarterly targets, backed by `data/roster.json` |
| `lib/summaryService.js` | Summary tab (leaderboards + region totals) |
| `lib/sdrPerformanceService.js` | Summary tab's SDR Performance (Target vs Achieved) table |
| `lib/accountActivityService.js` | Account Activity tab |
| `lib/contactActivityService.js` | Contact Activity tab (calls/emails) |
| `lib/mofuService.js` | MOFU Activity tab |
| `data/roster.json` | Roster/targets data |
| `public/index.html` | The dashboard UI (sidebar, tiles, charts, drill-down modal, Inputs tab) |

## 1. Prerequisites

**Node.js version 18 or newer** (this uses Node's built-in `fetch`). Check what you have:

```bash
node -v
```

If that fails or shows below `v18`, install Node from [nodejs.org](https://nodejs.org) (the
"LTS" download is fine), then re-check.

## 2. Install

```bash
git clone https://github.com/vmnsvmlk-design/SDR-Manager-Dashboard.git
cd SDR-Manager-Dashboard
npm install
```

This downloads two small packages (`express`, `dotenv`) into a local `node_modules` folder.

## 3. Add your HubSpot token

```bash
cp .env.example .env
```

Open `.env` in any text editor and paste your HubSpot private app token in place of the
placeholder:

```
HUBSPOT_TOKEN=your-actual-token-here
PORT=4000
```

The token needs Read scope on Contacts, Companies, Deals, Calls, Emails, and Owners.
**Never commit `.env`** - it's already in `.gitignore`.

## 4. Run it locally

```bash
npm start
```

You should see:

```
SDR Manager Dashboard (local) running at http://localhost:4000
```

Open **http://localhost:4000**. To stop it, `Ctrl+C` in that terminal. To run it again
later, repeat `npm start` from this folder (no need to `npm install` again unless you delete
`node_modules`).

## 5. Deploying on Railway

Since `package.json` and `server.js` sit at the repo root, Railway's build system detects
this as a Node app automatically - no root directory override needed.

1. In Railway, create a new service from this GitHub repo.
2. In the service's **Variables** tab, add:
   ```
   HUBSPOT_TOKEN=your-actual-token-here
   ```
   Leave `PORT` unset - Railway injects its own, and `server.js` already reads
   `process.env.PORT`.
3. Deploy. Railway runs `npm install` then `npm start` automatically.

**Persistence note:** `data/roster.json` is a plain file in the deployed container's
filesystem, which Railway resets on every redeploy. Roster/target edits made through the
Inputs tab will persist across page loads but will be **wiped on the next deploy** (a new
push, a restart, a scale event). That's fine for a quick shared view, but if you want roster
edits to survive redeploys, that data needs to move to a persistent Railway volume or a real
database instead of a JSON file - ask if you want that wired up.

## Troubleshooting

- **"HUBSPOT_TOKEN is not set"** on every tab: `.env` is missing, not in the same folder as
  `server.js`, or (on Railway) the `HUBSPOT_TOKEN` variable isn't set in the service.
- **"HubSpot API error (403)..."**: your token is missing a required scope. In HubSpot:
  Settings → Integrations → Private Apps → your app → Scopes, and confirm Read is checked
  for Contacts, Companies, Deals, Calls, Emails, and Owners.
- **Port already in use (local only)**: another process is using port 4000. Change
  `PORT=4000` in `.env` to something else (e.g. `4001`) and re-run `npm start`.
