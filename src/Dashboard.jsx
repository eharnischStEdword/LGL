import { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar, LabelList
} from "recharts";
// Papa removed — no longer needed since we pull directly from LGL
import * as XLSX from "xlsx";

/*
  St. Edward Church & School, Nashville TN
  Brand colors from official Style Guide (ses.stedward.org/branding):
    Green PMS 348C:  #00843D (primary), #005921 (dark)
    Gold PMS 110C:   #DAAA00 (primary), #DDCC71 (light)
    Blue PMS 2955C:  #003764 (alternate)
    Off-white:       #EEF4F1
    Font:            Mrs Eaves Roman (approximated with Georgia)
*/

const SE_GREEN = "#00843D";
const SE_GREEN_DARK = "#005921";
const SE_GOLD = "#DAAA00";
const SE_BLUE = "#003764";
const SE_OFFWHITE = "#EEF4F1";

const FUND_COLORS = [
  SE_GREEN, SE_GOLD, SE_BLUE, "#2e8b57", "#b8860b",
  "#3a7a5c", "#8B6914", "#00843D", "#c49000", "#005921",
  "#d4a72c", "#1a6b3c", "#a67c00", "#22763e", "#e6b422"
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FY_START_MONTH = 7; // July
const DATA_FLOOR = new Date(2025, 0, 1); // January 1, 2025 — nothing before this

// Proxied through our server to avoid CORS issues
const LGL_OFFERTORY_ENDPOINT = "/api/lgl-data";
const LGL_ALL_FUNDS_ENDPOINT = "/api/lgl-all-funds";

const sans = "'Trebuchet MS', 'Calibri', sans-serif";
const serif = "'Georgia', 'Cambria', serif";

// Fiscal month labels in FY order (Jul=0 through Jun=11)
const FY_MONTH_LABELS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

function parseXlsx(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function parseDateFlexible(str) {
  if (!str) return null;
  // Handle Excel serial date numbers (e.g., 46093 or 46093.0)
  const num = typeof str === "number" ? str : parseFloat(str);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    // Excel serial: days since 1899-12-30 (use local time, not UTC)
    const d = new Date(1899, 11, 30 + Math.floor(num));
    if (!isNaN(d.getTime())) return d;
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return null;
}

function parseAmount(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[$,\s]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function detectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  let dateCol = null, amountCol = null, fundCol = null;
  const datePatterns = ["gift date", "gift_date", "giftdate", "date", "deposit date", "deposit_date"];
  const amountPatterns = ["gift amount", "gift_amount", "giftamount", "amount", "gift amt", "total"];
  const fundPatterns = ["fund", "fund name", "fund_name"];
  for (const p of datePatterns) {
    const idx = lower.findIndex(h => h === p || h.includes(p));
    if (idx !== -1) { dateCol = headers[idx]; break; }
  }
  for (const p of amountPatterns) {
    const idx = lower.findIndex(h => h === p || h.includes(p));
    if (idx !== -1) { amountCol = headers[idx]; break; }
  }
  for (const p of fundPatterns) {
    const idx = lower.findIndex(h => h === p || h.includes(p));
    if (idx !== -1) { fundCol = headers[idx]; break; }
  }
  return { dateCol, amountCol, fundCol };
}

function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

function getMonthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[parseInt(m)-1]} ${y}`;
}

function getFYStart(date) {
  const y = date.getMonth() < FY_START_MONTH - 1 ? date.getFullYear() - 1 : date.getFullYear();
  return new Date(y, FY_START_MONTH - 1, 1);
}

function getFYLabel() {
  const now = new Date();
  const start = getFYStart(now);
  const endYear = start.getFullYear() + 1;
  return `FY ${start.getFullYear()}-${String(endYear).slice(2)}`;
}

// Linear regression trend line computation
// Returns { data, pct } where pct is the % change from first to last trend value
function computeTrend(data, key) {
  const points = data.map((d, i) => ({ x: i, y: d[key] || 0 }));
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const first = Math.max(0, intercept);
  const last = Math.max(0, intercept + slope * (n - 1));
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const trendData = data.map((d, i) => ({ ...d, [`${key}_trend`]: Math.max(0, intercept + slope * i) }));
  return { data: trendData, pct };
}

// Custom label for data points
const DataLabel = ({ x, y, width, value }) => {
  if (!value || value === 0) return null;
  const label = value >= 1000 ? `$${(value/1000).toFixed(1)}k` : `$${value.toFixed(0)}`;
  // For bars, Recharts passes width — center the label over the bar
  const cx = width != null ? x + width / 2 : x;
  return (
    <text x={cx} y={y - 12} textAnchor="middle" fill="#555" fontSize={16} fontFamily={sans}>
      {label}
    </text>
  );
};

export default function Dashboard() {
  const [rawGifts, setRawGifts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [selectedFunds, setSelectedFunds] = useState(new Set());
  const [timeRange, setTimeRange] = useState("last12");
  const [chartType, setChartType] = useState("line");
  const [colMapping, setColMapping] = useState({ dateCol: null, amountCol: null, fundCol: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [fetching, setFetching] = useState(false);
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [fyRevenue, setFyRevenue] = useState("");
  const [fyExpenses, setFyExpenses] = useState("");
  const [fyCalced, setFyCalced] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    fetch("/auth/status")
      .then(r => r.json())
      .then(data => {
        if (data.authenticated) {
          setAuthUser(data.user);
        }
        setAuthChecked(true);
      })
      .catch(() => setAuthChecked(true));
  }, []);

  const loadRows = useCallback((rows, sourceName) => {
    if (!rows || rows.length === 0) {
      setError("File appears empty or could not be parsed.");
      return;
    }
    const hdrs = Object.keys(rows[0]);
    setFileName(sourceName);
    const detected = detectColumns(hdrs);
    if (!detected.dateCol || !detected.amountCol || !detected.fundCol) {
      setColMapping(detected);
      setError(
        `Could not auto-detect all columns. Found: Date="${detected.dateCol || "?"}", Amount="${detected.amountCol || "?"}", Fund="${detected.fundCol || "?"}". Available columns: ${hdrs.join(", ")}`
      );
      setRawGifts(rows);
      setLoaded(false);
      return;
    }
    setColMapping(detected);
    processData(rows, detected);
  }, []);


  const fetchFromLGL = useCallback(async (offertoryOnly = false) => {
    setError(null);
    setFetching(true);
    try {
      const endpoint = offertoryOnly ? LGL_OFFERTORY_ENDPOINT : LGL_ALL_FUNDS_ENDPOINT;
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const buf = await resp.arrayBuffer();
      const allRows = parseXlsx(buf);
      const label = offertoryOnly ? "LGL - Offertory (live)" : "LGL - All Funds (live)";
      loadRows(allRows, label);
    } catch (err) {
      setError(`Could not fetch from LGL: ${err.message}`);
    } finally {
      setFetching(false);
    }
  }, [loadRows]);

  const processData = useCallback((data, mapping) => {
    const { dateCol, amountCol, fundCol } = mapping;
    if (!dateCol || !amountCol || !fundCol) return;
    const gifts = [];
    const fundSet = new Set();
    for (const row of data) {
      const date = parseDateFlexible(row[dateCol]);
      const amount = parseAmount(row[amountCol]);
      const fund = (row[fundCol] || "").trim();
      if (date && fund && date >= DATA_FLOOR) {
        gifts.push({ date, amount, fund });
        fundSet.add(fund);
      }
    }
    if (gifts.length === 0) {
      setError("No valid gift rows found. Check that date and amount columns contain recognizable data.");
      return;
    }
    const sortedFunds = [...fundSet].sort();
    setRawGifts(gifts);
    setFunds(sortedFunds);
    const initial = new Set();
    const offertoryMatch = sortedFunds.find(f => f.toLowerCase().includes("offertory"));
    if (offertoryMatch) initial.add(offertoryMatch);
    else if (sortedFunds.length > 0) initial.add(sortedFunds[0]);
    setSelectedFunds(initial);
    setLoaded(true);
    setError(null);
  }, []);


  const filteredData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange === "yoy" || timeRange === "fyoy") return [];
    const now = new Date();
    let startDate;
    if (timeRange === "last12") startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    else if (timeRange === "ytd") startDate = new Date(now.getFullYear(), 0, 1);
    else if (timeRange === "fy") startDate = getFYStart(now);
    else if (timeRange === "last24") startDate = new Date(now.getFullYear() - 2, now.getMonth(), 1);
    else if (timeRange === "all") startDate = new Date(DATA_FLOOR);
    else startDate = new Date(DATA_FLOOR);
    // Enforce hard floor
    if (startDate < DATA_FLOOR) startDate = new Date(DATA_FLOOR);
    const relevant = rawGifts.filter(g => g.date >= startDate && g.date <= now && selectedFunds.has(g.fund));
    const monthMap = {};
    for (const g of relevant) {
      const mk = getMonthKey(g.date);
      if (!monthMap[mk]) monthMap[mk] = {};
      if (!monthMap[mk][g.fund]) monthMap[mk][g.fund] = 0;
      monthMap[mk][g.fund] += g.amount;
    }
    const allMonths = new Set();
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    while (cursor <= now) {
      allMonths.add(getMonthKey(cursor));
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return [...allMonths].sort().map(mk => {
      const row = { month: getMonthLabel(mk), _key: mk };
      for (const f of selectedFunds) row[f] = monthMap[mk]?.[f] || 0;
      return row;
    });
  }, [rawGifts, selectedFunds, timeRange, loaded]);

  // Add trend data to filteredData + compute trend %
  const { chartData, trendPcts } = useMemo(() => {
    if (filteredData.length < 2) return { chartData: filteredData, trendPcts: {} };
    let result = filteredData;
    const pcts = {};
    for (const f of selectedFunds) {
      const trend = computeTrend(result, f);
      if (trend) {
        result = trend.data;
        pcts[f] = trend.pct;
      }
    }
    return { chartData: result, trendPcts: pcts };
  }, [filteredData, selectedFunds]);

  const totals = useMemo(() => {
    if (!loaded) return {};
    const t = {};
    for (const f of selectedFunds) t[f] = filteredData.reduce((sum, row) => sum + (row[f] || 0), 0);
    return t;
  }, [filteredData, selectedFunds, loaded]);

  // ─── YoY comparison data ───
  const yoyData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || (timeRange !== "yoy" && timeRange !== "fyoy")) return [];
    const now = new Date();
    const fyYears = [2024, 2025];

    // For FY YoY, figure out which fiscal month index we're currently in
    const currentCalMonth = now.getMonth(); // 0-11
    const currentFYMonthIdx = (currentCalMonth - FY_START_MONTH + 13) % 12; // 0=Jul, 1=Aug, ..., 11=Jun

    const rows = FY_MONTH_LABELS.map((label, fyMonthIdx) => {
      // For fyoy, only include months up to the current fiscal month
      if (timeRange === "fyoy" && fyMonthIdx > currentFYMonthIdx) return null;
      const row = { month: label };
      for (const fy of fyYears) {
        const calMonth = (fyMonthIdx + FY_START_MONTH - 1) % 12;
        const calYear = fyMonthIdx < 6 ? fy : fy + 1;
        for (const fund of selectedFunds) {
          const key = `${fund} (${fy}-${String(fy + 1).slice(2)})`;
          let total = 0;
          for (const g of rawGifts) {
            if (g.fund === fund
              && g.date.getMonth() === calMonth
              && g.date.getFullYear() === calYear
              && g.date <= now) {
              total += g.amount;
            }
          }
          row[key] = total;
        }
      }
      return row;
    }).filter(Boolean);
    return rows;
  }, [rawGifts, selectedFunds, timeRange, loaded]);

  const yoySeriesKeys = useMemo(() => {
    if (timeRange !== "yoy" && timeRange !== "fyoy") return [];
    const keys = [];
    for (const fund of [...selectedFunds].sort()) {
      keys.push(`${fund} (2024-25)`);
      keys.push(`${fund} (2025-26)`);
    }
    return keys;
  }, [selectedFunds, timeRange]);

  const yoyTotals = useMemo(() => {
    if ((timeRange !== "yoy" && timeRange !== "fyoy") || yoyData.length === 0) return {};
    const t = {};
    for (const key of yoySeriesKeys) {
      t[key] = yoyData.reduce((sum, row) => sum + (row[key] || 0), 0);
    }
    return t;
  }, [yoyData, yoySeriesKeys, timeRange]);

  const toggleFund = (fund) => {
    setSelectedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fund)) next.delete(fund);
      else next.add(fund);
      return next;
    });
  };

  const goHome = () => { setLoaded(false); setRawGifts([]); setFunds([]); setFileName(null); setError(null); setFyRevenue(""); setFyExpenses(""); setFyCalced(false); };
  const selectAll = () => setSelectedFunds(new Set(funds));
  const selectNone = () => setSelectedFunds(new Set());
  const fmt = (v) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  const fmtFull = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null;
    // Filter out trend lines from tooltip
    const real = payload.filter(p => !p.dataKey.endsWith("_trend"));
    return (
      <div style={{
        background: SE_GREEN_DARK,
        border: `1px solid ${SE_GOLD}44`,
        borderRadius: 6,
        padding: "12px 16px",
        fontSize: 16,
        color: SE_OFFWHITE,
        fontFamily: sans,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: "#fff", fontFamily: serif }}>{label}</div>
        {real.map((p, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 3 }}>
            <span style={{ color: p.color }}>{p.dataKey}</span>
            <span style={{ fontWeight: 700, color: "#fff" }}>{fmtFull(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const fundColorMap = {};
  funds.forEach((f, i) => { fundColorMap[f] = FUND_COLORS[i % FUND_COLORS.length]; });

  // YoY colors
  const yoyColorMap = {};
  for (const fund of funds) {
    const base = fundColorMap[fund];
    yoyColorMap[`${fund} (2024-25)`] = base;
    yoyColorMap[`${fund} (2025-26)`] = base;
  }

  const activeFunds = [...selectedFunds].sort();

  // ─── UPLOAD SCREEN ───
  if (!loaded) {
    return (
      <div style={{
        minHeight: "100vh",
        background: SE_OFFWHITE,
        fontFamily: sans,
        color: "#333",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32
      }}>
        <div style={{ textAlign: "center", maxWidth: 600, width: "100%" }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%",
            background: SE_GREEN, display: "flex", alignItems: "center",
            justifyContent: "center", margin: "0 auto 16px",
            color: SE_GOLD, fontSize: 26, fontFamily: serif, fontWeight: 700
          }}>
            &#10013;
          </div>

          <h1 style={{
            fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK,
            margin: "0 0 2px", fontFamily: serif
          }}>
            St. Edward Church
          </h1>
          <p style={{
            color: SE_GOLD, fontSize: 16, marginBottom: 4,
            letterSpacing: "0.12em", textTransform: "uppercase",
            fontWeight: 700, fontFamily: sans
          }}>
            Fund Giving Dashboard
          </p>
          <div style={{
            width: 50, height: 2, margin: "0 auto 28px",
            background: `linear-gradient(90deg, ${SE_GREEN}, ${SE_GOLD})`
          }} />

          {/* Option 1: Offertory auto-pull */}
          <button
            onClick={() => fetchFromLGL(true)}
            disabled={fetching}
            style={{
              width: "100%", padding: "16px 24px",
              background: fetching ? "#ccc" : SE_GREEN,
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 18, fontWeight: 700, cursor: fetching ? "wait" : "pointer",
              fontFamily: serif, marginBottom: 10,
              boxShadow: "0 2px 8px rgba(0,132,61,0.25)",
              transition: "all 0.2s"
            }}
          >
            {fetching ? "Fetching from LGL..." : "Load Offertory Data"}
          </button>
          <p style={{ fontSize: 16, color: "#999", marginTop: 0, marginBottom: 18 }}>
            Pulls the latest Offertory giving data directly from LGL. Reports are automatically refreshed once every weekday.
          </p>

          {/* Option 2: All funds */}
          <button
            onClick={() => fetchFromLGL(false)}
            disabled={fetching}
            style={{
              width: "100%", padding: "14px 24px",
              background: "#fff",
              color: SE_GREEN_DARK, border: `2px solid ${SE_GREEN}`,
              borderRadius: 10,
              fontSize: 18, fontWeight: 700, cursor: fetching ? "wait" : "pointer",
              fontFamily: serif, marginBottom: 10,
              transition: "all 0.2s"
            }}
          >
            Load All Funds Report
          </button>
          <p style={{ fontSize: 16, color: "#999", marginTop: 0, marginBottom: 20 }}>
            Pulls all fund data from LGL (Offertory, Capital Campaign, etc.)
          </p>

          {/* Error display */}
          {error && (
            <div style={{
              marginTop: 10, padding: "14px 18px",
              background: "#fff8f0", border: "1px solid #e8c87040",
              borderRadius: 8, fontSize: 16, color: "#8B6914",
              textAlign: "left", lineHeight: 1.5
            }}>
              {error}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── DASHBOARD ───
  return (
    <div style={{
      minHeight: "100vh",
      background: SE_OFFWHITE,
      fontFamily: sans,
      color: "#333",
      padding: "20px 24px"
    }}>
      {/* Header */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        marginBottom: 20, paddingBottom: 14,
        borderBottom: `2px solid ${SE_GREEN}18`, flexWrap: "wrap", gap: 10
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 36, height: 36, borderRadius: "50%",
            background: SE_GREEN, display: "flex", alignItems: "center",
            justifyContent: "center", color: SE_GOLD,
            fontSize: 17, fontFamily: serif, fontWeight: 700, flexShrink: 0
          }}>
            &#10013;
          </div>
          <div>
            <h1
              onClick={goHome}
              style={{
                fontSize: 22, fontWeight: 700, color: SE_GREEN_DARK,
                margin: 0, fontFamily: serif, lineHeight: 1.2,
                cursor: "pointer"
              }}
              title="Back to start"
            >
              St. Edward Fund Dashboard
            </h1>
            <p style={{ margin: 0, fontSize: 16, color: "#888" }}>
              {fileName} &middot; {rawGifts.length.toLocaleString()} gifts &middot; {funds.length} funds &middot; FY starts July 1
            </p>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {authUser && (
            <span style={{ fontSize: 16, color: "#888" }}>
              {authUser.name} &middot; <a href="/auth/logout" style={{ color: SE_GREEN, textDecoration: "none", fontWeight: 600 }}>Sign out</a>
            </span>
          )}
          <button
            onClick={goHome}
            style={{
              padding: "7px 16px", background: "#fff",
              border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
              color: SE_GREEN_DARK, fontSize: 16, fontWeight: 600,
              cursor: "pointer"
            }}
          >
            Start Again
          </button>
        </div>
      </div>

      {/* Time + chart controls */}
      <div style={{ display: "flex", gap: 5, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {[
          { key: "fy", label: getFYLabel() },
          { key: "ytd", label: "YTD" },
          { key: "last12", label: "Last 12 Mo" },
          { key: "last24", label: "Last 24 Mo" },
          { key: "all", label: "All (Since Jan '25)" },
          { key: "yoy", label: "YoY Compare" },
          { key: "fyoy", label: "FY YoY" }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTimeRange(key)}
            style={{
              padding: "9px 18px", borderRadius: 6,
              border: timeRange === key ? `2px solid ${SE_GREEN}` : "1px solid #ccc",
              background: timeRange === key ? `${SE_GREEN}12` : "#fff",
              color: timeRange === key ? SE_GREEN_DARK : "#777",
              fontSize: 16, fontWeight: timeRange === key ? 700 : 500,
              cursor: "pointer", transition: "all 0.15s"
            }}
          >
            {label}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        {["line", "bar"].map(t => (
          <button
            key={t}
            onClick={() => setChartType(t)}
            style={{
              padding: "9px 18px", borderRadius: 6,
              border: chartType === t ? `2px solid ${SE_GOLD}` : "1px solid #ccc",
              background: chartType === t ? `${SE_GOLD}15` : "#fff",
              color: chartType === t ? "#8B6914" : "#999",
              fontSize: 16, fontWeight: chartType === t ? 700 : 500,
              cursor: "pointer"
            }}
          >
            {t === "line" ? "Line" : "Bar"}
          </button>
        ))}
      </div>

      {/* Totals */}
      {activeFunds.length > 0 && timeRange !== "yoy" && timeRange !== "fyoy" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {activeFunds.map(f => (
            <div key={f} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${fundColorMap[f]}25`,
              borderLeft: `4px solid ${fundColorMap[f]}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(totals[f] || 0)}
              </div>
            </div>
          ))}
        </div>
      )}
      {/* YoY Totals */}
      {activeFunds.length > 0 && (timeRange === "yoy" || timeRange === "fyoy") && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {yoySeriesKeys.map(key => (
            <div key={key} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${yoyColorMap[key] || SE_GREEN}25`,
              borderLeft: `4px solid ${yoyColorMap[key] || SE_GREEN}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{key}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(yoyTotals[key] || 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Chart */}
      <div style={{
        background: "#fff", border: `1px solid ${SE_GREEN}12`,
        borderRadius: 8, padding: "18px 14px 10px",
        marginBottom: 18, boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
      }}>
        {(timeRange === "yoy" || timeRange === "fyoy") ? (
          /* ─── YoY / FY YoY Chart ─── */
          yoyData.length === 0 || activeFunds.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data for YoY comparison."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={370}>
              {chartType === "line" ? (
                <LineChart data={yoyData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {yoySeriesKeys.map(key => (
                    <Line
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stroke={yoyColorMap[key]}
                      strokeWidth={key.includes("24-25") ? 2 : 2.5}
                      strokeDasharray={key.includes("24-25") ? "6 3" : undefined}
                      dot={{ r: 3, fill: yoyColorMap[key] }}
                      activeDot={{ r: 5 }}
                    >
                      <LabelList content={<DataLabel />} />
                    </Line>
                  ))}
                </LineChart>
              ) : (
                <BarChart data={yoyData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {yoySeriesKeys.map(key => (
                    <Bar key={key} dataKey={key} fill={yoyColorMap[key]} radius={[3, 3, 0, 0]} opacity={key.includes("24-25") ? 0.5 : 0.88}>
                      <LabelList content={<DataLabel />} />
                    </Bar>
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          )
        ) : (
          /* ─── Standard Chart ─── */
          chartData.length === 0 || activeFunds.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data for the selected range."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={370}>
              {chartType === "line" ? (
                <LineChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {activeFunds.map(f => (
                    <Line key={f} type="monotone" dataKey={f} stroke={fundColorMap[f]} strokeWidth={2.5} dot={{ r: 3, fill: fundColorMap[f] }} activeDot={{ r: 5 }}>
                      <LabelList content={<DataLabel />} />
                    </Line>
                  ))}
                  {/* Trend lines */}
                  {activeFunds.map(f => (
                    <Line
                      key={`${f}_trend`}
                      type="linear"
                      dataKey={`${f}_trend`}
                      stroke={fundColorMap[f]}
                      strokeWidth={1.5}
                      strokeDasharray="8 4"
                      dot={false}
                      activeDot={false}
                      legendType="none"
                      opacity={0.5}
                    />
                  ))}
                </LineChart>
              ) : (
                <BarChart data={chartData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} interval="preserveStartEnd" />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {activeFunds.map(f => (
                    <Bar key={f} dataKey={f} fill={fundColorMap[f]} radius={[3, 3, 0, 0]} opacity={0.88}>
                      <LabelList content={<DataLabel />} />
                    </Bar>
                  ))}
                </BarChart>
              )}
            </ResponsiveContainer>
          )
        )}
      </div>

      {/* Trend indicator */}
      {timeRange !== "yoy" && timeRange !== "fyoy" && Object.keys(trendPcts).length > 0 && (
        <div style={{
          display: "flex", gap: 12, marginBottom: 14, flexWrap: "wrap"
        }}>
          {activeFunds.map(f => {
            const pct = trendPcts[f];
            if (pct == null) return null;
            const up = pct >= 0;
            const color = up ? SE_GREEN : "#c0392b";
            const arrow = up ? "▲" : "▼";
            const rangeLabel = {
              last12: "over last 12 months",
              last24: "over last 24 months",
              ytd: "year to date",
              fy: "this fiscal year",
              all: "since Jan 2025"
            }[timeRange] || "in this view";
            return (
              <div key={f} style={{
                display: "flex", alignItems: "center", gap: 6,
                padding: "6px 14px", background: `${color}08`,
                border: `1px solid ${color}20`, borderRadius: 6,
                fontSize: 16, fontFamily: sans
              }}>
                <span style={{
                  width: 10, height: 10, borderRadius: 3,
                  background: fundColorMap[f]
                }} />
                <span style={{ color: "#666" }}>{f}:</span>
                <span style={{ fontWeight: 700, color, fontSize: 18 }}>
                  {arrow} {Math.abs(pct).toFixed(1)}%
                </span>
                <span style={{ color: "#999", fontSize: 16 }}>{rangeLabel}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Fund selector */}
      <div style={{
        background: "#fff", border: `1px solid ${SE_GREEN}12`,
        borderRadius: 8, padding: "14px 18px",
        boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>Funds</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={selectAll} style={{ background: "none", border: "none", color: SE_GREEN, fontSize: 16, cursor: "pointer", fontWeight: 600 }}>All</button>
            <span style={{ color: "#ccc" }}>|</span>
            <button onClick={selectNone} style={{ background: "none", border: "none", color: SE_GREEN, fontSize: 16, cursor: "pointer", fontWeight: 600 }}>None</button>
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {funds.map(f => {
            const active = selectedFunds.has(f);
            const color = fundColorMap[f];
            return (
              <button
                key={f}
                onClick={() => toggleFund(f)}
                style={{
                  display: "flex", alignItems: "center", gap: 7,
                  padding: "5px 13px", borderRadius: 6,
                  border: active ? `2px solid ${color}` : "1px solid #ddd",
                  background: active ? `${color}10` : "#fafafa",
                  color: active ? SE_GREEN_DARK : "#999",
                  fontSize: 16, fontWeight: active ? 600 : 400,
                  cursor: "pointer", transition: "all 0.15s"
                }}
              >
                <span style={{
                  width: 10, height: 10, borderRadius: 3,
                  background: active ? color : "#ddd",
                  transition: "all 0.15s"
                }} />
                {f}
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Bulletin Snapshot ─── */}
      {loaded && (() => {
        // Find the Offertory fund
        const offertoryFund = funds.find(f => f.toLowerCase().includes("offertory"));
        if (!offertoryFund) return null;

        const now = new Date();
        // Last full calendar month
        const lastMonth = now.getMonth() === 0
          ? new Date(now.getFullYear() - 1, 11, 1)
          : new Date(now.getFullYear(), now.getMonth() - 1, 1);
        // Month before that
        const prevMonth = lastMonth.getMonth() === 0
          ? new Date(lastMonth.getFullYear() - 1, 11, 1)
          : new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 1, 1);
        // Same month 1 year ago
        const lastYearMonth = new Date(lastMonth.getFullYear() - 1, lastMonth.getMonth(), 1);

        function monthTotal(targetMonth, targetYear) {
          return rawGifts
            .filter(g => g.fund === offertoryFund && g.date.getMonth() === targetMonth && g.date.getFullYear() === targetYear)
            .reduce((sum, g) => sum + g.amount, 0);
        }

        const lastMonthTotal = monthTotal(lastMonth.getMonth(), lastMonth.getFullYear());
        const prevMonthTotal = monthTotal(prevMonth.getMonth(), prevMonth.getFullYear());
        const lastYearTotal = monthTotal(lastYearMonth.getMonth(), lastYearMonth.getFullYear());
        const monthDiff = lastMonthTotal - prevMonthTotal;
        const yearDiff = lastMonthTotal - lastYearTotal;

        const monthName = (d) => `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
        const diffColor = (v) => v >= 0 ? SE_GREEN : "#c0392b";
        const diffSign = (v) => v >= 0 ? "+" : "";

        return (
          <div style={{
            background: "#fff", border: `1px solid ${SE_GREEN}12`,
            borderRadius: 8, padding: "18px 22px", marginTop: 18,
            boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
          }}>
            <div style={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              marginBottom: 14
            }}>
              <span style={{ fontSize: 20, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                Financial Snapshot ({monthName(lastMonth)})
              </span>
              <span style={{
                fontSize: 16, color: "#aaa", fontStyle: "italic"
              }}>
                For parish bulletin
              </span>
            </div>

            {/* Monthly Collections */}
            <div style={{
              background: `${SE_GREEN}08`, borderRadius: 6, padding: "12px 16px",
              marginBottom: 12
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_GREEN_DARK,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 10, fontFamily: sans
              }}>
                Monthly Offertory Collections
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, fontFamily: sans }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "6px 0", color: "#444" }}>{monthName(lastMonth)}</td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                      {fmtFull(lastMonthTotal)}
                    </td>
                  </tr>
                  <tr style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px 0", color: "#444" }}>{monthName(prevMonth)}</td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                      {fmtFull(prevMonthTotal)}
                    </td>
                  </tr>
                  <tr style={{ borderTop: "1px solid #eee" }}>
                    <td style={{ padding: "6px 0", color: "#666" }}>{monthName(lastYearMonth)} <span style={{ color: "#aaa" }}>(comparison)</span></td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                      {lastYearTotal > 0 ? fmtFull(lastYearTotal) : <span style={{ color: "#aaa", fontWeight: 400, fontSize: 16 }}>No data</span>}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {/* Comparisons */}
            <div style={{
              background: `${SE_GOLD}10`, borderRadius: 6, padding: "12px 16px",
              marginBottom: 12
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: "#8B6914",
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 10, fontFamily: sans
              }}>
                Comparisons
              </div>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, fontFamily: sans }}>
                <tbody>
                  <tr>
                    <td style={{ padding: "6px 0", color: "#444" }}>
                      Month-to-month ({MONTHS[lastMonth.getMonth()]} vs {MONTHS[prevMonth.getMonth()]})
                    </td>
                    <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: diffColor(monthDiff), fontFamily: serif, fontSize: 18 }}>
                      {diffSign(monthDiff)}{fmtFull(Math.abs(monthDiff))}
                    </td>
                  </tr>
                  {lastYearTotal > 0 && (
                    <tr style={{ borderTop: "1px solid #eee" }}>
                      <td style={{ padding: "6px 0", color: "#444" }}>
                        Year-over-year ({monthName(lastMonth)} vs {monthName(lastYearMonth)})
                      </td>
                      <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: diffColor(yearDiff), fontFamily: serif, fontSize: 18 }}>
                        {diffSign(yearDiff)}{fmtFull(Math.abs(yearDiff))}
                        {lastYearTotal > 0 && (
                          <span style={{ fontSize: 16, fontWeight: 400, color: diffColor(yearDiff), marginLeft: 6 }}>
                            ({diffSign(yearDiff)}{((yearDiff / lastYearTotal) * 100).toFixed(1)}%)
                          </span>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Fiscal Year to Date — manual entry */}
            <div style={{
              background: `${SE_BLUE}08`, borderRadius: 6, padding: "12px 16px",
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_BLUE,
                textTransform: "uppercase", letterSpacing: "0.06em",
                marginBottom: 10, fontFamily: sans
              }}>
                Fiscal Year to Date
              </div>
              <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 10 }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 16, color: "#666", display: "block", marginBottom: 4 }}>Total Revenue</label>
                  <input
                    type="text"
                    value={fyRevenue}
                    onChange={(e) => { setFyRevenue(e.target.value); setFyCalced(false); }}
                    placeholder="e.g. 302793"
                    style={{
                      width: "100%", padding: "8px 12px", fontSize: 16,
                      border: `1px solid ${SE_BLUE}30`, borderRadius: 6,
                      fontFamily: sans, boxSizing: "border-box"
                    }}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <label style={{ fontSize: 16, color: "#666", display: "block", marginBottom: 4 }}>Total Expenses</label>
                  <input
                    type="text"
                    value={fyExpenses}
                    onChange={(e) => { setFyExpenses(e.target.value); setFyCalced(false); }}
                    placeholder="e.g. 480576"
                    style={{
                      width: "100%", padding: "8px 12px", fontSize: 16,
                      border: `1px solid ${SE_BLUE}30`, borderRadius: 6,
                      fontFamily: sans, boxSizing: "border-box"
                    }}
                  />
                </div>
                <div style={{ display: "flex", alignItems: "flex-end" }}>
                  <button
                    onClick={() => setFyCalced(true)}
                    disabled={!fyRevenue || !fyExpenses}
                    style={{
                      padding: "8px 20px", fontSize: 16, fontWeight: 700,
                      background: (fyRevenue && fyExpenses) ? SE_BLUE : "#ccc",
                      color: "#fff", border: "none", borderRadius: 6,
                      cursor: (fyRevenue && fyExpenses) ? "pointer" : "default",
                      fontFamily: sans
                    }}
                  >
                    Calculate
                  </button>
                </div>
              </div>
              {fyCalced && (() => {
                const rev = parseAmount(fyRevenue);
                const exp = parseAmount(fyExpenses);
                const net = rev - exp;
                const netColor = net >= 0 ? SE_GREEN : "#c0392b";
                return (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 16, fontFamily: sans }}>
                    <tbody>
                      <tr>
                        <td style={{ padding: "6px 0", color: "#444" }}>Total Revenue</td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                          {fmtFull(rev)}
                        </td>
                      </tr>
                      <tr style={{ borderTop: "1px solid #eee" }}>
                        <td style={{ padding: "6px 0", color: "#444" }}>Total Expenses</td>
                        <td style={{ padding: "6px 0", textAlign: "right", fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif, fontSize: 18 }}>
                          {fmtFull(exp)}
                        </td>
                      </tr>
                      <tr style={{ borderTop: `2px solid ${SE_BLUE}30` }}>
                        <td style={{ padding: "8px 0", color: "#222", fontWeight: 700, fontSize: 17 }}>Net Income</td>
                        <td style={{ padding: "8px 0", textAlign: "right", fontWeight: 700, color: netColor, fontFamily: serif, fontSize: 20 }}>
                          {net < 0 ? `(${fmtFull(Math.abs(net))})` : fmtFull(net)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                );
              })()}
            </div>
          </div>
        );
      })()}

      <div style={{ marginTop: 16, fontSize: 16, color: "#aaa", textAlign: "center" }}>
        Gifts aggregated by calendar month per fund. Fiscal year begins July 1. Dashed lines show trend.
      </div>
    </div>
  );
}
