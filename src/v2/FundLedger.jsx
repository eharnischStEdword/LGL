import { useMemo, useState } from "react";
import { T, Card, ScopePill, ALL_FUNDS_KEY } from "./theme.jsx";
import { fmtWhole } from "./lib.js";

// One ranked, searchable list replaces v1's two competing 40-row controls
// (the chip grid and the Fund Totals table). Collapsed by default behind a
// header that is itself information. Rows sort by range total; the share bar
// shows each fund's slice of the grand total; the trend arrow comes from the
// same per-fund prior-period math the tiles use. Selected funds always render
// even at $0 so they can be unchecked. The pinned All Funds (Total) row wears
// SE blue — its one identity everywhere in v2.

export default function FundLedger(props) {
  const {
    funds, giftIndex, monthBuckets, periodLabel, selectedFunds, toggleFund,
    showAllFundsTotal, setShowAllFundsTotal, trendMap, isOffertoryOnly,
    open, setOpen, ledgerRef,
  } = props;
  const [search, setSearch] = useState("");

  const { rows, grand } = useMemo(() => {
    const out = [];
    for (const f of funds) {
      let tot = 0;
      for (const b of monthBuckets) tot += giftIndex.byFund[`${f}|${b.y}|${b.m}`] || 0;
      if (tot !== 0 || selectedFunds.has(f)) out.push({ fund: f, total: tot });
    }
    out.sort((a, b) => b.total - a.total);
    // On the Offertory-only fallback the all-funds index would mix historical
    // 42-fund months into a report that only carries Offertory — sum the listed
    // rows instead so the header total matches what is actually loaded.
    let g = 0;
    if (isOffertoryOnly) for (const r of out) g += r.total;
    else for (const b of monthBuckets) g += giftIndex.allFunds[`${b.y}|${b.m}`] || 0;
    return { rows: out, grand: g };
  }, [funds, giftIndex, monthBuckets, selectedFunds, isOffertoryOnly]);

  const q = search.trim().toLowerCase();
  const visible = q ? rows.filter(r => r.fund.toLowerCase().includes(q)) : rows;

  const selectAllVisible = () => { for (const r of visible) if (!selectedFunds.has(r.fund)) toggleFund(r.fund); };
  const selectNoneVisible = () => { for (const r of visible) if (selectedFunds.has(r.fund)) toggleFund(r.fund); };

  return (
    <div ref={ledgerRef} style={{ marginBottom: 14 }}>
      <Card style={{ padding: 0 }}>
        <button
          onClick={() => setOpen(o => !o)}
          style={{
            display: "flex", alignItems: "center", gap: 8, width: "100%",
            background: "none", border: "none", cursor: "pointer", textAlign: "left",
            padding: "13px 18px", fontFamily: T.sans, fontSize: 14.5, fontWeight: 700, color: T.greenDark,
          }}
        >
          <span style={{ fontFamily: T.serif, fontSize: 17 }}>Funds</span>
          <span style={{ fontWeight: 400, color: T.ink2, fontSize: 13 }}>
            {selectedFunds.size} charted &middot; {rows.length} with activity &middot;{" "}
            <span style={{ fontFamily: T.serif, color: T.greenDark }}>{fmtWhole(grand)}</span> total &middot; {periodLabel}
          </span>
          <span style={{ marginLeft: "auto", color: T.ink3, fontSize: 13, fontWeight: 400 }}>
            {open ? "▾ collapse" : "▸ expand"}
          </span>
        </button>

        {open && (
          <div style={{ borderTop: `1px solid ${T.hairline}` }}>
            <div style={{ display: "flex", gap: 10, alignItems: "center", padding: "10px 18px", flexWrap: "wrap" }}>
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search funds…"
                style={{
                  flex: "1 1 200px", maxWidth: 300, boxSizing: "border-box",
                  padding: "6px 12px", borderRadius: 6, border: `1px solid ${T.hairline}`,
                  fontSize: 13, fontFamily: T.sans, color: T.ink, outline: "none",
                }}
              />
              <div style={{ display: "flex", gap: 8, fontSize: 13.5, fontWeight: 600 }}>
                <button onClick={selectAllVisible} style={{ background: "none", border: "none", color: T.green, cursor: "pointer", fontFamily: T.sans, fontWeight: 600 }}>All</button>
                <span style={{ color: T.hairline }}>|</span>
                <button onClick={selectNoneVisible} style={{ background: "none", border: "none", color: T.green, cursor: "pointer", fontFamily: T.sans, fontWeight: 600 }}>None</button>
              </div>
              {q && visible.length === 0 && (
                <span style={{ color: T.ink3, fontSize: 13 }}>No funds match &ldquo;{search}&rdquo;.</span>
              )}
            </div>

            <div style={{ maxHeight: 420, overflowY: "auto" }}>
              {/* Pinned All Funds (Total) row — SE blue, toggles the total line
                  on the chart. Hidden on the Offertory-only fallback, where a
                  parish-wide total would be misleading. */}
              {!q && !isOffertoryOnly && (
                <LedgerRow
                  label={ALL_FUNDS_KEY}
                  total={grand} grand={grand}
                  checked={showAllFundsTotal}
                  onToggle={() => setShowAllFundsTotal(v => !v)}
                  color={T.blue} bold
                />
              )}
              {visible.map(({ fund, total }) => (
                <LedgerRow
                  key={fund}
                  label={fund}
                  total={total} grand={grand}
                  checked={selectedFunds.has(fund)}
                  onToggle={() => toggleFund(fund)}
                  color={T.green}
                  trend={trendMap[fund]}
                />
              ))}
            </div>
            <div style={{ padding: "9px 18px", fontSize: 12, color: T.ink3, borderTop: `1px solid ${T.hairline}` }}>
              Click a row to add or remove it from the chart. Trend arrows compare this fiscal year to the same completed window last year.
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function LedgerRow({ label, total, grand, checked, onToggle, color, bold, trend }) {
  const share = grand > 0 ? Math.max(0, Math.min(1, total / grand)) : 0;
  return (
    <div
      onClick={onToggle}
      style={{
        display: "grid", gridTemplateColumns: "20px minmax(140px, 1fr) minmax(80px, 130px) 110px",
        gap: 10, alignItems: "center", padding: "7px 18px", cursor: "pointer",
        borderTop: "1px solid #f1f5f2", fontSize: 13.5, fontFamily: T.sans,
        background: bold ? "#eef3f8" : checked ? `${color}0a` : "transparent",
        fontWeight: bold ? 700 : 400,
      }}
    >
      <span style={{
        width: 15, height: 15, borderRadius: 4, flexShrink: 0, position: "relative",
        border: checked ? `1.5px solid ${color}` : "1.5px solid #b9c6bd",
        background: checked ? color : "transparent",
      }}>
        {checked && <span style={{ color: "#fff", fontSize: 11, position: "absolute", top: -2, left: 2 }}>✓</span>}
      </span>
      <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {label}
        {trend && trend.kind === "pct" && (
          <span style={{ marginLeft: 6, fontSize: 12, color: trend.pct >= 0 ? T.green : T.red }}>
            {trend.pct >= 0 ? "▲" : "▼"}
          </span>
        )}
        {trend && trend.kind === "new" && <span style={{ marginLeft: 6 }}><ScopePill>new</ScopePill></span>}
      </span>
      <span style={{ height: 7, borderRadius: 4, background: "#e7eee9", overflow: "hidden" }}>
        <span style={{ display: "block", height: "100%", width: `${share * 100}%`, background: bold ? T.blue : T.green, borderRadius: 4 }} />
      </span>
      <span style={{
        textAlign: "right", fontFamily: T.serif, fontVariantNumeric: "tabular-nums",
        color: bold ? T.blue : T.greenDark, whiteSpace: "nowrap",
      }}>{fmtWhole(total)}</span>
    </div>
  );
}
