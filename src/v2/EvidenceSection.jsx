import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar, LabelList, Cell
} from "recharts";
import { T, Card, Segmented, MiniToggle, ALL_FUNDS_KEY } from "./theme.jsx";
import {
  MONTHS, DATA_FLOOR, getFYStart, getFYLabel, getMonthKey, getMonthLabel,
  computeTrend, fmtLabel, fmtCents,
} from "./lib.js";
import CompareYears from "./CompareYears.jsx";
import PivotTable from "./PivotTable.jsx";

// The evidence layer: one card, one consistent control style. Period and View
// are labeled segmented groups; Line/Bar/Log live in a quiet corner cluster.
// Defaults: This FY + Monthly trend (parish staff think fiscally). The
// in-progress month gets the same visual convention on EVERY view: the solid
// line stops at the last complete month, a dashed segment with a hollow dot
// carries it to the month-to-date value, and the axis tick reads "Aug*".

const PERIODS = [
  { key: "fy", label: null }, // label filled at render with the live FY label
  { key: "last12", label: "Last 12 mo" },
  { key: "ytd", label: "Calendar YTD" },
  { key: "all", label: "All since 2019" },
];

const VIEWS = [
  { key: "trend", label: "Monthly trend" },
  { key: "compare", label: "Compare years" },
  { key: "table", label: "Table" },
];

function periodStart(period, now) {
  if (period === "fy") return getFYStart(now);
  if (period === "ytd") return new Date(now.getFullYear(), 0, 1);
  if (period === "last12") return new Date(now.getFullYear() - 1, now.getMonth() + 1, 1);
  return new Date(DATA_FLOOR);
}

export function monthBucketsForPeriod(period, now) {
  let start = periodStart(period, now);
  if (start < DATA_FLOOR) start = new Date(DATA_FLOOR);
  const months = [];
  const cur = new Date(start.getFullYear(), start.getMonth(), 1);
  while (cur <= now) {
    months.push({ y: cur.getFullYear(), m: cur.getMonth() });
    cur.setMonth(cur.getMonth() + 1);
  }
  return months;
}

const fmtAxis = (v) => Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;

