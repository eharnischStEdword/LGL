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
- React 18 frontend built with Vite 6, all UI in src/Dashboard.jsx
- Node.js + Express backend in server.js
  - Proxies LGL permanent links (CORS)
  - Hybrid endpoint: parses Offertory XLSX server-side, merges LGL API gifts
  - Lightweight /api/lgl-recent-gifts endpoint for All Funds client-side top-up
  - Microsoft Entra ID SSO with email allow-list
- Recharts for charts, SheetJS (xlsx) for spreadsheet parsing
- No router, no state management library

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
- Dashboard auto-selects "Offertory" fund if found
- Two LGL scheduled reports feed the dashboard (Offertory-only and All Funds)
- When a new fund is added in LGL, manually add it to the FULL GIVING REPORT's fund selection
- LGL API key: Settings > Integration Settings > LGL API
- Data flow: permanent link (bulk daily) + API top-up (real-time recent gifts)
- 5-minute server-side cache on hybrid/recent endpoints

## User
Eric is not a developer. Explain before running destructive commands.
Do not assume Git or npm knowledge beyond copy-paste.
