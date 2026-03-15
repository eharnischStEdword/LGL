# St. Edward Church - Fund Giving Dashboard

A client-side dashboard for visualizing fund giving data exported from Little Green Light. Built for St. Edward Church, Nashville TN.

No data leaves the browser. The CSV is parsed and charted entirely on the client.

## How to use

1. In LGL, run a **Comprehensive Export**
2. Unzip the downloaded file
3. Open the extracted folder, then open **Full_Archive**
4. Upload **gift_gifts.csv** to the dashboard

The tool auto-detects columns for gift date, gift amount, and fund. If your export uses different column names, manual mapping dropdowns appear.

## Local development

```
npm install
npm run dev
```

Opens at http://localhost:5173

## Build for production

```
npm run build
```

Output goes to `dist/`. That folder contains everything needed to serve the site.

## Deploy to Render

Two options:

**Option A: Blueprint (render.yaml)**
1. Push this repo to GitHub
2. In Render, click New > Blueprint
3. Point it at this repo
4. Render reads `render.yaml` and sets everything up

**Option B: Manual static site**
1. Push this repo to GitHub
2. In Render, click New > Static Site
3. Connect your GitHub repo
4. Build command: `npm install && npm run build`
5. Publish directory: `dist`
6. Set NODE_VERSION environment variable to `20`

Either way, Render auto-deploys on every push to main.

## Custom domain

After the site is live on Render:
1. In Render dashboard, go to the site's Settings > Custom Domains
2. Add your domain (e.g., dashboard.stedward.org)
3. Render gives you a CNAME record to add in your DNS settings

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

## Tech stack

- React 18
- Vite 6
- Recharts (charting)
- PapaParse (CSV parsing)
- No backend, no database, no API keys
