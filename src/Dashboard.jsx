import { useState, useMemo, useCallback, useRef } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar
} from "recharts";
import Papa from "papaparse";

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
const SE_GOLD_LIGHT = "#DDCC71";
const SE_BLUE = "#003764";
const SE_OFFWHITE = "#EEF4F1";

const FUND_COLORS = [
  SE_GREEN, SE_GOLD, SE_BLUE, "#2e8b57", "#b8860b",
  "#3a7a5c", "#8B6914", "#00843D", "#c49000", "#005921",
  "#d4a72c", "#1a6b3c", "#a67c00", "#22763e", "#e6b422"
];

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const FY_START_MONTH = 7; // July

const sans = "'Trebuchet MS', 'Calibri', sans-serif";
const serif = "'Georgia', 'Cambria', serif";

function parseDateFlexible(str) {
  if (!str) return null;
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

export default function Dashboard() {
  const [rawGifts, setRawGifts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [selectedFunds, setSelectedFunds] = useState(new Set());
  const [timeRange, setTimeRange] = useState("last12");
  const [chartType, setChartType] = useState("line");
  const [colMapping, setColMapping] = useState({ dateCol: null, amountCol: null, fundCol: null });
  const [headers, setHeaders] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef(null);

  const handleFile = useCallback((file) => {
    setError(null);
    setFileName(file.name);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        if (!results.data || results.data.length === 0) {
          setError("CSV appears empty or could not be parsed.");
          return;
        }
        const hdrs = results.meta.fields || [];
        setHeaders(hdrs);
        const detected = detectColumns(hdrs);
        if (!detected.dateCol || !detected.amountCol || !detected.fundCol) {
          setColMapping(detected);
          setError(
            `Could not auto-detect all columns. Found: Date="${detected.dateCol || "?"}", Amount="${detected.amountCol || "?"}", Fund="${detected.fundCol || "?"}". Use the dropdowns below to map them.`
          );
          setRawGifts(results.data);
          setLoaded(false);
          return;
        }
        setColMapping(detected);
        processData(results.data, detected);
      },
      error: (err) => setError(`Parse error: ${err.message}`)
    });
  }, []);

  const processData = useCallback((data, mapping) => {
    const { dateCol, amountCol, fundCol } = mapping;
    if (!dateCol || !amountCol || !fundCol) return;
    const gifts = [];
    const fundSet = new Set();
    for (const row of data) {
      const date = parseDateFlexible(row[dateCol]);
      const amount = parseAmount(row[amountCol]);
      const fund = (row[fundCol] || "").trim();
      if (date && fund) {
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

  const applyMapping = useCallback(() => {
    if (colMapping.dateCol && colMapping.amountCol && colMapping.fundCol) {
      processData(rawGifts, colMapping);
    }
  }, [colMapping, rawGifts, processData]);

  const filteredData = useMemo(() => {
    if (!loaded || rawGifts.length === 0) return [];
    const now = new Date();
    let startDate;
    if (timeRange === "last12") startDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    else if (timeRange === "ytd") startDate = new Date(now.getFullYear(), 0, 1);
    else if (timeRange === "fy") startDate = getFYStart(now);
    else if (timeRange === "last24") startDate = new Date(now.getFullYear() - 2, now.getMonth(), 1);
    else if (timeRange === "all") startDate = new Date(2000, 0, 1);
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

  const totals = useMemo(() => {
    if (!loaded) return {};
    const t = {};
    for (const f of selectedFunds) t[f] = filteredData.reduce((sum, row) => sum + (row[f] || 0), 0);
    return t;
  }, [filteredData, selectedFunds, loaded]);

  const toggleFund = (fund) => {
    setSelectedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fund)) next.delete(fund);
      else next.add(fund);
      return next;
    });
  };

  const selectAll = () => setSelectedFunds(new Set(funds));
  const selectNone = () => setSelectedFunds(new Set());
  const fmt = (v) => v >= 1000 ? `$${(v/1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  const fmtFull = (v) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload) return null;
    return (
      <div style={{
        background: SE_GREEN_DARK,
        border: `1px solid ${SE_GOLD}44`,
        borderRadius: 6,
        padding: "10px 14px",
        fontSize: 13,
        color: SE_OFFWHITE,
        fontFamily: sans,
        boxShadow: "0 8px 24px rgba(0,0,0,0.5)"
      }}>
        <div style={{ fontWeight: 700, marginBottom: 6, color: "#fff", fontFamily: serif }}>{label}</div>
        {payload.map((p, i) => (
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
            color: SE_GOLD, fontSize: 12, marginBottom: 4,
            letterSpacing: "0.12em", textTransform: "uppercase",
            fontWeight: 700, fontFamily: sans
          }}>
            Fund Giving Dashboard
          </p>
          <div style={{
            width: 50, height: 2, margin: "0 auto 28px",
            background: `linear-gradient(90deg, ${SE_GREEN}, ${SE_GOLD})`
          }} />

          {/* Instructions */}
          <div style={{
            marginBottom: 24, padding: "18px 22px",
            background: "#fff", borderRadius: 8,
            border: `1px solid ${SE_GREEN}20`,
            textAlign: "left", fontSize: 13.5,
            color: "#444", lineHeight: 1.8,
            boxShadow: "0 1px 4px rgba(0,89,33,0.06)"
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, color: SE_GREEN,
              letterSpacing: "0.08em", textTransform: "uppercase",
              marginBottom: 10
            }}>
              How to get the file from LGL
            </div>
            <div>
              <span style={{ color: SE_GREEN_DARK, fontWeight: 700 }}>1.</span> In LGL, run a <strong>Comprehensive Export</strong><br/>
              <span style={{ color: SE_GREEN_DARK, fontWeight: 700 }}>2.</span> Unzip the downloaded file<br/>
              <span style={{ color: SE_GREEN_DARK, fontWeight: 700 }}>3.</span> Open the extracted folder<br/>
              <span style={{ color: SE_GREEN_DARK, fontWeight: 700 }}>4.</span> Open the <strong>Full_Archive</strong> folder inside it<br/>
              <span style={{ color: SE_GREEN_DARK, fontWeight: 700 }}>5.</span> Drop <strong>gift_gifts.csv</strong> into the box below
            </div>
          </div>

          {/* Drop zone */}
          <div
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            style={{
              border: `2px dashed ${dragOver ? SE_GREEN : SE_GREEN + "44"}`,
              borderRadius: 12,
              padding: "44px 32px",
              cursor: "pointer",
              transition: "all 0.2s",
              background: dragOver ? `${SE_GREEN}08` : "#fff",
              boxShadow: "0 1px 4px rgba(0,89,33,0.06)"
            }}
          >
            <div style={{ fontSize: 32, marginBottom: 8, color: SE_GREEN, fontWeight: 700 }}>CSV</div>
            <div style={{ fontSize: 14, color: "#888" }}>
              {fileName ? fileName : "Click or drag gift_gifts.csv here"}
            </div>
            <input
              ref={fileRef} type="file" accept=".csv,.txt"
              style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files[0]; if (f) handleFile(f); }}
            />
          </div>

          {/* Error + manual mapping */}
          {error && (
            <div style={{
              marginTop: 20, padding: "14px 18px",
              background: "#fff8f0", border: "1px solid #e8c87040",
              borderRadius: 8, fontSize: 13, color: "#8B6914",
              textAlign: "left", lineHeight: 1.5
            }}>
              {error}
              {headers.length > 0 && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                    {[
                      { label: "Date column", key: "dateCol" },
                      { label: "Amount column", key: "amountCol" },
                      { label: "Fund column", key: "fundCol" }
                    ].map(({ label, key }) => (
                      <div key={key} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ width: 120, color: "#666", fontSize: 13 }}>{label}:</span>
                        <select
                          value={colMapping[key] || ""}
                          onChange={(e) => setColMapping(prev => ({ ...prev, [key]: e.target.value || null }))}
                          style={{
                            flex: 1, background: "#fff", color: "#333",
                            border: `1px solid ${SE_GREEN}30`, borderRadius: 5,
                            padding: "5px 8px", fontSize: 13
                          }}
                        >
                          <option value="">Select...</option>
                          {headers.map(h => <option key={h} value={h}>{h}</option>)}
                        </select>
                      </div>
                    ))}
                    <button
                      onClick={applyMapping}
                      disabled={!colMapping.dateCol || !colMapping.amountCol || !colMapping.fundCol}
                      style={{
                        marginTop: 6, padding: "9px 22px",
                        background: (colMapping.dateCol && colMapping.amountCol && colMapping.fundCol) ? SE_GREEN : "#ccc",
                        color: "#fff", border: "none", borderRadius: 6,
                        fontSize: 13, fontWeight: 700, cursor: "pointer"
                      }}
                    >
                      Load Data
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  // ─── DASHBOARD ───
  const activeFunds = [...selectedFunds].sort();

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
            <h1 style={{
              fontSize: 18, fontWeight: 700, color: SE_GREEN_DARK,
              margin: 0, fontFamily: serif, lineHeight: 1.2
            }}>
              St. Edward Fund Dashboard
            </h1>
            <p style={{ margin: 0, fontSize: 12, color: "#888" }}>
              {fileName} &middot; {rawGifts.length.toLocaleString()} gifts &middot; {funds.length} funds &middot; FY starts July 1
            </p>
          </div>
        </div>
        <button
          onClick={() => { setLoaded(false); setRawGifts([]); setFunds([]); setFileName(null); setError(null); }}
          style={{
            padding: "7px 16px", background: "#fff",
            border: `1px solid ${SE_GREEN}30`, borderRadius: 6,
            color: SE_GREEN_DARK, fontSize: 12, fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Load New File
        </button>
      </div>

      {/* Time + chart controls */}
      <div style={{ display: "flex", gap: 5, marginBottom: 18, flexWrap: "wrap", alignItems: "center" }}>
        {[
          { key: "fy", label: getFYLabel() },
          { key: "ytd", label: "YTD" },
          { key: "last12", label: "Last 12 Mo" },
          { key: "last24", label: "Last 24 Mo" },
          { key: "all", label: "All Time" }
        ].map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTimeRange(key)}
            style={{
              padding: "7px 16px", borderRadius: 6,
              border: timeRange === key ? `2px solid ${SE_GREEN}` : "1px solid #ccc",
              background: timeRange === key ? `${SE_GREEN}12` : "#fff",
              color: timeRange === key ? SE_GREEN_DARK : "#777",
              fontSize: 12.5, fontWeight: timeRange === key ? 700 : 500,
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
              padding: "7px 14px", borderRadius: 6,
              border: chartType === t ? `2px solid ${SE_GOLD}` : "1px solid #ccc",
              background: chartType === t ? `${SE_GOLD}15` : "#fff",
              color: chartType === t ? "#8B6914" : "#999",
              fontSize: 12.5, fontWeight: chartType === t ? 700 : 500,
              cursor: "pointer"
            }}
          >
            {t === "line" ? "Line" : "Bar"}
          </button>
        ))}
      </div>

      {/* Totals */}
      {activeFunds.length > 0 && (
        <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
          {activeFunds.map(f => (
            <div key={f} style={{
              padding: "10px 18px", background: "#fff",
              border: `1px solid ${fundColorMap[f]}25`,
              borderLeft: `4px solid ${fundColorMap[f]}`,
              borderRadius: 6, minWidth: 150,
              boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
            }}>
              <div style={{ fontSize: 11, color: "#888", marginBottom: 3, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>{f}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>
                {fmtFull(totals[f] || 0)}
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
        {filteredData.length === 0 || activeFunds.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: "#aaa", fontSize: 14 }}>
            {activeFunds.length === 0 ? "Select at least one fund below." : "No data for the selected range."}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={370}>
            {chartType === "line" ? (
              <LineChart data={filteredData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 11, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 11, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: sans }} />
                {activeFunds.map(f => (
                  <Line key={f} type="monotone" dataKey={f} stroke={fundColorMap[f]} strokeWidth={2.5} dot={{ r: 3, fill: fundColorMap[f] }} activeDot={{ r: 5 }} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={filteredData} margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={`${SE_GREEN}10`} />
                <XAxis dataKey="month" tick={{ fill: "#888", fontSize: 11, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmt} tick={{ fill: "#888", fontSize: 11, fontFamily: sans }} axisLine={{ stroke: `${SE_GREEN}20` }} tickLine={false} />
                <Tooltip content={<CustomTooltip />} />
                <Legend wrapperStyle={{ fontSize: 12, fontFamily: sans }} />
                {activeFunds.map(f => (
                  <Bar key={f} dataKey={f} fill={fundColorMap[f]} radius={[3, 3, 0, 0]} opacity={0.88} />
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>

      {/* Fund selector */}
      <div style={{
        background: "#fff", border: `1px solid ${SE_GREEN}12`,
        borderRadius: 8, padding: "14px 18px",
        boxShadow: "0 1px 4px rgba(0,89,33,0.04)"
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: SE_GREEN_DARK, fontFamily: serif }}>Funds</span>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={selectAll} style={{ background: "none", border: "none", color: SE_GREEN, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>All</button>
            <span style={{ color: "#ccc" }}>|</span>
            <button onClick={selectNone} style={{ background: "none", border: "none", color: SE_GREEN, fontSize: 12, cursor: "pointer", fontWeight: 600 }}>None</button>
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
                  fontSize: 12.5, fontWeight: active ? 600 : 400,
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

      <div style={{ marginTop: 16, fontSize: 11, color: "#aaa", textAlign: "center" }}>
        Gifts aggregated by calendar month per fund. Fiscal year begins July 1.
      </div>
    </div>
  );
}
