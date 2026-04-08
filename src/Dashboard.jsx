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
  SE_GREEN, SE_BLUE, "#2e8b57", "#3a7a5c", "#005921",
  "#1a6b3c", "#22763e", SE_GOLD, "#006644", "#2d7d4f",
  "#357a38", "#4a9e6e", "#1b5e20", "#4e7a4e", "#5c8a5e"
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FY_START_MONTH = 7; // July
const DATA_FLOOR = new Date(2019, 6, 1); // July 1, 2019 — start of historical data

// Proxied through our server to avoid CORS issues
const LGL_OFFERTORY_ENDPOINT = "/api/lgl-data-hybrid";
const LGL_ALL_FUNDS_ENDPOINT = "/api/lgl-all-funds"; // stays on old endpoint (too large for server-side parsing)

const sans = "'Trebuchet MS', 'Calibri', sans-serif";
const serif = "'Georgia', 'Cambria', serif";

// Fiscal month labels in FY order (Jul=0 through Jun=11)
const FY_MONTH_LABELS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

function parseSpreadsheet(arrayBuffer, contentType) {
  // If CSV/text, convert buffer to string and parse as CSV via SheetJS
  if (contentType && (contentType.includes("text/") || contentType.includes("csv"))) {
    const text = new TextDecoder("utf-8").decode(arrayBuffer);
    const wb = XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: "" });
  }
  // Otherwise treat as xlsx binary
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
    // Use Math.round — CSV-parsed serials can be fractional (e.g. 45808.79)
    // and Math.floor would shift them back one day
    const d = new Date(1899, 11, 30 + Math.round(num));
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
  const datePatterns = ["gift date", "gift_date", "giftdate", "date", "deposit date", "deposit_date"];
  const amountPatterns = ["gift amount", "gift_amount", "giftamount", "amount", "gift amt", "total"];
  const fundPatterns = ["fund", "fund name", "fund_name"];

  // Prefer exact match first, then fall back to includes.
  // This avoids e.g. "Parent gift amount" matching before "Gift amount".
  function findCol(patterns) {
    for (const p of patterns) {
      const idx = lower.findIndex(h => h === p);
      if (idx !== -1) return headers[idx];
    }
    for (const p of patterns) {
      const idx = lower.findIndex(h => h.includes(p) && !h.includes("parent"));
      if (idx !== -1) return headers[idx];
    }
    return null;
  }

  return {
    dateCol: findCol(datePatterns),
    amountCol: findCol(amountPatterns),
    fundCol: findCol(fundPatterns)
  };
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
// labelNudge: optional vertical nudge (positive = down, negative = up) to avoid overlap
const DataLabel = ({ x, y, width, value, labelNudge }) => {
  if (!value || value === 0) return null;
  const label = value >= 1000 ? `$${(value/1000).toFixed(1)}k` : `$${value.toFixed(0)}`;
  // For bars, Recharts passes width — center the label over the bar
  const cx = width != null ? x + width / 2 : x;
  const yPos = y - 12 + (labelNudge || 0);
  return (
    <text x={cx} y={yPos} textAnchor="middle" fill="#555" fontSize={16} fontFamily={sans}>
      {label}
    </text>
  );
};

