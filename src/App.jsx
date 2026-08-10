import Dashboard from './Dashboard.jsx'
import DashboardV2 from './v2/DashboardV2.jsx'

// v1 stays the default; the v2 redesign lives at /v2 while both run in
// parallel. No router — the server's SPA catch-all serves index.html for
// both paths and we branch on pathname once at mount.
export default function App() {
  const path = window.location.pathname.replace(/\/+$/, "") || "/";
  if (path === "/v2") return <DashboardV2 />;
  return <Dashboard />;
}
