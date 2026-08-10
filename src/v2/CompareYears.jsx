import { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, Legend, ResponsiveContainer, BarChart, Bar
} from "recharts";
import { T, Card, ScopePill, Delta, InfoTip } from "./theme.jsx";
import { MONTHS, FY_MONTH_LABELS, fmtWhole, fmtCents, fmtLabel } from "./lib.js";

// Compare Years merges v1's YoY and FY Compare views. The subtraction happens
// on screen (one card per fund with a computed verdict), the years are
// computed instead of hardcoded, and the methodology paragraph collapses into
// a scope pill + tooltip. Chart conventions from v1 survive: prior year
// dashed, oldest FY gray, current solid; the in-progress month is marked *
// and excluded from every total.
// INTENTIONAL divergence from v1: totals clip to completed months in BOTH
// bases, so when a period has no completed month yet (calendar basis in
// January; fiscal basis in July) the cards show an explicit "no completed
// months yet" state. v1 instead compared a partial January against a complete
// prior January (calendar) and rendered $0 cards in July (fiscal).

const METHODOLOGY = "Totals cover completed months only. The month in progress is left out of every year so all years compare the same window.";

function fundYearTotals(giftIndex, fund, basis, now) {
  // Returns [{label, total, current:bool}] oldest -> newest, clipped to the
  // same completed-month window across all years (v1 semantics).
  if (basis === "fiscal") {
    const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const lastCompletedIdx = ((now.getMonth() + 6) % 12) - 1; // FY-month index of last complete month
    return [currentFYStart - 2, currentFYStart - 1, currentFYStart].map(fyStart => {
      let total = 0;
      for (let mi = 0; mi <= lastCompletedIdx; mi++) {
        const calMonth = (mi + 6) % 12;
        const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
        total += giftIndex.byFund[`${fund}|${calYear}|${calMonth}`] || 0;
      }
      return {
        label: `FY ${fyStart}–${String(fyStart + 1).slice(2)}`,
        total,
        current: fyStart === currentFYStart,
      };
    });
  }
  const curY = now.getFullYear();
  const lastCompletedMonth = now.getMonth() - 1; // may be -1 in January
  return [curY - 1, curY].map(year => {
    let total = 0;
    for (let m = 0; m <= lastCompletedMonth; m++) {
      total += giftIndex.byFund[`${fund}|${year}|${m}`] || 0;
    }
    return { label: String(year), total, current: year === curY };
  });
}

function throughLabel(basis, now) {
  if (basis === "fiscal") {
    const idx = ((now.getMonth() + 6) % 12) - 1;
    return idx >= 0 ? FY_MONTH_LABELS[idx] : null;
  }
  return now.getMonth() >= 1 ? MONTHS[now.getMonth() - 1] : null;
}

