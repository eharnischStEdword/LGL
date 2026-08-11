# CLAUDE.md

## Project
St. Edward Church (Nashville TN) Fund Giving Dashboard.
React app with Node.js backend that visualizes LGL (Little Green Light) gift data by fund.
Branded with official St. Edward colors. Data is fetched from LGL permanent links + API.

## Commands
- `npm run dev` - Start dev server at http://localhost:5173
- `npm run build` - Production build to dist/
- `npm run preview` - Preview production build locally
- `node server.js` - Start production server (serves dist/ + API routes)

## Deploy
Push to main branch. Render auto-deploys from GitHub.
- Repo: https://github.com/eharnischStEdword/LGL
- Live: https://lgl.onrender.com
- Render build command: npm install && npm run build
- Render start command: node server.js
- Render type: Web Service (not Static Site)

## Architecture
- React 18 frontend built with Vite 6
  - v1 (default, at /): all UI in src/Dashboard.jsx — frozen, do not modify while v2 is staging
  - v2 (staging, at /v2): src/v2/* — DashboardV2.jsx orchestrator; lib.js holds
    math copied VERBATIM from v1 plus the new weekly engine; historical.js is a
    verbatim copy of HISTORICAL_MONTHLY. src/App.jsx routes on pathname.
- Node.js + Express backend in server.js
  - Proxies LGL permanent links (CORS)
  - Hybrid endpoint: parses Offertory XLSX server-side, merges LGL API gifts
  - Lightweight /api/lgl-recent-gifts endpoint for All Funds client-side top-up
  - Microsoft Entra ID SSO with email allow-list
- Recharts for charts, SheetJS (xlsx) for spreadsheet parsing
- No router, no state management library
- All Funds permanent link is delivered by LGL as a .zip wrapping a .csv;
  proxyLGL unwraps it server-side (extractCsvFromZip, Node zlib) and forwards CSV
- Fund list has a type-to-filter search; a Fund Totals table lists every fund's
  total for the selected range (click a row to chart that fund)

## Environment Variables (Render)
- CLIENT_ID, CLIENT_SECRET, TENANT_ID — Microsoft Entra SSO
- REDIRECT_URI — OAuth callback (https://lgl.onrender.com/auth/callback)
- LGL_API_KEY — LGL API key for real-time gift top-up
- SESSION_SECRET — auto-generated if not set
- ALLOWED_DASHBOARD_USERS — comma-separated authorized emails

## Brand Colors (from official style guide)
- Green PMS 348C: #00843D (primary), #005921 (dark)
- Gold PMS 110C: #DAAA00 (primary), #DDCC71 (light)
- Blue PMS 2955C: #003764 (alternate)
- Off-white: #EEF4F1
- Font: Georgia (approximating Mrs Eaves Roman)
- Secondary font: Trebuchet MS for UI elements

## Key Facts
- Fiscal year starts July 1
- Gift dates from the API (ISO date-only strings) are parsed in LOCAL time, not
  UTC, so boundary gifts (the 1st of a month, July 1) land in the correct
  month and fiscal year (parseDateFlexible)
- Dashboard auto-selects "Offertory" fund if found
- Two LGL scheduled reports feed the dashboard (Offertory-only and All Funds)
- When a new fund is added in LGL, manually add it to the FULL GIVING REPORT's fund selection
- LGL API key: Settings > Integration Settings > LGL API
- Data flow: permanent link (bulk daily) + API top-up (real-time recent gifts)
- Counting rhythm (drives v2 week completeness, confirmed by Eric 2026-08-11):
  Pushpay credit-card gifts flow into LGL live; money counters count plate
  cash/checks on WEDNESDAY, make the deposit, then Barb enters them, so plate
  money is USUALLY in LGL by Thursday; Eric's manual export-imports are
  PLANNED for Monday and Thursday but are manual and can slip — never
  hard-code that schedule (Eric, 2026-08-11: "you're being too rigid").
- Evidence-based completeness (v1.3.0): /api/lgl-plate-status asks the LGL
  API whether any gift in the newest ended week carries a check/cash
  payment_type_name. true → week completes from WEDNESDAY (count day);
  false → stays "counting" past Thursday until the count actually lands;
  null (no key, API error, no payment-type fields, suspected ignored-key
  dump) → calendar fallback: complete from THURSDAY after the ending Sunday.
  Older weeks are always calendar. UNVERIFIED ON LIVE: the payment_type_name
  values St. Edward actually uses — the endpoint returns a `types` array and
  logs `[plate]` lines on Render; check once after deploy that plate weeks
  show types matching /check|cash/i, and update the regex if the parish uses
  different names. (The gift report/CSV paths still expose no payment type;
  only this server-side API check sees it.)
- 5-minute server-side cache on hybrid/recent endpoints

## Historical Data
- HISTORICAL_MONTHLY constant in Dashboard.jsx contains pre-aggregated monthly gift
  totals from the PDS/Pushpay import (Jul 2019 – Dec 2024, 42 funds, ~978 entries)
- Source: LGL_Historical_Import.csv (63k rows of individual gifts)
- These backfill months where the LGL scheduled report has no data
- Only funds present in the loaded LGL report appear in the fund selector;
  historical-only funds are NOT added to avoid polluting the Offertory view
- "All Funds (Total)" toggle is hidden on the Offertory-only report because
  rawGifts only contains Offertory data — the total would be misleading

## Chart Behavior
- Per-fund trend badge (shown for <=6 funds, hidden on the All-history view):
  shows this fund's giving this period vs the SAME fund's giving in the equivalent
  prior-year window, completed months only. A new fund reads "New this FY".
  This replaced the old regression-slope percent, which clamped to a misleading
  0.0% for funds that spike late and could even point the wrong direction. The
  regression line (computeTrend) is kept ONLY as the dashed visual trendline; the
  badge number comes from periodBuckets + fundTrends.
- SmartDataLabel: collision-aware labels that skip overlapping text by index, but
  always keep the series' largest spike labeled. Negative months format as -$1.2k.
- Standard chart uses DataLabel for YoY/FY Compare (fewer points), SmartDataLabel otherwise
- When >6 funds selected: totals collapse to summary, trend badges hidden
- When >8 funds selected: chart legend hidden, chart height increases to 500px
- Log scale toggle for mixed-magnitude comparisons; $0 months render as a gap
  (logSafeChartData) because zero cannot plot on a log axis
- FY Compare and YoY clip every fiscal/calendar year to the same completed-month
  window so a partial current year is not compared against full prior years; the
  in-progress month is excluded from comparison totals (marked * on the YoY chart)
- Single left Y-axis (the earlier right axis was removed)

## v2 (staging) — added 2026-08-10
Live at /v2 behind the same SSO; v1 remains the default. Design doc:
docs/v2-proposal.html. Answer-first single page: Monday briefing (three answer
blocks + Copy for Bulletin, payload byte-identical to v1), Recent Weeks panel,
evidence chart with Period/View segmented controls, merged Compare Years view
(computed years, on-screen deltas), ranked fund ledger, pivot table.
- Weekly rules: weeks run Mon-Sun labeled by ending Sunday; a week is complete
  from the THURSDAY after its Sunday (calendar fallback; the newest week
  prefers plate-status EVIDENCE — see Key Facts); provisional weeks render striped gold,
  get no comparisons, and are excluded from the 4-week average and FY pace;
  prior-year partner week = 364 days back; holy-day weeks (Christmas, Easter,
  Ash Wednesday) suppress percent comparisons; weekly floor is Jan 2025
  (HISTORICAL_MONTHLY is monthly-only and never feeds weekly buckets).
- v2 requests the API top-up with ?axis=union: server queries updated_from AND
  gift_date_from and merges, with guards (received-date post-filter + count
  heuristic) so an invalid gift_date_from key can never make results worse than
  v1's updated_from baseline. VERIFIED ON LIVE 2026-08-11: masthead showed
  "Updated Aug 11, 10:04 AM" (a timestamp renders only when the top-up call
  succeeds and returns refreshedAt), so the union top-up works with the
  production key. "+N recent" was absent only because the report file was
  from the same day; a "+N" sighting on a stale-file day is a bonus check,
  not required.
- Build/verification history: three-concept design fan-out + judged hybrid,
  then a 22-agent adversarial verification pass (weekly math executed under
  node, v1-fidelity diff, UI + server review); 11 confirmed findings fixed
  pre-ship.

## Deferred / Known Issues (flagged 2026-06-21)
A 2026-06-21 multi-agent audit found 17 confirmed correctness bugs. All but the
two below were fixed in commit 2f0a3e8. Status after the 2026-08-10 v2 work:
- v1 recent-gifts query still filters by gift UPDATE date (q[] updated_from);
  v1 behavior is intentionally unchanged. v2 uses the guarded union axis above.
- v1 YoY view still hardcodes calendar years 2025/2026 (mislabels after July
  2026). v2's Compare Years computes its years. Fix v1 only if it stays around.

## User
Eric is not a developer. Explain before running destructive commands.
Do not assume Git or npm knowledge beyond copy-paste.