export default function Dashboard() {
  const [rawGifts, setRawGifts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [selectedFunds, setSelectedFunds] = useState(new Set());
  const [showAllFundsTotal, setShowAllFundsTotal] = useState(false);
  const [viewMode, setViewMode] = useState("chart"); // "chart" | "table"
  const [tableMode, setTableMode] = useState("fy"); // "fy" | "cy"
  const [timeRange, setTimeRange] = useState("last12");
  const [chartType, setChartType] = useState("line");
  const [colMapping, setColMapping] = useState({ dateCol: null, amountCol: null, fundCol: null });
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [fetching, setFetching] = useState(null); // null | "offertory" | "allFunds"
  const [authUser, setAuthUser] = useState(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [fyRevenue, setFyRevenue] = useState("");
  const [fyExpenses, setFyExpenses] = useState("");
  const [fyCalced, setFyCalced] = useState(false);
  const [dataLoadedAt, setDataLoadedAt] = useState(null);

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
    setFetching(offertoryOnly ? "offertory" : "allFunds");
    try {
      const endpoint = offertoryOnly ? LGL_OFFERTORY_ENDPOINT : LGL_ALL_FUNDS_ENDPOINT;
      const resp = await fetch(endpoint);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
      const ct = resp.headers.get("content-type") || "";
      if (ct.includes("application/json")) {
        // Hybrid endpoint returns JSON
        const json = await resp.json();
        const { rows, refreshedAt, apiGiftsAdded } = json;
        const extra = apiGiftsAdded ? `, +${apiGiftsAdded} recent` : "";
        const label = `LGL - Offertory (live${extra})`;
        setDataLoadedAt(new Date(refreshedAt));
        loadRows(rows, label);
      } else {
        // Legacy endpoint returns binary spreadsheet — parse client-side
        const reportDate = resp.headers.get("x-report-date");
        const buf = await resp.arrayBuffer();
        const allRows = parseSpreadsheet(buf, ct);

        // Top up with recent gifts from API (lightweight, no server-side XLSX parsing)
        let apiGiftsAdded = 0;
        if (reportDate) {
          try {
            const apiResp = await fetch(`/api/lgl-recent-gifts?since=${reportDate}`);
            if (apiResp.ok) {
              const { gifts, refreshedAt } = await apiResp.json();
              if (gifts && gifts.length > 0) {
                // Detect columns from the spreadsheet rows
                const hdrs = Object.keys(allRows[0]);
                const cols = detectColumns(hdrs);
                if (cols.dateCol && cols.amountCol && cols.fundCol) {
                  // Normalize date to YYYY-MM-DD for consistent dedup
                  function normDate(val) {
                    if (!val) return "";
                    const num = typeof val === "number" ? val : parseFloat(val);
                    if (!isNaN(num) && num > 25000 && num < 60000) {
                      const d = new Date(1899, 11, 30 + Math.round(num));
                      if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
                    }
                    const d = new Date(val);
                    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
                    return String(val).trim();
                  }
                  // Build dedup set
                  const seen = new Set();
                  for (const row of allRows) {
                    const d = normDate(row[cols.dateCol]);
                    const a = parseFloat(String(row[cols.amountCol] || "0").replace(/[$,]/g, "")) || 0;
                    const f = String(row[cols.fundCol] || "").trim().toLowerCase();
                    seen.add(`${d}|${a.toFixed(2)}|${f}`);
                  }
                  for (const g of gifts) {
                    const key = `${normDate(g.date)}|${Number(g.amount).toFixed(2)}|${(g.fund || "").toLowerCase()}`;
                    if (!seen.has(key)) {
                      const newRow = {};
                      newRow[cols.dateCol] = g.date;
                      newRow[cols.amountCol] = g.amount;
                      newRow[cols.fundCol] = g.fund;
                      allRows.push(newRow);
                      seen.add(key);
                      apiGiftsAdded++;
                    }
                  }
                }
              }
              if (refreshedAt) {
                setDataLoadedAt(new Date(refreshedAt));
              }
            }
          } catch (e) {
            // API top-up failed silently — permanent link data still loads
            console.warn("API top-up failed:", e.message);
          }
        }
        if (!dataLoadedAt) {
          if (reportDate) {
            const [y, m, d] = reportDate.split("-").map(Number);
            setDataLoadedAt(new Date(y, m - 1, d));
          } else {
            setDataLoadedAt(new Date());
          }
        }
        const extra = apiGiftsAdded ? `, +${apiGiftsAdded} recent` : "";
        const label = `LGL - All Funds (live${extra})`;
        loadRows(allRows, label);
      }
    } catch (err) {
      setError(`Could not fetch from LGL: ${err.message}`);
    } finally {
      setFetching(null);
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
    // dataLoadedAt is set by fetchFromLGL using LGL's Last-Modified header
  }, []);


  // Pre-computed gift index: fund|year|month → total amount
  // Turns O(n×m) loops into O(1) lookups
  const giftIndex = useMemo(() => {
    const idx = {};
    const allIdx = {}; // all funds combined
    for (const g of rawGifts) {
      const yr = g.date.getFullYear();
      const mo = g.date.getMonth();
      const fk = `${g.fund}|${yr}|${mo}`;
      idx[fk] = (idx[fk] || 0) + g.amount;
      const ak = `${yr}|${mo}`;
      allIdx[ak] = (allIdx[ak] || 0) + g.amount;
    }
    return { byFund: idx, allFunds: allIdx };
  }, [rawGifts]);

  const filteredData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange === "yoy" || timeRange === "fyCompare") return [];
    const now = new Date();
    let startDate;
    if (timeRange === "last12") startDate = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
    else if (timeRange === "ytd") startDate = new Date(now.getFullYear(), 0, 1);
    else if (timeRange === "fy") startDate = getFYStart(now);
    else if (timeRange === "last24") startDate = new Date(now.getFullYear() - 2, now.getMonth() + 1, 1);
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
    // Also compute grand total across ALL funds (not just selected) for "All Funds (Total)" line
    const allFundsMonthMap = {};
    if (showAllFundsTotal) {
      const allRelevant = rawGifts.filter(g => g.date >= startDate && g.date <= now);
      for (const g of allRelevant) {
        const mk = getMonthKey(g.date);
        if (!allFundsMonthMap[mk]) allFundsMonthMap[mk] = 0;
        allFundsMonthMap[mk] += g.amount;
      }
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
      if (showAllFundsTotal) row["All Funds (Total)"] = allFundsMonthMap[mk] || 0;
      return row;
    });
  }, [rawGifts, selectedFunds, timeRange, loaded, showAllFundsTotal]);

  // Add trend data to filteredData + compute trend %
  // Exclude the current (incomplete) month from trend computation so it
  // doesn't artificially drag the trendline down.
  const { chartData, trendPcts } = useMemo(() => {
    if (filteredData.length < 2) return { chartData: filteredData, trendPcts: {} };
    const now = new Date();
    const currentMonthKey = getMonthKey(now);
    // Separate completed months from the current (partial) month
    const completedData = filteredData.filter(d => d._key !== currentMonthKey);
    const currentMonth = filteredData.filter(d => d._key === currentMonthKey);
    if (completedData.length < 2) return { chartData: filteredData, trendPcts: {} };
    let result = completedData;
    const pcts = {};
    for (const f of selectedFunds) {
      const trend = computeTrend(result, f);
      if (trend) {
        result = trend.data;
        pcts[f] = trend.pct;
      }
    }
    // Append the current month back WITHOUT trend values so the main line
    // still shows it but the trendline stops at last completed month.
    return { chartData: [...result, ...currentMonth], trendPcts: pcts };
  }, [filteredData, selectedFunds]);

  const totals = useMemo(() => {
    if (!loaded) return {};
    const t = {};
    for (const f of selectedFunds) t[f] = filteredData.reduce((sum, row) => sum + (row[f] || 0), 0);
    if (showAllFundsTotal) t["All Funds (Total)"] = filteredData.reduce((sum, row) => sum + (row["All Funds (Total)"] || 0), 0);
    return t;
  }, [filteredData, selectedFunds, loaded, showAllFundsTotal]);

  // ─── YoY comparison data (calendar year: 2025 vs 2026) ───
  const yoyData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange !== "yoy") return [];
    const now = new Date();
    const calYears = [2024, 2025, 2026];
    const currentMonth = now.getMonth(); // 0-11

    const rows = MONTHS.map((label, monthIdx) => {
      // Only include months up to the current month in the current year
      if (monthIdx > currentMonth) return null;
      const row = { month: label };
      for (const yr of calYears) {
        for (const fund of selectedFunds) {
          const key = `${fund} (${yr})`;
          row[key] = giftIndex.byFund[`${fund}|${yr}|${monthIdx}`] || 0;
        }
      }
      return row;
    }).filter(Boolean);
    return rows;
  }, [giftIndex, selectedFunds, timeRange, loaded]);

  const yoySeriesKeys = useMemo(() => {
    if (timeRange !== "yoy") return [];
    const keys = [];
    for (const fund of [...selectedFunds].sort()) {
      keys.push(`${fund} (2024)`);
      keys.push(`${fund} (2025)`);
      keys.push(`${fund} (2026)`);
    }
    return keys;
  }, [selectedFunds, timeRange]);

  const yoyTotals = useMemo(() => {
    if (timeRange !== "yoy" || yoyData.length === 0) return {};
    const t = {};
    for (const key of yoySeriesKeys) {
      t[key] = yoyData.reduce((sum, row) => sum + (row[key] || 0), 0);
    }
    return t;
  }, [yoyData, yoySeriesKeys, timeRange]);

  // ─── FY Compare data (fiscal year: Jul–Jun, last 3 FYs) ───
  const FY_MONTHS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

  const fyCompareData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || timeRange !== "fyCompare") return [];
    const now = new Date();
    // Determine current FY start year (FY starts in July)
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    // Last 3 fiscal years: e.g. FY23-24, FY24-25, FY25-26
    const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];

    const rows = FY_MONTHS.map((label, monthIdx) => {
      // FY month index: 0=Jul(6), 1=Aug(7), ..., 5=Dec(11), 6=Jan(0), ..., 11=Jun(5)
      const calMonth = (monthIdx + 6) % 12;
      // Skip this month row entirely if even the oldest FY hasn't reached it yet
      const oldestCalYear = calMonth >= 6 ? fyStartYears[0] : fyStartYears[0] + 1;
      if (new Date(oldestCalYear, calMonth, 1) > now) return null;
      const row = { month: label };
      for (const fyStart of fyStartYears) {
        const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
        const monthDate = new Date(calYear, calMonth, 1);
        const fyLabel = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        for (const fund of selectedFunds) {
          const key = `${fund} (${fyLabel})`;
          // Skip future months but don't break — other FYs may have data
          if (monthDate > now) { row[key] = 0; continue; }
          row[key] = giftIndex.byFund[`${fund}|${calYear}|${calMonth}`] || 0;
        }
      }
      return row;
    }).filter(Boolean);
    return rows;
  }, [giftIndex, selectedFunds, timeRange, loaded]);

  const fyCompareSeriesKeys = useMemo(() => {
    if (timeRange !== "fyCompare") return [];
    const now = new Date();
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];
    const keys = [];
    for (const fund of [...selectedFunds].sort()) {
      for (const fyStart of fyStartYears) {
        const fyLabel = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        keys.push(`${fund} (${fyLabel})`);
      }
    }
    return keys;
  }, [selectedFunds, timeRange]);

  // fyCompareColorMap is computed below, after fundColorMap is defined

  const fyCompareTotals = useMemo(() => {
    if (timeRange !== "fyCompare" || fyCompareData.length === 0) return {};
    const t = {};
    for (const key of fyCompareSeriesKeys) {
      t[key] = fyCompareData.reduce((sum, row) => sum + (row[key] || 0), 0);
    }
    return t;
  }, [fyCompareData, fyCompareSeriesKeys, timeRange]);

  // ─── Table view data ───
  const tableData = useMemo(() => {
    if (!loaded || rawGifts.length === 0 || viewMode !== "table") return [];
    const now = new Date();

    // Sum gift index entries for selected funds at a given year/month
    const sumSelected = (yr, mo) => {
      let total = 0;
      for (const f of selectedFunds) {
        total += giftIndex.byFund[`${f}|${yr}|${mo}`] || 0;
      }
      return total;
    };

    if (tableMode === "fy") {
      const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const rows = [];
      for (let fyStart = currentFYStart; fyStart >= 2019; fyStart--) {
        const fyLabel = `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}`;
        const row = { label: fyLabel };
        let grandTotal = 0;
        let monthCount = 0;
        for (let mi = 0; mi < 12; mi++) {
          const calMonth = (mi + 6) % 12;
          const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
          if (new Date(calYear, calMonth, 1) > now) continue;
          const monthTotal = sumSelected(calYear, calMonth);
          row[FY_MONTHS[mi]] = monthTotal;
          grandTotal += monthTotal;
          monthCount++;
        }
        row.total = grandTotal;
        row.avg = monthCount > 0 ? grandTotal / monthCount : 0;
        row.months = monthCount;
        rows.push(row);
      }
      return rows;
    } else {
      const currentYear = now.getFullYear();
      const rows = [];
      for (let yr = currentYear; yr >= 2019; yr--) {
        const row = { label: String(yr) };
        let grandTotal = 0;
        let monthCount = 0;
        for (let m = 0; m < 12; m++) {
          const monthDate = new Date(yr, m, 1);
          if (monthDate > now || monthDate < DATA_FLOOR) continue;
          const monthTotal = sumSelected(yr, m);
          row[MONTHS[m]] = monthTotal;
          grandTotal += monthTotal;
          monthCount++;
        }
        row.total = grandTotal;
        row.avg = monthCount > 0 ? grandTotal / monthCount : 0;
        row.months = monthCount;
        if (monthCount > 0) rows.push(row);
      }
      return rows;
    }
  }, [giftIndex, selectedFunds, loaded, viewMode, tableMode]);

  const toggleFund = (fund) => {
    setSelectedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fund)) next.delete(fund);
      else next.add(fund);
      return next;
    });
  };

  const goHome = () => { setLoaded(false); setRawGifts([]); setFunds([]); setFileName(null); setError(null); setFyRevenue(""); setFyExpenses(""); setFyCalced(false); setDataLoadedAt(null); };
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
        border: `1px solid rgba(255,255,255,0.15)`,
        borderRadius: 6,
        padding: "12px 16px",
        fontSize: 16,
        color: "#fff",
        fontFamily: sans,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: "#fff", fontFamily: serif }}>{label}</div>
        {real.map((p, i) => (
          <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 24, marginBottom: 3, alignItems: "center" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6, color: "#fff" }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
              {p.dataKey}
            </span>
            <span style={{ fontWeight: 700, color: "#fff" }}>{fmtFull(p.value)}</span>
          </div>
        ))}
      </div>
    );
  };

  const fundColorMap = {};
  funds.forEach((f, i) => { fundColorMap[f] = FUND_COLORS[i % FUND_COLORS.length]; });

  // YoY colors — 2024 lighter, 2025 medium, 2026 full
  const yoyColorMap = {};
  for (const fund of funds) {
    const base = fundColorMap[fund];
    yoyColorMap[`${fund} (2024)`] = "#999999";
    yoyColorMap[`${fund} (2025)`] = base;
    yoyColorMap[`${fund} (2026)`] = base;
  }

  // FY Compare colors — oldest gray, middle base, current base
  const fyCompareColorMap = (() => {
    const map = {};
    const now = new Date();
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];
    for (const fund of funds) {
      const base = fundColorMap[fund];
      for (let i = 0; i < fyStartYears.length; i++) {
        const fyLabel = `FY${String(fyStartYears[i]).slice(2)}-${String(fyStartYears[i] + 1).slice(2)}`;
        map[`${fund} (${fyLabel})`] = i === 0 ? "#999999" : base;
      }
    }
    return map;
  })();

  const ALL_FUNDS_TOTAL_KEY = "All Funds (Total)";
  const ALL_FUNDS_TOTAL_COLOR = "#333333";
  const activeFunds = [...selectedFunds].sort();
  if (showAllFundsTotal) fundColorMap[ALL_FUNDS_TOTAL_KEY] = ALL_FUNDS_TOTAL_COLOR;

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
            color: "#fff", fontSize: 26, fontFamily: serif, fontWeight: 700
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
            color: SE_GREEN, fontSize: 16, marginBottom: 4,
            letterSpacing: "0.12em", textTransform: "uppercase",
            fontWeight: 700, fontFamily: sans
          }}>
            Fund Giving Dashboard
          </p>
          <div style={{
            width: 50, height: 2, margin: "0 auto 28px",
            background: `linear-gradient(90deg, ${SE_GREEN}, ${SE_GREEN_DARK})`
          }} />

          {/* Option 1: Offertory auto-pull */}
          <button
            onClick={() => fetchFromLGL(true)}
            disabled={!!fetching}
            style={{
              width: "100%", padding: "16px 24px",
              background: fetching === "offertory" ? "#ccc" : SE_GREEN,
              color: "#fff", border: "none", borderRadius: 10,
              fontSize: 18, fontWeight: 700, cursor: fetching ? "wait" : "pointer",
              fontFamily: serif, marginBottom: 10,
              boxShadow: "0 2px 8px rgba(0,132,61,0.25)",
              transition: "all 0.2s"
            }}
          >
            {fetching === "offertory" ? "Fetching from LGL..." : "Load Offertory Data"}
          </button>
          <p style={{ fontSize: 16, color: "#999", marginTop: 0, marginBottom: 18 }}>
            Pulls the latest Offertory giving data directly from LGL. Reports are automatically refreshed once every weekday.
          </p>

          {/* Option 2: All funds */}
          <button
            onClick={() => fetchFromLGL(false)}
            disabled={!!fetching}
            style={{
              width: "100%", padding: "14px 24px",
              background: fetching === "allFunds" ? "#eee" : "#fff",
              color: SE_GREEN_DARK, border: `2px solid ${fetching === "allFunds" ? "#ccc" : SE_GREEN}`,
              borderRadius: 10,
              fontSize: 18, fontWeight: 700, cursor: fetching ? "wait" : "pointer",
              fontFamily: serif, marginBottom: 10,
              transition: "all 0.2s"
            }}
          >
            {fetching === "allFunds" ? "Fetching from LGL..." : "Load All Funds Report"}
          </button>
          <p style={{ fontSize: 16, color: "#999", marginTop: 0, marginBottom: 20 }}>
            Pulls all fund data from LGL (Offertory, Capital Campaign, etc.)
          </p>

          {/* Error display */}
          {error && (
            <div style={{
              marginTop: 10, padding: "14px 18px",
              background: "#fef2f2", border: "1px solid #c0392b30",
              borderRadius: 8, fontSize: 16, color: "#c0392b",
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
            justifyContent: "center", color: "#fff",
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
              {fileName} &middot; {rawGifts.length.toLocaleString()} gifts &middot; {funds.length} fund{funds.length !== 1 ? "s" : ""}
              {dataLoadedAt && (() => {
                const now = new Date();
                const diffMs = now - dataLoadedAt;
                const diffMins = Math.round(diffMs / 60000);
                let ago;
                if (diffMins < 1) ago = "just now";
                else if (diffMins < 60) ago = `${diffMins}m ago`;
                else if (diffMins < 1440) ago = `${Math.round(diffMins / 60)}h ago`;
                else {
                  const days = Math.round(diffMins / 1440);
                  ago = days === 1 ? "1 day ago" : `${days} days ago`;
                }
                const timeStr = dataLoadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
                const dateStr = dataLoadedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                return (
                  <> &middot; Data as of {dateStr} at {timeStr} ({ago})</>
                );
              })()}
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
          { key: "all", label: "All (Since Jul '19)" },
          { key: "yoy", label: "YoY Compare" },
          { key: "fyCompare", label: "FY Compare" }
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
        {["chart", "table"].map(vm => (
          <button
            key={vm}
            onClick={() => setViewMode(vm)}
            style={{
              padding: "9px 18px", borderRadius: 6,
              border: viewMode === vm ? `2px solid ${SE_BLUE}` : "1px solid #ccc",
              background: viewMode === vm ? `${SE_BLUE}12` : "#fff",
              color: viewMode === vm ? SE_BLUE : "#999",
              fontSize: 16, fontWeight: viewMode === vm ? 700 : 500,
              cursor: "pointer"
            }}
          >
            {vm === "chart" ? "Chart" : "Table"}
          </button>
        ))}
        {viewMode === "chart" && ["line", "bar"].map(t => (
          <button
            key={t}
            onClick={() => setChartType(t)}
            style={{
              padding: "9px 18px", borderRadius: 6,
              border: chartType === t ? `2px solid ${SE_GREEN}` : "1px solid #ccc",
              background: chartType === t ? `${SE_GREEN}12` : "#fff",
              color: chartType === t ? SE_GREEN_DARK : "#999",
              fontSize: 16, fontWeight: chartType === t ? 700 : 500,
              cursor: "pointer"
            }}
          >
            {t === "line" ? "Line" : "Bar"}
          </button>
        ))}
      </div>

      {/* Totals */}
      {activeFunds.length > 0 && timeRange !== "yoy" && timeRange !== "fyCompare" && (
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
          {showAllFundsTotal && (
            <div style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${ALL_FUNDS_TOTAL_COLOR}25`,
              borderLeft: `4px solid ${ALL_FUNDS_TOTAL_COLOR}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>All Funds (Total)</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(totals[ALL_FUNDS_TOTAL_KEY] || 0)}
              </div>
            </div>
          )}
        </div>
      )}
      {/* YoY Totals */}
      {activeFunds.length > 0 && (timeRange === "yoy") && (
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

      {/* FY Compare Totals */}
      {activeFunds.length > 0 && timeRange === "fyCompare" && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {fyCompareSeriesKeys.map(key => (
            <div key={key} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${fyCompareColorMap[key] || SE_GREEN}25`,
              borderLeft: `4px solid ${fyCompareColorMap[key] || SE_GREEN}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 16, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{key}</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(fyCompareTotals[key] || 0)}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Table View */}
      {viewMode === "table" && (
        <div style={{
          background: "#fff", border: `1px solid ${SE_GREEN}12`,
          borderRadius: 8, padding: "18px 14px 10px",
          marginBottom: 18, boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
        }}>
          {/* FY / CY toggle */}
          <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
            {[{ key: "fy", label: "Fiscal Year (Jul–Jun)" }, { key: "cy", label: "Calendar Year (Jan–Dec)" }].map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setTableMode(key)}
                style={{
                  padding: "7px 16px", borderRadius: 6,
                  border: tableMode === key ? `2px solid ${SE_GREEN}` : "1px solid #ccc",
                  background: tableMode === key ? `${SE_GREEN}12` : "#fff",
                  color: tableMode === key ? SE_GREEN_DARK : "#777",
                  fontSize: 15, fontWeight: tableMode === key ? 700 : 500,
                  cursor: "pointer"
                }}
              >
                {label}
              </button>
            ))}
          </div>
          {tableData.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data available."}
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, fontFamily: sans }}>
                <thead>
                  <tr style={{ borderBottom: `2px solid ${SE_GREEN}30` }}>
                    <th style={{ textAlign: "left", padding: "8px 10px", color: SE_GREEN_DARK, fontWeight: 700, position: "sticky", left: 0, background: "#fff", minWidth: 80 }}>
                      {tableMode === "fy" ? "FY" : "Year"}
                    </th>
                    {(tableMode === "fy" ? FY_MONTHS : MONTHS).map(m => (
                      <th key={m} style={{ textAlign: "right", padding: "8px 8px", color: "#666", fontWeight: 600, minWidth: 75 }}>{m}</th>
                    ))}
                    <th style={{ textAlign: "right", padding: "8px 10px", color: SE_GREEN_DARK, fontWeight: 700, minWidth: 95, borderLeft: `2px solid ${SE_GREEN}20` }}>Total</th>
                    <th style={{ textAlign: "right", padding: "8px 10px", color: SE_GREEN_DARK, fontWeight: 700, minWidth: 95 }}>Mo. Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {tableData.map((row, ri) => (
                    <tr key={row.label} style={{ borderBottom: `1px solid ${SE_GREEN}10`, background: ri % 2 === 0 ? "#fafafa" : "#fff" }}>
                      <td style={{ padding: "8px 10px", fontWeight: 700, color: SE_GREEN_DARK, position: "sticky", left: 0, background: ri % 2 === 0 ? "#fafafa" : "#fff" }}>{row.label}</td>
                      {(tableMode === "fy" ? FY_MONTHS : MONTHS).map(m => (
                        <td key={m} style={{ textAlign: "right", padding: "8px 8px", color: row[m] ? "#333" : "#ccc" }}>
                          {row[m] != null ? fmtFull(row[m]) : "—"}
                        </td>
                      ))}
                      <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: SE_GREEN_DARK, borderLeft: `2px solid ${SE_GREEN}20` }}>
                        {fmtFull(row.total)}
                      </td>
                      <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600, color: "#555" }}>
                        {fmtFull(row.avg)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Chart */}
      {viewMode === "chart" && <div style={{
        background: "#fff", border: `1px solid ${SE_GREEN}12`,
        borderRadius: 8, padding: "18px 14px 10px",
        marginBottom: 18, boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
      }}>
        {(timeRange === "fyCompare") ? (
          /* ─── FY Compare Chart ─── */
          fyCompareData.length === 0 || activeFunds.length === 0 ? (
            <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 16 }}>
              {activeFunds.length === 0 ? "Select at least one fund below." : "No data for FY comparison."}
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={370}>
              {chartType === "line" ? (
                <LineChart data={fyCompareData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {fyCompareSeriesKeys.map(key => {
                    const parts = key.match(/\(FY(\d{2})-(\d{2})\)/);
                    const fyIdx = parts ? parseInt(parts[1]) : 0;
                    const now = new Date();
                    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
                    const currentFYShort = currentFYStart % 100;
                    const isOldest = fyIdx === (currentFYShort - 2);
                    const isMiddle = fyIdx === (currentFYShort - 1);
                    const labelOffset = isOldest ? -20 : isMiddle ? -2 : 18;
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={fyCompareColorMap[key]}
                        strokeWidth={isOldest ? 1.5 : isMiddle ? 2 : 2.5}
                        strokeDasharray={isOldest ? "3 3" : isMiddle ? "6 3" : undefined}
                        dot={{ r: isOldest ? 2 : 3, fill: fyCompareColorMap[key] }}
                        activeDot={{ r: 5 }}
                        opacity={isOldest ? 0.6 : 1}
                      >
                        <LabelList content={<DataLabel labelNudge={labelOffset} />} />
                      </Line>
                    );
                  })}
                </LineChart>
              ) : (
                <BarChart data={fyCompareData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {fyCompareSeriesKeys.map(key => {
                    const parts = key.match(/\(FY(\d{2})-(\d{2})\)/);
                    const fyIdx = parts ? parseInt(parts[1]) : 0;
                    const now = new Date();
                    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
                    const currentFYShort = currentFYStart % 100;
                    const isOldest = fyIdx === (currentFYShort - 2);
                    const isMiddle = fyIdx === (currentFYShort - 1);
                    return (
                      <Bar key={key} dataKey={key} fill={fyCompareColorMap[key]} radius={[3, 3, 0, 0]} opacity={isOldest ? 0.35 : isMiddle ? 0.5 : 0.88}>
                        <LabelList content={<DataLabel />} />
                      </Bar>
                    );
                  })}
                </BarChart>
              )}
            </ResponsiveContainer>
          )
        ) : (timeRange === "yoy") ? (
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
                  {yoySeriesKeys.map(key => {
                    const is2024 = key.includes("(2024)");
                    const is2025 = key.includes("(2025)");
                    // Offset labels to avoid overlap: 2024 up, 2025 middle, 2026 down
                    const labelOffset = is2024 ? -20 : is2025 ? -2 : 18;
                    return (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={yoyColorMap[key]}
                        strokeWidth={is2024 ? 1.5 : is2025 ? 2 : 2.5}
                        strokeDasharray={is2024 ? "3 3" : is2025 ? "6 3" : undefined}
                        dot={{ r: is2024 ? 2 : 3, fill: yoyColorMap[key] }}
                        activeDot={{ r: 5 }}
                        opacity={is2024 ? 0.6 : 1}
                      >
                        <LabelList content={<DataLabel labelNudge={labelOffset} />} />
                      </Line>
                    );
                  })}
                </LineChart>
              ) : (
                <BarChart data={yoyData} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                  <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 16, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 16, fontFamily: sans }} />
                  {yoySeriesKeys.map(key => (
                    <Bar key={key} dataKey={key} fill={yoyColorMap[key]} radius={[3, 3, 0, 0]} opacity={key.includes("(2024)") ? 0.35 : key.includes("(2025)") ? 0.5 : 0.88}>
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
                  {showAllFundsTotal && (
                    <Line key={ALL_FUNDS_TOTAL_KEY} type="monotone" dataKey={ALL_FUNDS_TOTAL_KEY} stroke={ALL_FUNDS_TOTAL_COLOR} strokeWidth={3} dot={{ r: 4, fill: ALL_FUNDS_TOTAL_COLOR }} activeDot={{ r: 6 }}>
                      <LabelList content={<DataLabel />} />
                    </Line>
                  )}
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
                  {showAllFundsTotal && (
                    <Bar key={ALL_FUNDS_TOTAL_KEY} dataKey={ALL_FUNDS_TOTAL_KEY} fill={ALL_FUNDS_TOTAL_COLOR} radius={[3, 3, 0, 0]} opacity={0.88}>
                      <LabelList content={<DataLabel />} />
                    </Bar>
                  )}
                </BarChart>
              )}
            </ResponsiveContainer>
          )
        )}
      </div>}

      {/* Trend indicator */}
      {viewMode === "chart" && timeRange !== "yoy" && timeRange !== "fyCompare" && Object.keys(trendPcts).length > 0 && (
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
          <button
            onClick={() => setShowAllFundsTotal(prev => !prev)}
            style={{
              display: "flex", alignItems: "center", gap: 7,
              padding: "5px 13px", borderRadius: 6,
              border: showAllFundsTotal ? `2px solid ${ALL_FUNDS_TOTAL_COLOR}` : "1px solid #ddd",
              background: showAllFundsTotal ? `${ALL_FUNDS_TOTAL_COLOR}10` : "#fafafa",
              color: showAllFundsTotal ? SE_GREEN_DARK : "#999",
              fontSize: 16, fontWeight: showAllFundsTotal ? 600 : 400,
              cursor: "pointer", transition: "all 0.15s"
            }}
          >
            <span style={{
              width: 10, height: 10, borderRadius: 3,
              background: showAllFundsTotal ? ALL_FUNDS_TOTAL_COLOR : "#ddd",
              transition: "all 0.15s"
            }} />
            All Funds (Total)
          </button>
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
              background: `${SE_GREEN}08`, borderRadius: 6, padding: "12px 16px",
              marginBottom: 12
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_GREEN_DARK,
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
              background: `${SE_GREEN}08`, borderRadius: 6, padding: "12px 16px",
            }}>
              <div style={{
                fontSize: 16, fontWeight: 700, color: SE_GREEN_DARK,
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
                      border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
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
                      border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
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
                      background: (fyRevenue && fyExpenses) ? SE_GREEN : "#ccc",
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
                      <tr style={{ borderTop: `2px solid ${SE_GREEN}30` }}>
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