function FundCompareCard({ fund, color, years, through }) {
  const cur = years[years.length - 1];
  const prev = years[years.length - 2];
  if (!through) {
    // No completed month in the window yet (calendar January, fiscal July):
    // an explicit empty state, never fake $0 rows.
    return (
      <div style={{
        background: T.card, border: `1px solid ${T.hairline}`, borderLeft: `4px solid ${color}`,
        borderRadius: 8, padding: "12px 14px", minWidth: 250, flex: "1 1 260px", maxWidth: 380,
      }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 6 }}>{fund}</div>
        <div style={{ fontSize: 13, color: T.ink3 }}>
          No completed months yet this period. Totals appear after the first full month.
        </div>
      </div>
    );
  }
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.hairline}`, borderLeft: `4px solid ${color}`,
      borderRadius: 8, padding: "12px 14px", minWidth: 250, flex: "1 1 260px", maxWidth: 380,
    }}>
      <div style={{ fontSize: 13.5, fontWeight: 700, color: T.ink, marginBottom: 6, display: "flex", alignItems: "center", flexWrap: "wrap", gap: 4 }}>
        <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{fund}</span>
        {through && <ScopePill title={METHODOLOGY}>through {through}</ScopePill>}
        <InfoTip text={METHODOLOGY} />
      </div>
      {years.map(yr => (
        <div key={yr.label} style={{ display: "flex", alignItems: "baseline", gap: 10, padding: "3px 0" }}>
          <span style={{ fontSize: 12.5, color: T.ink3, width: 86, flexShrink: 0, fontWeight: yr.current ? 700 : 400 }}>{yr.label}</span>
          <span style={{
            fontFamily: T.serif, fontVariantNumeric: "tabular-nums",
            fontSize: yr.current ? 23 : 14.5,
            color: yr.current ? T.greenDark : T.ink2,
          }}>{fmtWhole(yr.total)}</span>
        </div>
      ))}
      <div style={{ marginTop: 6 }}>
        {cur.total === 0 && prev.total === 0 ? (
          <span style={{ fontSize: 13, color: T.ink3 }}>No giving in either period</span>
        ) : prev.total === 0 ? (
          <ScopePill>New &middot; no prior-window giving</ScopePill>
        ) : (
          <Delta
            value={cur.total - prev.total}
            pct={((cur.total - prev.total) / prev.total) * 100}
            window={`vs ${prev.label}`}
          />
        )}
      </div>
    </div>
  );
}

export default function CompareYears({ giftIndex, selectedFunds, fundColorMap, basis, chartType, now }) {
  const activeFunds = useMemo(() => [...selectedFunds].sort(), [selectedFunds]);
  const through = throughLabel(basis, now);

  const { rows, seriesMeta } = useMemo(() => {
    if (basis === "fiscal") {
      const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const fyStartYears = [currentFYStart - 2, currentFYStart - 1, currentFYStart];
      const meta = [];
      for (const fund of activeFunds) {
        fyStartYears.forEach((fyStart, i) => {
          meta.push({
            key: `${fund} (FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)})`,
            fund, rank: i, // 0 oldest, 2 current
          });
        });
      }
      const out = FY_MONTH_LABELS.map((label, monthIdx) => {
        const calMonth = (monthIdx + 6) % 12;
        const oldestCalYear = calMonth >= 6 ? fyStartYears[0] : fyStartYears[0] + 1;
        if (new Date(oldestCalYear, calMonth, 1) > now) return null;
        const isCurrent = calMonth === now.getMonth() &&
          (calMonth >= 6 ? fyStartYears[2] : fyStartYears[2] + 1) === now.getFullYear();
        const row = { month: isCurrent ? `${label}*` : label };
        for (const fund of activeFunds) {
          fyStartYears.forEach((fyStart, i) => {
            const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
            const key = `${fund} (FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)})`;
            row[key] = new Date(calYear, calMonth, 1) > now ? null : (giftIndex.byFund[`${fund}|${calYear}|${calMonth}`] || 0);
          });
        }
        return row;
      }).filter(Boolean);
      return { rows: out, seriesMeta: meta };
    }
    const curY = now.getFullYear();
    const calYears = [curY - 1, curY];
    const currentMonth = now.getMonth();
    const meta = [];
    for (const fund of activeFunds) {
      calYears.forEach((year, i) => meta.push({ key: `${fund} (${year})`, fund, rank: i === 0 ? 1 : 2 }));
    }
    const out = MONTHS.map((label, monthIdx) => {
      if (monthIdx > currentMonth) return null;
      const row = { month: monthIdx === currentMonth ? `${label}*` : label };
      for (const fund of activeFunds) {
        for (const year of calYears) {
          row[`${fund} (${year})`] = giftIndex.byFund[`${fund}|${year}|${monthIdx}`] || 0;
        }
      }
      return row;
    }).filter(Boolean);
    return { rows: out, seriesMeta: meta };
  }, [basis, activeFunds, giftIndex, now]);

  if (activeFunds.length === 0) {
    return <div style={{ textAlign: "center", padding: 60, color: T.ink3, fontSize: 15 }}>Select at least one fund below.</div>;
  }

  const fmtAxis = (v) => Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(0)}k` : `$${v}`;
  const styleFor = (m) => {
    const base = fundColorMap[m.fund] || T.green;
    if (m.rank === 0) return { stroke: "#9aa39d", dash: "3 3", width: 1.5, opacity: 0.7 };
    if (m.rank === 1) return { stroke: base, dash: "6 3", width: 2, opacity: 0.85 };
    return { stroke: base, dash: undefined, width: 2.5, opacity: 1 };
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        {activeFunds.map(f => (
          <FundCompareCard
            key={f} fund={f} color={fundColorMap[f] || T.green}
            years={fundYearTotals(giftIndex, f, basis, now)}
            through={through}
          />
        ))}
      </div>
      <ResponsiveContainer width="100%" height={370}>
        {chartType === "bar" ? (
          <BarChart data={rows} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid stroke={`${T.green}12`} />
            <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 13, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false} />
            <YAxis tickFormatter={fmtAxis} tick={{ fill: T.ink3, fontSize: 12, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false} />
            <Tooltip formatter={(v) => fmtCents(v)} contentStyle={{ fontFamily: T.sans, fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 12.5, fontFamily: T.sans }} />
            {seriesMeta.map(m => {
              const s = styleFor(m);
              return <Bar key={m.key} dataKey={m.key} fill={s.stroke} fillOpacity={m.rank === 2 ? 0.85 : m.rank === 1 ? 0.5 : 0.35} radius={[3, 3, 0, 0]} isAnimationActive={false} />;
            })}
          </BarChart>
        ) : (
          <LineChart data={rows} margin={{ top: 20, right: 20, left: 10, bottom: 5 }}>
            <CartesianGrid stroke={`${T.green}12`} />
            <XAxis dataKey="month" tick={{ fill: T.ink3, fontSize: 13, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false} />
            <YAxis tickFormatter={fmtAxis} tick={{ fill: T.ink3, fontSize: 12, fontFamily: T.sans }} axisLine={{ stroke: `${T.green}20` }} tickLine={false} />
            <Tooltip formatter={(v) => fmtCents(v)} contentStyle={{ fontFamily: T.sans, fontSize: 13 }} />
            <Legend wrapperStyle={{ fontSize: 12.5, fontFamily: T.sans }} />
            {seriesMeta.map(m => {
              const s = styleFor(m);
              return (
                <Line key={m.key} type="monotone" dataKey={m.key} stroke={s.stroke} strokeWidth={s.width}
                  strokeDasharray={s.dash} opacity={s.opacity} dot={{ r: m.rank === 0 ? 2 : 3, fill: s.stroke }}
                  activeDot={{ r: 5 }} isAnimationActive={false} connectNulls={false} />
              );
            })}
          </LineChart>
        )}
      </ResponsiveContainer>
      <div style={{ fontSize: 12, color: T.ink3, marginTop: 6 }}>
        * month in progress, excluded from the totals above. {basis === "fiscal" ? "Oldest fiscal year drawn gray." : "Prior year drawn dashed."}
      </div>
    </div>
  );
}
