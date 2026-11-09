import DashboardV2 from './v2/DashboardV2.jsx'

// One dashboard at every path. The classic view was retired on 2026-11-09;
// the server's SPA catch-all still serves /v2, so old bookmarks keep working.
export default function App() {
  return <DashboardV2 />;
}
