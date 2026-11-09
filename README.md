# St. Edward Church - Fund Giving Dashboard

A dashboard for visualizing fund giving data from Little Green Light (LGL). Built for St. Edward Church, Nashville TN.

Data is pulled live from LGL via scheduled permanent links, topped up with real-time gifts from the LGL API. Access is restricted to authorized St. Edward staff via Microsoft SSO.

## How it works

1. **Permanent links** — LGL generates daily exports (XLSX/CSV) of all gifts. The server proxies these to the browser.
2. **API top-up** — After loading the permanent link data, the dashboard fetches any gifts added or updated since the report was generated, so data is current to the minute.
3. **One page.** The All Funds report loads on arrival and opens on the Offertory. The classic view with its two load buttons was retired on 2026-11-09.

## Dashboard features

- **Answers first:** how giving was this week, whether the fiscal year is ahead of last year, and which funds moved, with a Copy for Bulletin button for the monthly Offertory snapshot.
- **Recent Weeks:** eight weekly bars for any fund. Offertory bars show their parts (Sunday basket, mail and office, online), and the newest week reads Counting until its cash and check count is entered, or from the Thursday after when LGL cannot be asked.
- **Chart:** this fiscal year, the last 12 months, the calendar year to date or everything since 2019, as a monthly trend, a year-against-year comparison or a table, drawn as lines or bars with an optional logarithmic scale.
- **Fund list:** every fund with activity in the period, ranked, with a search box. Click a fund to chart it.
- **Layout:** each person can reorder the sections in their own browser, and a short walkthrough runs on a first visit.

## Data correctness notes

- Gift dates from the LGL API (date-only ISO strings) are parsed in local time, so a gift dated on the first of a month is not shifted into the previous month, and a July 1 gift is not shifted into the previous fiscal year.
- Year-over-Year and Fiscal Year comparisons clip every year to the same number of completed months, so a partial current year is never measured against full prior years. The current in-progress month is marked with an asterisk and held out of comparison totals.
- Historical monthly totals (pre-2025, from the PDS/Pushpay import) backfill only the months where LGL has no live data, matched case-insensitively so a fund is never double-counted in the All Funds total.

## Architecture

- **Frontend:** React 18, Vite 6, Recharts (charts), SheetJS (spreadsheet parsing)
- **Backend:** Node.js + Express server (`server.js`)
  - Proxies LGL permanent links (avoids CORS)
  - Hybrid endpoint: parses Offertory XLSX server-side, merges with LGL API gifts
  - Lightweight recent-gifts endpoint for All Funds client-side top-up
  - Microsoft Entra ID (Azure AD) SSO authentication
  - User allow-list (email-based)

## Environment variables

Set these in Render (or `.env` for local dev):

| Variable | Required | Description |
|----------|----------|-------------|
| `CLIENT_ID` | Yes | Microsoft Entra app registration client ID |
| `CLIENT_SECRET` | Yes | Microsoft Entra client secret (enables auth) |
| `TENANT_ID` | Yes | Microsoft Entra tenant ID |
| `REDIRECT_URI` | Yes | OAuth callback URL (e.g. `https://lgl.onrender.com/auth/callback`) |
| `LGL_API_KEY` | Yes | LGL API key for real-time gift top-up |
| `SESSION_SECRET` | No | Auto-generated if not set |
| `ALLOWED_DASHBOARD_USERS` | No | Comma-separated emails (defaults to hardcoded list in server.js) |

## LGL setup

Two scheduled reports (Gift/Pledge Reports > Scheduled reports):

- **Offertory/Fund Export Update** — Funds: Offertory, Gift type: Gift, Date: from 2024-07-01, Schedule: Daily
- **FULL GIVING REPORT** — Funds: all active funds, Gift type: Gift, Date: from 2024-07-01, Schedule: Daily

When a new fund is added in LGL, you must manually add it to the FULL GIVING REPORT's fund selection.

The LGL API key is generated under Settings > Integration Settings > LGL API.

## Local development

```
npm install
npm run dev
```

Opens at http://localhost:5173. Auth is disabled when `CLIENT_SECRET` is not set.

## Deploy to Render

This is a **Web Service** (not a Static Site) because it has a Node.js backend.

**Option A: Blueprint (render.yaml)**
1. Push this repo to GitHub
2. In Render, click New > Blueprint
3. Point it at this repo
4. Add the required environment variables

**Option B: Manual**
1. In Render, click New > Web Service
2. Connect your GitHub repo
3. Build command: `npm install && npm run build`
4. Start command: `node server.js`
5. Add all environment variables from the table above

Auto-deploys on every push to main.

## Known limitations

These are documented and intentionally deferred:

- The recent-gifts API top-up filters by gift **update** date, but the dashboard buckets gifts by gift (**received**) date. A gift received after the daily report yet last edited before it can be missed until the next export catches it. **`gift_date_from` is NOT the fix**: LGL answers `400 Unknown query parameter` for it, verified against the live API, and asking for it is what killed the plate-status detector for five days in August 2026. The working shape is `updated_from` with a lookback wide enough to cover late entry, then a filter on `received_date` — which is what `fetchGiftsForRange` in `hub-exit.js` does for the hub exit and the plate detector.

## Brand colors

From the official St. Edward Style Guide:

| Color | PMS | Hex |
|-------|-----|-----|
| Green (primary) | 348C | #00843D |
| Green (dark) | - | #005921 |
| Gold (primary) | 110C | #DAAA00 |
| Gold (light) | - | #DDCC71 |
| Blue (alternate) | 2955C | #003764 |
| Off-white | - | #EEF4F1 |

Font: Mrs Eaves Roman (approximated with Georgia in the browser)
