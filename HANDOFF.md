# St. Edward Fund Dashboard -- Handoff Document

**Last updated:** April 8, 2026
**Repo:** https://github.com/eharnischStEdword/LGL
**Live:** https://lgl.onrender.com
**Owner:** Eric Harnisch (Harnisch LLC) for St. Edward Church, Nashville TN

---

## What This Is

A React + Express dashboard that visualizes gift/donation data from Little Green Light (LGL). Staff log in via Microsoft SSO, and the dashboard pulls data from two LGL saved searches (permanent links) plus real-time API top-up.

## Tech Stack

| Layer | Technology | Notes |
|-------|-----------|-------|
| Frontend | React 18 + Vite 6 | Single file: `src/Dashboard.jsx` (~1580 lines) |
| Charts | Recharts | Line, Bar, responsive containers |
| Spreadsheet | SheetJS (xlsx) | Parses XLSX from LGL permanent links |
| Backend | Node.js + Express 5 | `server.js` (~480 lines) |
| Auth | Microsoft Entra ID (Azure AD) | OAuth2 + email allow-list |
| Hosting | Render (Web Service) | Auto-deploys from `main` branch |
| Database | None | All data from LGL; nothing persisted |

## Commands

```bash
npm run dev       # Vite dev server at localhost:5173
npm run build     # Production build to dist/
node server.js    # Production server at localhost:3000
```

## Deploy

Push to `main`. Render auto-deploys.
- Build command: `npm install && npm run build`
- Start command: `node server.js`

## Environment Variables (on Render)

| Variable | Purpose |
|----------|---------|
| `CLIENT_ID` | Microsoft Entra app client ID |
| `CLIENT_SECRET` | Microsoft Entra app secret |
| `TENANT_ID` | Microsoft Entra tenant ID |
| `REDIRECT_URI` | OAuth callback (`https://lgl.onrender.com/auth/callback`) |
| `LGL_API_KEY` | LGL API key for real-time gift top-up |
| `SESSION_SECRET` | Express session secret (auto-generated if unset) |
| `ALLOWED_DASHBOARD_USERS` | Comma-separated authorized email addresses |

## Architecture Overview

### Data Flow

```
LGL Saved Searches (daily XLSX export via permanent links)
        |
        v
  server.js hybridFetch()
        |-- Parses XLSX server-side
        |-- Extracts report date from filename
        |-- Calls LGL API for gifts since report date
        |-- Deduplicates (date|amount|fund key)
        |-- 5-minute in-memory cache
        v
  Dashboard.jsx
        |-- Builds giftIndex (fund|year|month -> total) for O(1) lookups
        |-- Renders charts, tables, comparisons
```

### Two Data Paths

1. **Offertory** (`/api/lgl-data-hybrid`): Server-side XLSX parse + API top-up. Returns JSON rows.
2. **All Funds** (`/api/lgl-all-funds` + `/api/lgl-recent-gifts`): Client-side XLSX parse + lightweight API top-up.

### LGL Permanent Links (hardcoded in server.js)

- **Offertory**: Filters to Offertory fund, Gift type, from 2024-07-01
- **All Funds**: All active funds, Gift type, from 2024-07-01

These are LGL saved searches with permanent download URLs, NOT scheduled reports.

## Dashboard Features

### Views (Time Ranges)