// Collision-aware labels (v1 SmartDataLabel semantics, closure-scoped):
// every Nth point by density, but the dominant peak is always labeled.
function makeSmartLabel(total, max) {
  const step = total <= 12 ? 1 : total <= 24 ? 2 : 3;
  return function SmartLabel({ x, y, width, value, index }) {
    if (!value) return null;
    const isPeak = max > 0 && value >= max * 0.85;
    if (index % step !== 0 && !isPeak) return null;
    const cx = width != null ? x + width / 2 : x;
    return (
      <text x={cx} y={y - 10} textAnchor="middle" fill={T.ink2} fontSize={11} fontFamily={T.sans}>
        {fmtLabel(value)}
      </text>
    );
  };
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload) return null;
  const real = payload.filter(p => !String(p.dataKey).endsWith("_trend") && !String(p.dataKey).endsWith("__mtd") && p.value != null);
  if (real.length === 0) return null;
  return (
    <div style={{
      background: T.greenDark, borderRadius: 6, padding: "10px 14px",
      fontSize: 14, color: "#fff", fontFamily: T.sans, boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    }}>
      <div style={{ fontWeight: 700, marginBottom: 5, fontFamily: T.serif }}>{label}</div>
      {real.map((p, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 2, alignItems: "center" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: p.color, flexShrink: 0 }} />
            {String(p.name).replace("__mtd", " (month to date)")}
          </span>
          <span style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>{fmtCents(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function EvidenceSection(props) {
  const {
    giftIndex, selectedFunds, showAllFundsTotal, fundColorMap, fundCount, now,
    period, setPeriod, view, setView, chartType, setChartType,
    useLogScale, setUseLogScale, basis, setBasis, tableMode, setTableMode,
    onOpenLedger,
  } = props;

  const activeFunds = useMemo(() => [...selectedFunds].sort(), [selectedFunds]);
  const currentKey = getMonthKey(now);

  // Monthly rows straight from the gift index (which already merges historical
  // months under live-key gating), so chart, tiles, and ledger always tie out.
  const { chartData, seriesKeys } = useMemo(() => {
    if (view !== "trend") return { chartData: [], seriesKeys: [] };
    const buckets = monthBucketsForPeriod(period, now);
    const keys = [...activeFunds];
    if (showAllFundsTotal) keys.push(ALL_FUNDS_KEY);
    let rows = buckets.map(({ y, m }) => {
      const mk = `${y}-${String(m + 1).padStart(2, "0")}`;
      const isCurrent = mk === currentKey;
      const row = { month: isCurrent ? `${MONTHS[m]}*` : getMonthLabel(mk), _key: mk, _isCurrent: isCurrent };
      for (const f of activeFunds) row[f] = giftIndex.byFund[`${f}|${y}|${m}`] || 0;
      if (showAllFundsTotal) row[ALL_FUNDS_KEY] = giftIndex.allFunds[`${y}|${m}`] || 0;
      return row;
    });

    // Trendline over completed months only, then split the current month onto
    // a dashed month-to-date series so the solid line stops honestly.
    const completed = rows.filter(r => !r._isCurrent);
    for (const key of keys) {
      const trend = computeTrend(completed, key);
      if (trend) {
        const trendByKey = new Map(trend.data.map(r => [r._key, r[`${key}_trend`]]));
        rows = rows.map(r => (trendByKey.has(r._key) ? { ...r, [`${key}_trend`]: trendByKey.get(r._key) } : r));
      }
    }
    const lastCompletedKey = completed.length > 0 ? completed[completed.length - 1]._key : null;
    rows = rows.map(r => {
      if (!r._isCurrent && r._key !== lastCompletedKey) return r;
      const out = { ...r };
      for (const key of keys) {
        out[`${key}__mtd`] = r[key];
        if (r._isCurrent) out[key] = null; // solid line ends at last complete month
      }
      return out;
    });
    return { chartData: rows, seriesKeys: keys };
  }, [view, period, activeFunds, showAllFundsTotal, giftIndex, currentKey, now]);

  const logSafeData = useMemo(() => {
    if (!useLogScale) return chartData;
    return chartData.map(row => {
      const r = { ...row };
      for (const k of seriesKeys) {
        if (r[k] === 0) r[k] = null;
        if (r[`${k}__mtd`] === 0) r[`${k}__mtd`] = null;
      }
      return r;
    });
  }, [chartData, seriesKeys, useLogScale]);

  const maxVal = useMemo(
    () => Math.max(0, ...chartData.flatMap(d => seriesKeys.map(k => d[k] || d[`${k}__mtd`] || 0))),
    [chartData, seriesKeys]
  );
  const SmartLabel = useMemo(() => makeSmartLabel(chartData.length, maxVal), [chartData.length, maxVal]);

  const periodLabel = { fy: getFYLabel(now), last12: "Last 12 months", ytd: `Calendar ${now.getFullYear()} YTD`, all: "Since Jul 2019" }[period];
  const scopeParts = [];
  if (showAllFundsTotal) scopeParts.push("All Funds total");
  if (activeFunds.length > 0) scopeParts.push(activeFunds.length <= 3 ? activeFunds.join(", ") : `${activeFunds.length} funds`);

  const tall = seriesKeys.length > 8; // same count that hides the legend
  const MtdDot = ({ cx, cy, payload, stroke }) => {
    if (!payload?._isCurrent || cx == null || cy == null) return null;
    return <circle cx={cx} cy={cy} r={4.5} fill={T.card} stroke={stroke} strokeWidth={2} />;
  };

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
        <Segmented
          label="Period"
          options={PERIODS.map(p => ({ ...p, label: p.label || getFYLabel(now) }))}
          value={period}
          onChange={setPeriod}
        />
        <Segmented label="View" options={VIEWS} value={view} onChange={setView} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {view === "trend" && (
            <>
              <MiniToggle active={chartType === "line"} onClick={() => setChartType("line")}>Line</MiniToggle>
              <MiniToggle active={chartType === "bar"} onClick={() => setChartType("bar")}>Bar</MiniToggle>
              <MiniToggle active={useLogScale} onClick={() => setUseLogScale(v => !v)}
                title="Logarithmic scale for mixed-magnitude comparisons; $0 months show as gaps">Log</MiniToggle>
            </>
          )}
          {view === "compare" && (
            <>
              <MiniToggle active={basis === "fiscal"} onClick={() => setBasis("fiscal")}>Fiscal years</MiniToggle>
              <MiniToggle active={basis === "calendar"} onClick={() => setBasis("calendar")}>Calendar years</MiniToggle>
            </>
          )}
          {view === "table" && (
            <>
              <MiniToggle active={tableMode === "fy"} onClick={() => setTableMode("fy")}>Fiscal (Jul&ndash;Jun)</MiniToggle>
              <MiniToggle active={tableMode === "cy"} onClick={() => setTableMode("cy")}>Calendar (Jan&ndash;Dec)</MiniToggle>
            </>
          )}
        </div>
      </div>

      <div style={{ fontSize: 12.5, color: T.ink3, marginBottom: 10, display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        <span>
          Showing: {scopeParts.length > 0 ? scopeParts.join(" + ") : "nothing selected"} &middot; {activeFunds.length} of {fundCount} funds &middot; {periodLabel}
        </span>
        <button onClick={onOpenLedger} style={{
          background: "none", border: "none", color: T.green, fontWeight: 600,
          fontSize: 12.5, cursor: "pointer", fontFamily: T.sans, padding: 0,
        }}>Change funds</button>
        {view === "trend" && (
          <span style={{ flexBasis: "100%" }}>
            * month in progress, dashed to a hollow dot &middot; dashed straight line = trend over complete months
          </span>
        )}
      </div>

      {view === "compare" && (
        <CompareYears
          giftIndex={giftIndex} selectedFunds={selectedFunds} fundColorMap={fundColorMap}
          basis={basis} chartType={chartType} now={now}
        />
      )}
      {view === "table" && (
        <PivotTable giftIndex={giftIndex} selectedFunds={selectedFunds} tableMode={tableMode} now={now} />
      )}
      {view === "trend" && (
        seriesKeys.length === 0 ? (
          <div style={{ textAlign: "center", padding: 60, color: T.ink3, fontSize: 15 }}>
            Select at least one fund below (or the All Funds total).
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={tall ? 500 : 380}>
            {chartType === "line" ? (
              <LineChart data={logSafeData} margin={{ top: 22, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid stroke={`${T.green}12`} />
                <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 13, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmtAxis} tick={{ fill: T.ink3, fontSize: 12, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false}
                  scale={useLogScale ? "log" : "auto"} domain={useLogScale ? [1, "auto"] : [0, "auto"]} allowDataOverflow={useLogScale} tickCount={6} />
                <Tooltip content={<ChartTooltip />} />
                {seriesKeys.length > 1 && seriesKeys.length <= 8 && <Legend wrapperStyle={{ fontSize: 13, fontFamily: T.sans }} />}
                {seriesKeys.map(k => (
                  <Line key={k} type="monotone" dataKey={k} stroke={fundColorMap[k]} strokeWidth={k === ALL_FUNDS_KEY ? 3 : 2.5}
                    dot={{ r: 3, fill: fundColorMap[k] }} activeDot={{ r: 5 }} isAnimationActive={false} connectNulls={false}>
                    <LabelList content={<SmartLabel />} />
                  </Line>
                ))}
                {seriesKeys.map(k => (
                  <Line key={`${k}__mtd`} dataKey={`${k}__mtd`} stroke={fundColorMap[k]} strokeWidth={2}
                    strokeDasharray="5 4" dot={<MtdDot stroke={fundColorMap[k]} />} activeDot={{ r: 5 }}
                    legendType="none" isAnimationActive={false} connectNulls={false} />
                ))}
                {seriesKeys.map(k => (
                  <Line key={`${k}_trend`} type="linear" dataKey={`${k}_trend`} stroke={fundColorMap[k]}
                    strokeWidth={1.5} strokeDasharray="8 4" dot={false} activeDot={false}
                    legendType="none" opacity={0.45} isAnimationActive={false} />
                ))}
              </LineChart>
            ) : (
              <BarChart data={logSafeData} margin={{ top: 22, right: 20, left: 10, bottom: 5 }}>
                <CartesianGrid stroke={`${T.green}12`} />
                <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 13, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false} interval="preserveStartEnd" />
                <YAxis tickFormatter={fmtAxis} tick={{ fill: T.ink3, fontSize: 12, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false}
                  scale={useLogScale ? "log" : "auto"} domain={useLogScale ? [1, "auto"] : [0, "auto"]} allowDataOverflow={useLogScale} tickCount={6} />
                <Tooltip content={<ChartTooltip />} />
                {seriesKeys.length > 1 && seriesKeys.length <= 8 && <Legend wrapperStyle={{ fontSize: 13, fontFamily: T.sans }} />}
                {seriesKeys.map(k => (
                  <Bar key={k} dataKey={(row) => row[k] ?? row[`${k}__mtd`]} name={k} fill={fundColorMap[k]} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {logSafeData.map((row, i) => (
                      <Cell key={i} fillOpacity={row._isCurrent ? 0.4 : 0.85} />
                    ))}
                    <LabelList content={<SmartLabel />} />
                  </Bar>
                ))}
              </BarChart>
            )}
          </ResponsiveContainer>
        )
      )}
      {useLogScale && view === "trend" && (
        <div style={{ textAlign: "right", padding: "4px 10px 0", fontSize: 10.5, fontWeight: 700, color: T.goldInk, letterSpacing: "0.1em" }}>
          LOGARITHMIC SCALE
        </div>
      )}
    </Card>
  );
}
