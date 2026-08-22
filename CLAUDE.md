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
- `npm test` - Run the hub-exit tests (node's built-in runner, no extra deps)

## Deploy
Push to main branch. Render auto-deploys from GitHub.
- Repo: https://github.com/eharnischStEdword/LGL
- Live: https://lgl.onrender.com
- Render build command: npm install && npm run build
- Render start command: node server.js
- Render type: Web Service (not Static Site)

## Architecture
- React 18 frontend built with Vite 6
  - v1 (default, at /): all UI in src/Dashboard.jsx — frozen, do not modify while
    v2 is staging (sole exception so far: the "Try the New View (v2)" button on
    the landing screen, added at Eric's ask 2026-08-11)
  - v2 (staging, at /v2): src/v2/* — DashboardV2.jsx orchestrator; lib.js holds
    math copied VERBATIM from v1 plus the new weekly engine; historical.js is a
    verbatim copy of HISTORICAL_MONTHLY. src/App.jsx routes on pathname.
- lgl-api.js: every call to the LGL gift search, so the paging can be tested
  without booting Express or holding an API key
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
- HUB_EXIT_TOKEN: shared secret for the PLT hub's read-only exit (see below).
  Unset means the exit answers 503 and the hub records nothing, which is the
  correct state until the same value is set on both sides.

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
- Evidence-based completeness (v1.3.0, REPAIRED 2026-08-22): /api/lgl-plate-status
  asks the LGL API whether any OFFERTORY gift in the newest ended week carries a
  check/cash payment_type_name. true → week completes from WEDNESDAY (count day);
  false → stays "counting" past Thursday until the count actually lands;
  null (no key, API error, no payment-type fields, or a read that could not be
  proved complete) → calendar fallback: complete from THURSDAY after the ending
  Sunday. Older weeks are always calendar.
- IT WAS DEAD FROM 2026-08-17 TO 2026-08-22 AND NOTHING SAID SO. The detector
  queried `gift_date_from`, which LGL rejects with 400 Unknown query parameter,
  and the route's catch turned every rejection into null, so v2 silently ran on
  the calendar rule for five days. The logic now lives in `plate-status.js`,
  reads through the same `fetchGiftsForRange` the hub exit uses (updated_from,
  45-day lookback, proved complete against LGL's own total_items, one shared
  dump), and `tests/plate-status.test.js` asserts the first thing asked is
  updated_from. Two behaviour changes went in with it: the count is Offertory
  only (a cash gift to another fund used to say the plate had landed), and a
  read that did not finish answers null rather than false.
- STILL UNVERIFIED ON LIVE: the payment_type_name values St. Edward actually
  uses — the endpoint returns a `types` array and logs `[plate]` lines on
  Render; check once after deploy that plate weeks show types matching
  /check|cash/i, and update the regex if the parish uses different names. (The
  gift report/CSV paths still expose no payment type; only this server-side API
  check sees it.)
- 5-minute server-side cache on hybrid/recent endpoints

## PLT hub exit (added 2026-08-20)
`GET /api/hub/v1/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD`, implemented in
hub-exit.js and wired in server.js. Version 1 of the exit contract in
`docs/exit-contract.md` in the st-edward-plt-dashboard repo. The Service System
implements the same contract in hub_exit.py; keep the two in step.
- Auth is a bearer token compared in constant time against HUB_EXIT_TOKEN. It is
  NOT requireAuth: the session gate lets everything under /api through, so this
  route owns its own door. The path is matched exactly, and anything else under
  /api/hub is refused with a 404 so a near miss cannot fall through to the SPA.
- Returns two figures for the Offertory fund, both in whole cents:
  `giving.lgl_plate` (cash and check, what came in the basket) and
  `giving.lgl_online` (every other payment type). The plate/online predicate is
  `isPlateType` in hub-exit.js, the SAME one the v2 plate-status detector uses.
- Gifts are filtered on `received_date`, the field the plate detector uses,
  because the hub sets these beside a hand count of the same Sunday.
- A gift with no payment type is counted in NEITHER figure and disclosed in the
  freshness signals (`unclassified`, `unclassified_cents`), so the plate can
  never quietly under-report.
- Failure is silence, not a wrong number: an LGL read that fails, or one that
  did not reach the end of LGL's result set, returns a non-200 with an `error`.
  It never returns zeros, because a zero is a claim that nothing was given.
- THE 2026-08-22 BACKFILL REFUSED 65 OF 79 WEEKS, and the ceiling was why. It
  was sized from a gift RATE (63,000 gifts over 66 months, near 31 a day, so a
  445-day window was reckoned at 14,000 records and 25,000 called comfortable).
  The rate was never what mattered: `updated_from` selects on when a record was
  last TOUCHED, so one bulk edit inside LGL restamps everything it touches and
  every query reaching past that day returns all of it. A week whose query
  reached back only four months was already over 25,000. MAX_RECORDS is 75,000
  now, sized against the whole database rather than a rate, because an
  updated_from query cannot return more rows than LGL holds. The refusal also
  LOGS now: it was the one refusal in hub-exit.js that said nothing, so those 65
  weeks left no trace on this service at all.
- THE DEEP WALK ASKS FOR 1,000 ROWS A PAGE (`LGL_DEEP_PAGE_SIZE`), and the
  legacy `fetchLGLApiGiftsAxis` still asks for 100 and must keep doing so: it
  advances its offset by the LIMIT rather than by what came back, and
  PAGE_CAP_SUSPECT is "50 pages of 100". A 100-row page measured 2.4 seconds
  against live LGL (1,750 records in 42 seconds), which is almost all round
  trip, so a full-depth walk at 100 is over four hours and the 60-second budget
  could never converge on it. LGL's maximum page size is NOT documented anywhere
  this repo can reach, so the walk is written to survive being wrong both ways:
  a page smaller than requested is measured rather than assumed (a short page
  only ends the walk when LGL has stopped sending a total, and it is compared
  against what was SERVED, never against what was asked for, or a server-side
  cap would read as the end and publish a tenth of the results as complete), and
  a limit LGL refuses IN WORDS THAT SAY "limit" drops to 100 for that walk. Any
  other rejection is still asked exactly once.
- Deep reads PAGE THROUGH (2026-08-21). LGL does not accept `gift_date_from`, so
  the query is `updated_from`, which reaches back 45 days before the window and
  drags in every record touched since. A week in 2025 is therefore about
  thirteen months of gifts, far past the old 50-page walk, and the exit refused
  every one of them: that is why the hub holds only recent weeks of giving and
  the PLT dashboard's "vs a year ago" tile reads no match. hub-exit.js now walks
  the whole result set, proving it reached the end against LGL's own
  `total_items` rather than guessing from how much came back. Three bounds, all
  of which REFUSE rather than truncate: `READ_BUDGET_MS` (60s, two thirds of the
  hub's 90s client timeout), `MAX_RECORDS` (25,000) and `MAX_PAGES` (250). A walk
  that runs out of budget keeps its progress, so the next request resumes at the
  offset it stopped at instead of re-pulling thirteen months; a backfill issues
  its weeks back to back, so a pull too big for one request finishes inside the
  same run.
- Paging and retry live in `lgl-api.js`: `fetchLGLApiGiftsAxis` is the original
  50-page walk (hybrid and recent-gifts still use it, unchanged; the plate
  detector moved off it on 2026-08-22) and `fetchLGLApiGiftsPaged` is the one
  that reports whether it finished. Both retry a 429 or a 5xx with a short backoff, which is the first
  rate-limit handling this repo has ever had. LGL's actual limits are NOT
  verified; 429-with-Retry-After is an assumption written down in that file.
- Aggregates only. No donor name, no email, no gift id, no address, ever.

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
- First-visit tour (2026-08-12): src/v2/Tour.jsx auto-runs once per browser
  (sev2.tourSeen, stamped at start), six steps that scroll to and glow
  [data-tour] targets (freshness dot, answer band, weeks, chart, Customize
  layout); no library, no mask. Replay via "Show me around" in the masthead.
- Saved layout (2026-08-12, from Robin's "too much up top"): the five content
  sections reorder by drag or arrows ("Customize layout" above the answer
  band) and persist per browser in localStorage key sev2.layoutOrder; unknown
  ids are dropped and new sections append, so layout upgrades are safe. The
  default order is unchanged; each user arranges their own.
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