| Button | What it shows |
|--------|--------------|
| FY 2025-26 | Current fiscal year (Jul 2025 - Jun 2026) |
| YTD | Calendar year to date |
| Last 12 Mo | Rolling 12 months |
| All (Since Jul '19) | Full historical data |
| YoY Compare | 2025 vs 2026 calendar year, month by month |
| FY Compare | FY23-24 vs FY24-25 vs FY25-26 (Jul-Jun) |

### Display Modes

- **Chart** (Line or Bar) with data labels and trend line
- **Table** with Fiscal Year or Calendar Year rows, monthly columns, totals, and monthly averages

### Fund Controls

- Individual fund toggle buttons
- All / None quick select
- "All Funds (Total)" toggle -- adds a grand total line across ALL funds

### Other Features

- Trend line (linear regression, excludes current incomplete month)
- Trend % change badges per fund
- Financial snapshot section (Offertory month comparisons, manual FY revenue/expenses entry)
- Microsoft SSO with email allow-list

## Brand Colors

| Color | Hex | PMS | Usage |
|-------|-----|-----|-------|
| Green | `#00843D` | 348C | Primary |
| Dark Green | `#005921` | -- | Text, headers |
| Gold | `#DAAA00` | 110C | Accent |
| Blue | `#003764` | 2955C | Chart/Table toggle |
| Off-white | `#EEF4F1` | -- | Background |
| Font | Georgia | -- | Headers (approximates Mrs Eaves Roman) |
| UI Font | Trebuchet MS | -- | Buttons, labels |

## Key Design Decisions

1. **DATA_FLOOR = July 1, 2019** -- Earliest date allowed. LGL search updated to include historical data.
2. **Fiscal year starts July 1** -- Standard for Catholic parishes.
3. **YoY Compare only shows 2025 vs 2026** -- LGL Offertory search starts Jul 2024, so calendar year 2024 has incomplete data. Older years visible in FY Compare and Table views.
4. **giftIndex** -- Pre-aggregated lookup map (`fund|year|month -> total`) computed once when data loads. All chart/table computations use O(1) lookups instead of looping through all gifts.
5. **No trendline on comparison views** -- YoY and FY Compare show relative performance; trend is shown on single-period views.
6. **Label overlap fix** -- Uses factory-generated React components (`LabelUp`, `LabelMid`, `LabelDown`) because Recharts `LabelList` doesn't forward custom props to `content` components.

## Known Issues / Limitations

1. **April data gap** -- Dashboard shows what LGL has. If Pushpay-to-LGL sync is delayed, recent gifts won't appear until they land in LGL. The API top-up catches gifts updated since the permanent link report date, but can't show gifts that aren't in LGL yet.
2. **In-memory cache** -- 5-minute TTL. Server restart clears it. Fine for single-instance Render.
3. **In-memory sessions** -- Lost on deploy/restart. Users just re-authenticate.
4. **New funds** -- Must be manually added to the "FULL GIVING REPORT" saved search in LGL.
5. **Single-file frontend** -- `Dashboard.jsx` is ~1580 lines. Works fine but could be split if features keep growing.

## When Adding a New Fund in LGL

1. Create the fund in LGL
2. Go to LGL > Gifts > find the "FULL GIVING REPORT" saved search
3. Edit the search criteria and add the new fund to the Funds filter
4. Save the search
5. Dashboard will auto-discover the fund on next data load

## File Structure

```
st-edward-dashboard/
  src/Dashboard.jsx    # All UI (1580 lines)
  src/App.jsx          # Root component (5 lines)
  src/main.jsx         # Entry point
  server.js            # Express backend (480 lines)
  index.html           # SPA shell
  package.json         # Dependencies
  vite.config.js       # Build config + dev proxy
  render.yaml          # Render deployment blueprint
  CLAUDE.md            # Claude Code instructions
  HANDOFF.md           # This file
```

## Recent Work (This Session)

1. Added "All Funds (Total)" toggle line on charts
2. Added FY Compare view (3 fiscal years side by side)
3. Added Chart/Table view toggle with annual summary tables
4. Extended data floor from Jan 2025 to Jul 2019
5. Added pre-computed giftIndex for performance with large datasets
6. Fixed label overlap using factory label components
7. Fixed FY Compare month logic (was breaking instead of continuing on future months)
8. Fixed useState hook ordering crash
9. Removed 2024 from YoY (incomplete data)
10. Removed temporary diagnostic logging

## User Notes

Eric is not a developer. Keep explanations simple. Don't assume Git or npm knowledge beyond copy-paste. Always explain before running destructive commands.
