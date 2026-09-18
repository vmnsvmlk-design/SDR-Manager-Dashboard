# SDR Manager Dashboard (Google Apps Script + HubSpot)

Pulls live data from HubSpot and renders it as a web dashboard, hosted entirely on
Google Apps Script (no server to run or keep alive — Apps Script executes your code
on-demand each time someone opens the page).

Tabs: **Summary**, **Account Activity**, **Contact Activity**, **MOFU Activity**, **Inputs**.

## Files

| File | Purpose |
|---|---|
| `Config.gs` | HubSpot property names, pipeline/stage IDs, default SDR roster seed |
| `FiscalQuarter.gs` | Fiscal quarter math (FY starts 1-May), week bucketing |
| `HubSpotUtil.gs` | HubSpot API calls: search, batch read, associations, retry/backoff |
| `RosterService.gs` | SDR roster + quarterly targets, backed by a Google Sheet (editable via Inputs tab) |
| `SummaryService.gs` | Builds the Summary tab data (leaderboards + region totals) |
| `SdrPerformanceService.gs` | Builds the Summary tab's SDR Performance (Target vs Achieved) table |
| `AccountActivityService.gs` | Builds the Account Activity tab data |
| `ContactActivityService.gs` | Builds the Contact Activity tab data (calls/emails) |
| `MofuService.gs` | Builds the MOFU Activity tab data |
| `Code.gs` | Web app entry point (`doGet`) |
| `Index.html` | The dashboard UI (sidebar, tiles, charts, drill-down modal, Inputs tab) |
| `appsscript.json` | Project manifest |

## 1. Create the Apps Script project

### Option A — Copy/paste manually (no extra tools needed)

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Rename it (top left) to "SDR Manager Dashboard".
3. For every `.gs` file above except `Code.gs`: click the **+** next to "Files" →
   **Script**, name it exactly the same (without `.gs`), and paste the contents. For
   `Code.gs`, just replace the contents of the default file the editor starts with.
4. Click **+** → **HTML**, name it `Index`, and paste the contents of `Index.html`.
5. Open **Project Settings** (gear icon) → check "Show `appsscript.json` manifest file in
   editor" → open `appsscript.json` and replace its contents with this repo's.

### Option B — Push with `clasp` (much faster for a 10-file project like this one)

```bash
npm install -g @google/clasp
clasp login
cd sdr-manager-dashboard
clasp create --title "SDR Manager Dashboard" --type webapp
clasp push
```

From then on, `clasp push` syncs every file in one shot — no copy/pasting file by file.
Strongly recommended once the project has grown past a couple of files.

## 2. Add your HubSpot token (never paste it into code)

1. In the Apps Script editor, open **Project Settings** (gear icon on the left).
2. Scroll to **Script Properties** → **Add script property**.
3. Property name: exactly `HUBSPOT_TOKEN` (case-sensitive, no spaces) → Value: your
   HubSpot private app token → **Save script properties**.

## 3. Deploy as a Web App

1. **Deploy** (top right) → **New deployment** → gear icon next to "Select type" →
   **Web app**.
2. Execute as: **Me**. Who has access: **Anyone within [your domain]** (or **Only
   myself** to test solo first).
3. **Deploy**, then **authorize** when Google prompts you — this build also uses Google
   Sheets (for the Inputs tab's roster/targets storage), so you may see an additional
   "See, edit, create and delete your Google Sheets" permission versus earlier versions.
4. Copy the **Web app URL**. That's your one permanent link — nothing needs to stay
   running between visits.

## 4. Updating later without breaking the link

Save your changes (or `clasp push`), then **Deploy → Manage deployments** → edit
(pencil icon) → Version: **New version** → **Deploy**. Same URL, updated code.

## How the Inputs tab persists data

The first time any tab loads, the app creates a Google Sheet called
**"SDR Manager Dashboard - Roster & Targets"** in your Drive (its ID is cached in Script
Properties) and seeds it from `DEFAULT_ROSTER` in `Config.gs`. From then on, that Sheet
is the source of truth for who's on the team, their region, and their quarterly targets
— edit it from the Inputs tab, or open the Sheet directly (there's a link on the Inputs
tab). Adding a person on the Inputs tab looks them up in HubSpot by email, so you never
need to know their internal owner ID.

## Notes / assumptions baked into this build — please sanity-check these

- **Fiscal quarter** is computed live from the current date (FY starts 1-May) everywhere
  it's used — Summary's current quarter, MOFU's quarter dropdown, the SDR Performance
  table's 4 quarters.
- **"Junk deal" exclusion** maps to the HubSpot checkbox value `Junk Lead`. That property
  is multi-select, so a deal is excluded if `Junk Lead` is any one of its selected
  reasons.
- **"Warm Accounts"** tag is stored in HubSpot as `Warm Accounts- FY 25-26 Q2`. If your
  team creates a new dated option for a future fiscal year, add it to `WARM_TAG_VALUES`
  in `Config.gs`.
- **"Debook" stage** (used in MOFU's Opportunities tile) could not be independently
  confirmed to belong to the Sales Pipeline pipeline — no `hs_v2_date_entered_1422037570`
  property exists on this portal, which normally would if it did. It's included per your
  spec anyway; since every query is AND-ed with `pipeline = Sales Pipeline`, this is safe
  either way (it just silently contributes zero if it turns out to live in a different
  pipeline). Worth a quick check in HubSpot's pipeline editor if Opportunities looks off.
- **Contact Activity's call/email history** is capped to the trailing
  `ENGAGEMENT_LOOKBACK_DAYS` (120 days, in `Config.gs`) rather than truly "all time" —
  pulling a sales team's entire call/email history on every page load would be very slow
  and API-heavy. Raise that constant if you need a longer look-back.
- **Call/email → contact matching**: a call or email only counts if the person who
  logged it is the *same* person as that contact's own "SDR owner (Contact)" — this
  matches your spec, but means a call made on a colleague's contact (e.g. covering for
  someone) won't show up anywhere.
- **"Deal Owner" / "Company Owner"** columns in drill-down tables resolve to a name via
  HubSpot's full owner directory (cached a few hours) — if your token lacks the
  `crm.objects.owners.read` scope this falls back to showing the raw internal ID.
- The **SDR Performance** table's Target column shows **N/A** only when nothing has been
  entered on the Inputs tab; Achieved always shows the real count, including a genuine
  **0** (not N/A) if an SDR had no qualifying deals that quarter — flag if you'd rather
  0 also read N/A.
