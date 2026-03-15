# CLAUDE.md

## Project
St. Edward Church (Nashville TN) Fund Giving Dashboard.
Client-side React app that visualizes LGL (Little Green Light) gift data by fund.
Branded with official St. Edward colors. No backend. No data leaves the browser.

## Commands
- `npm run dev` - Start dev server at http://localhost:5173
- `npm run build` - Production build to dist/
- `npm run preview` - Preview production build locally

## Deploy
Push to main branch. Render auto-deploys from GitHub.
- Repo: https://github.com/eharnischStEdword/LGL
- Live: https://lgl-dashboard.onrender.com
- Render build command: npm install && npm run build
- Render publish dir: dist

## Architecture
- Single-page React 18 app built with Vite 6
- All logic lives in src/Dashboard.jsx (one big component)
- Recharts for charts, PapaParse for CSV parsing
- No router, no state management library, no backend

## Brand Colors (from official style guide)
- Green PMS 348C: #00843D (primary), #005921 (dark)
- Gold PMS 110C: #DAAA00 (primary), #DDCC71 (light)
- Blue PMS 2955C: #003764 (alternate)
- Off-white: #EEF4F1
- Font: Georgia (approximating Mrs Eaves Roman)
- Secondary font: Trebuchet MS for UI elements

## Key Facts
- Fiscal year starts July 1
- Dashboard auto-selects "Offertory" fund if found
- CSV source: LGL Comprehensive Export > Full_Archive > gift_gifts.csv
- LGL Zapier/webhooks are inbound-only, cannot export data
- Data export options: Permanent Links (scheduled reports) or LGL API

## User
Eric is not a developer. Explain before running destructive commands.
Do not assume Git or npm knowledge beyond copy-paste.
