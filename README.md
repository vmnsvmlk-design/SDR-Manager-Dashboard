# SDR Manager Dashboard

A Node.js + Express dashboard pulling live data from HubSpot, with three tabs:

| Tab | What it shows |
|---|---|
| **Leaderboard** | Top 3 reps per region (NAM / EMEA / APAC) for the full fiscal year (from 1 May) or a single fiscal quarter (picker in the top right) on three podiums: Allbound + Outbound Opps Created, All Opps Created, Meetings Booked. Click a card title for the rep-wise comparison (split by quarter), a rep for their deals, or "View full ranking" for every rep plus all underlying deals. Below: the SDR Performance table (target vs achieved Allbound + Outbound SQLs per quarter - always the full year, regardless of the picker). |
| **Rep Overview** | Week on week (last 8 weeks), month on month (last 6 months) or quarter on quarter (last 3 fiscal quarters), for a region or a single SDR: contacts reached out / emailed / LinkedIn messaged / called, meetings booked, sales accepted, opportunities, Allbound + Outbound opportunities, revenue closed, and 3rd party / warm / event accounts with activity. A table at the bottom shows any of these metrics as SDR × period. |
| **Actionables** | Current state: 3rd party / warm / event accounts not worked, accounts worked but not converted to meetings, and where deals are stuck (No Shows, Scheduled and Sales Accepted 30/60/90+ days). |

Every number, bar and line is clickable and opens the underlying HubSpot records (with a filter
box and CSV download). SDRs with no data in a chart are left out of that chart.

## Changing the SDR team or targets

The roster and quarterly targets are hard-coded in **`data/team.js`** - there is no in-app editor.
Edit that file (add/remove an SDR, change a region, set `q1`-`q4` targets) and push; the change
goes live on the next deploy. Each SDR needs their HubSpot owner ID.

## Metric definitions

All HubSpot property names and stage IDs live in `lib/config.js`.

- **Contacts reached out / emailed / LinkedIn / called** - a contact counts in a period if the
  SDR (*Activity assigned to*) logged an outgoing call (anything not marked Inbound), outgoing
  email, or LinkedIn message (a HubSpot *communication* with channel `LINKEDIN_MESSAGE`, as logged
  by the LinkedIn Sales Navigator integration) against them in that period, **and** the contact's
  *SDR owner (Contact)* is that same SDR. A contact touched in two periods counts in both.
- **3rd party / warm / event accounts with activity** - the primary company of those same
  contacts, counted per period, by *TAGS- SDR Categories*: 3rd party = "3rd Party Signals";
  warm = any tag whose value or label contains "Warm", plus "Surging accounts"; event = any tag
  whose value or label contains "Event" (so "Warm Event Accounts" counts as both warm and event).
- **Meetings booked** - deals that entered *Scheduled*, by *SDR Owner (Deal)*, excluding deals
  disqualified as *Junk Lead*. **Sales accepted** - same, for *Sales Accepted Account*.
- **Opportunities created** - deals by *SDR Owner (Deal)* with *Became Qualified to Buy Date* in
  the period, in Qualified to buy, Presentation done, Proposal Shared / Negotiations,
  Contracting, Closed won, Closed lost, Debook or Deal Desk Verified Closed Won.
  **Allbound + Outbound** additionally requires *Final Lead Source* Allbound or Pure Outbound.
- **Revenue closed** - won deals (Closed won, Deal Desk Verified Closed Won) by *SDR Owner (Deal)*,
  bucketed by *Close Date*, summing *Annual Subscription Fee $* (USD). Open deals are excluded
  because that field holds forecast values on them.
- **Not worked** - *Account worked after Allocation?* is not Yes, for companies where
  *SDR Owner (Company)* is the rep. **Not converted** - worked, but *Lifecycle Stage (Custom)* is
  not a deal/customer stage.
- **Stuck deals** - deals currently in No Show (split by *Worked after No Show?*), or in Scheduled /
  Sales Accepted for 30-59, 60-89 or 90+ days since they entered the stage.

Weeks run Monday-Sunday (UTC); the fiscal year starts 1 May.

## How it's built

- `server.js` - one JSON endpoint per tab (`/api/leaderboard`, `/api/rep-overview?granularity=week|month|quarter`, `/api/actionables`).
- `lib/*Service.js` - one file per tab, built from HubSpot's CRM Search, batch read and v4 associations APIs.
- `lib/hubspot.js` - HubSpot client. Every request goes through a rate limiter that stays under
  HubSpot's limits (4 searches/second, 9 other requests/second), and 429s are retried.
  Engagements are queried one SDR at a time, and any query that would exceed HubSpot's
  10,000-result search cap is automatically split into smaller time windows.
- **Caching / warm-up:** on startup and every 20 minutes the server pulls every tab from HubSpot
  in the background, one after another, and keeps the last good copy in memory. Page loads are
  served from that copy, so they're instant once warm; the "Data as of" time in the sidebar shows
  how fresh it is. Right after a deploy the first warm-up takes a few minutes (Rep Overview
  quarter on quarter is the slowest); a tab opened before its warm-up finishes just waits for it.
  Activity is fetched in segments shared by the week / month / quarter views, so each email,
  call or message is only pulled once. The **Refresh data** button forces a fresh pull.
- `public/index.html` - the whole UI (Chart.js).

## Setup

Requires **Node.js 18+**.

```bash
git clone https://github.com/vmnsvmlk-design/SDR-Manager-Dashboard.git
cd SDR-Manager-Dashboard
npm install
cp .env.example .env   # then paste your HubSpot private app token into .env
npm start              # http://localhost:4000
```

The token needs Read scope on Contacts, Companies, Deals, Owners, and the engagement objects
(Calls, Emails, and Communications for LinkedIn messages). **Never commit `.env`.**

### Railway

Create a service from this repo and set the `HUBSPOT_TOKEN` variable (leave `PORT` unset).
Railway runs `npm install` and `npm start` automatically. Nothing is written to disk, so
redeploys lose nothing.

## Troubleshooting

- **"HUBSPOT_TOKEN is not set"** - `.env` is missing, or the Railway variable isn't set.
- **"HubSpot API error (403)…"** - the token is missing a scope (HubSpot → Settings →
  Integrations → Private Apps → Scopes).
- **Yellow "LinkedIn activity could not be loaded" banner** on Rep Overview - the token can't read
  communications; the rest of the tab still works. Add the scope and refresh.
