# SDR Manager Dashboard - Local Version

This is a local, terminal-run clone of the SDR Manager Dashboard. It renders the **exact
same UI, colors, tabs, charts, tooltips, and drill-down behavior** as the live Google Apps
Script dashboard, and pulls the **exact same live HubSpot data** using the exact same
business logic (fiscal quarter math, the G2-based "3rd party accounts" definition, the
call-direction and per-SDR query fixes, etc.) - just served from a small Node.js server on
your laptop instead of from Apps Script.

## Why a server, not just a plain HTML file

A plain `.html` file opened by double-clicking it can't safely show live HubSpot data:

- `google.script.run` (what the live dashboard's frontend uses) only works inside Apps
  Script's own sandbox - it does nothing in a normal browser tab.
- Calling HubSpot's API directly from browser JavaScript would mean putting your private
  app token in a file anyone could read via "View Source" - a real credential leak.

So this local version runs a tiny Node.js server that holds your HubSpot token (in a local
`.env` file, never sent to the browser) and does the same HubSpot API calls the Apps Script
backend does. The dashboard's frontend then calls that local server instead of Apps Script.

**One difference from the live version:** the SDR roster and quarterly targets are stored in
a local file (`data/roster.json`) instead of your live Google Sheet, to avoid needing Google
API credentials just to run this locally. Edits made here do **not** sync with the live
Sheet, and vice versa - see "Keeping the roster in sync" below.

**One improvement over the live version:** Apps Script can only make one HubSpot API call at
a time. This local server fires its HubSpot requests concurrently (via `Promise.all`), so
Contact Activity in particular - the tab that queries all 11 SDRs separately - should load
noticeably faster here than in the live dashboard.

## Files

| File | Purpose |
|---|---|
| `server.js` | Starts the local web server, defines the `/api/*` endpoints |
| `lib/config.js` | HubSpot property names, pipeline/stage IDs (port of `Config.gs`) |
| `lib/fiscalQuarter.js` | Fiscal quarter math (port of `FiscalQuarter.gs`) |
| `lib/hubspot.js` | HubSpot API calls: search, batch read, v4 associations, retry (port of `HubspotUtil.gs`) |
| `lib/roster.js` | Roster + targets, backed by `data/roster.json` instead of a Google Sheet |
| `lib/summaryService.js` | Summary tab (port of `SummaryService.gs`) |
| `lib/sdrPerformanceService.js` | SDR Performance table (port of `SdrPerformanceService.gs`) |
| `lib/accountActivityService.js` | Account Activity tab (port of `AccountActivityService.gs`) |
| `lib/contactActivityService.js` | Contact Activity tab (port of `ContactActivityService.gs`) |
| `lib/mofuService.js` | MOFU Activity tab (port of `MofuService.gs`) |
| `data/roster.json` | Local roster/targets data (seeded to match the live dashboard's defaults) |
| `public/index.html` | The dashboard UI - identical to `Index.html`, with `google.script.run` calls replaced by `fetch()` calls to this server |

## 1. Prerequisites

You need **Node.js version 18 or newer** installed (this uses Node's built-in `fetch`, added
in 18). Check what you have:

```bash
node -v
```

If that fails or shows something below `v18`, install Node from
[nodejs.org](https://nodejs.org) (the "LTS" download is fine), then re-check.

## 2. Unzip and install

Unzip the file you were given, then in a terminal:

```bash
cd sdr-dashboard-local
npm install
```

This downloads two small packages (`express` for the web server, `dotenv` for reading the
`.env` file) into a local `node_modules` folder - nothing global, nothing else on your
machine is touched.

## 3. Add your HubSpot token

```bash
cp .env.example .env
```

Open the new `.env` file in any text editor and paste your HubSpot private app token in
place of the placeholder:

```
HUBSPOT_TOKEN=your-actual-token-here
PORT=4000
```

This is the same private app token used by the live Apps Script deployment (same scopes:
Contacts, Companies, Deals, Calls, Emails, Owners - all Read). **Never commit `.env` to git**
- it's already listed in `.gitignore` so a `git add .` won't pick it up by accident.

## 4. Run it

```bash
npm start
```

You should see:

```
SDR Manager Dashboard (local) running at http://localhost:4000
```

Open **http://localhost:4000** in your browser. That's the dashboard - same tabs, same
charts, same live data as the deployed version.

To stop it, go back to the terminal and press `Ctrl+C`. To run it again later, just repeat
`npm start` from inside the `sdr-dashboard-local` folder (no need to `npm install` again
unless you delete `node_modules`).

## Keeping the roster in sync

`data/roster.json` starts out seeded with the same 11 SDRs as the live dashboard's default
roster. If your **live** Google Sheet has since diverged - people added/removed, regions
changed, targets entered - those changes won't appear here automatically. Two ways to bring
them across:

- **Manually**: open the live Roster & Targets Google Sheet and `data/roster.json` side by
  side, and copy the differences into the JSON file (it's plain text, safe to hand-edit while
  the server isn't running).
- **Through the UI**: use this local dashboard's own Inputs tab - it writes straight to
  `data/roster.json`, same as the live Inputs tab writes to the Sheet.

Either way, remember this is a **separate copy** - there's no live sync between the two.

## Troubleshooting

- **"HUBSPOT_TOKEN is not set"** on every tab: you skipped step 3, or `.env` isn't in the
  same folder as `server.js`.
- **"HubSpot API error (403)..."**: your token is missing a required scope. In HubSpot:
  Settings → Integrations → Private Apps → your app → Scopes, and confirm Read is checked
  for Contacts, Companies, Deals, Calls, Emails, and Owners.
- **Port already in use**: another process is using port 4000. Change `PORT=4000` in `.env`
  to something else (e.g. `4001`) and re-run `npm start`.
- **Data looks different from the live dashboard**: check whether your live Google Sheet
  roster has diverged from `data/roster.json` (see "Keeping the roster in sync" above) - a
  missing or extra SDR there is the most common cause of a mismatch.
