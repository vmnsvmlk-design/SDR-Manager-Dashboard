# SDR Manager Dashboard (Google Apps Script + HubSpot)

Pulls live data from HubSpot and renders it as a web dashboard, hosted entirely on
Google Apps Script (no server to run or keep alive — Apps Script executes your code
on-demand each time someone opens the page).

Currently implemented: **Summary** and **Account Activity** tabs. Contact Activity and
MOFU Activity are stubbed as "coming soon" in the sidebar.

## Files

| File | Purpose |
|---|---|
| `Config.gs` | HubSpot property names, pipeline/stage IDs, SDR roster + regions |
| `FiscalQuarter.gs` | Computes the current fiscal quarter (FY starts 1-May) |
| `HubSpotUtil.gs` | Generic HubSpot Search API caller (auth, pagination) |
| `SummaryService.gs` | Builds the Summary tab data |
| `AccountActivityService.gs` | Builds the Account Activity tab data |
| `Code.gs` | Web app entry point (`doGet`) |
| `Index.html` | The dashboard UI (sidebar, tiles, charts) |
| `appsscript.json` | Project manifest |

## 1. Create the Apps Script project

You have two options — pick whichever you're comfortable with.

### Option A — Copy/paste manually (no extra tools needed)

1. Go to [script.google.com](https://script.google.com) and click **New project**.
2. Rename it (top left) to "SDR Manager Dashboard".
3. You'll see a default `Code.gs` file. Open each file in this repo one at a time and:
   - For every `.gs` file (`Config.gs`, `FiscalQuarter.gs`, `HubSpotUtil.gs`,
     `SummaryService.gs`, `AccountActivityService.gs`, `Code.gs`): click the **+** next to
     "Files" → **Script**, name it exactly the same (without `.gs`), and paste the contents.
     (For `Code.gs` specifically, just replace the contents of the default file.)
   - Click **+** → **HTML**, name it `Index`, and paste the contents of `Index.html`.
4. Open **Project Settings** (gear icon) → check "Show `appsscript.json` manifest file in
   editor" → open `appsscript.json` in the editor and replace its contents with this repo's
   `appsscript.json`.

### Option B — Push with `clasp` (faster, keeps this repo in sync)

If you have [clasp](https://github.com/google/clasp) installed:

```bash
npm install -g @google/clasp
clasp login
cd sdr-manager-dashboard
clasp create --title "SDR Manager Dashboard" --type webapp
clasp push
```

From then on, any time you (or I) update files in this repo, just run `clasp push` again
to sync them to the Apps Script project — no copy/pasting.

## 2. Add your HubSpot token (never paste it into code)

1. In the Apps Script editor, open **Project Settings** (gear icon on the left).
2. Scroll to **Script Properties** → **Add script property**.
3. Property: `HUBSPOT_TOKEN`, Value: your HubSpot private app token.
4. Click **Save script properties**.

This keeps the token out of source code entirely, so it's safe even though this project
is version-controlled in GitHub.

## 3. Save the project

`Ctrl+S` / `Cmd+S` (or the disk icon) saves your code — this is separate from *running*
anything. Saving just stores the script; it doesn't execute it or use any quota.

## 4. Deploy as a Web App (this is the "launch" step)

1. Click **Deploy** (top right) → **New deployment**.
2. Click the gear icon next to "Select type" → choose **Web app**.
3. Fill in:
   - Description: e.g. "v1"
   - Execute as: **Me** (so it always runs with your HubSpot access, regardless of who
     views the dashboard)
   - Who has access: **Anyone within [your domain]** (recommended for an internal
     dashboard), or **Only myself** if you want to test it solo first.
4. Click **Deploy**. The first time, Google will ask you to **authorize** the script
   (it needs permission to call external services via `UrlFetchApp`, and to store the
   script property). Review and allow it.
5. Copy the **Web app URL** it gives you. That URL is permanent — open it any time,
   from any device, and it will run fresh against HubSpot. You do not need to keep the
   Apps Script editor open, and there is nothing "running in the background" between
   visits — Apps Script only executes when the URL is loaded.

## 5. How to update the dashboard later without breaking the link

Whenever you or I change the code:

1. Save the changed files (or `clasp push`).
2. Click **Deploy** → **Manage deployments**.
3. Click the pencil/edit icon on your existing deployment.
4. Under "Version", choose **New version**, then click **Deploy**.

This updates the *same* URL in place — you never need to create a new deployment or
hand out a new link just because the code changed. ("New deployment" is only for
creating an entirely separate, additional URL.)

## Notes / assumptions baked into this build

- **Fiscal quarter** is computed live every time the page loads (FY starts 1-May), so
  Summary always reflects "now" with no manual date input.
- **"Junk deal" exclusion** on the Meetings tile is mapped to the HubSpot dropdown value
  `Junk Lead` (the closest existing option) — confirm this is what you meant.
- **"Warm Accounts"** tag value is currently stored in HubSpot as
  `Warm Accounts- FY 25-26 Q2`. If your team adds a new dated option for the current
  fiscal year (e.g. an FY 26-27 version), add it to `WARM_TAG_VALUES` in `Config.gs`.
- The SDR → region roster lives in `Config.gs` (`SDR_ROSTER`). Add/remove people there
  directly if your team changes.
