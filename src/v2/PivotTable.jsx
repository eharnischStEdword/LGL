import { useMemo } from "react";
import { T } from "./theme.jsx";
import { MONTHS, FY_MONTH_LABELS, DATA_FLOOR, fmtCents } from "./lib.js";

// Months-by-years pivot (v1 tableData semantics, restyled): FY or CY basis,
// Total and Monthly Avg columns, tabular numerals everywhere, sticky year
// column. Cents live here (and in tooltips and the bulletin) — nowhere else.

export default function PivotTable({ giftIndex, selectedFunds, tableMode, now }) {
  const rows = useMemo(() => {
    const sumSelected = (yr, mo) => {
      let total = 0;
      for (const f of selectedFunds) total += giftIndex.byFund[`${f}|${yr}|${mo}`] || 0;
      return total;
    };

    if (tableMode === "fy") {
      const currentFYStart = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      const out = [];
      for (let fyStart = currentFYStart; fyStart >= 2019; fyStart--) {
        const row = { label: `FY${String(fyStart).slice(2)}-${String(fyStart + 1).slice(2)}` };
        let grandTotal = 0, monthCount = 0;
        for (let mi = 0; mi < 12; mi++) {
          const calMonth = (mi + 6) % 12;
          const calYear = calMonth >= 6 ? fyStart : fyStart + 1;
          if (new Date(calYear, calMonth, 1) > now) continue;
          const monthTotal = sumSelected(calYear, calMonth);
          row[FY_MONTH_LABELS[mi]] = monthTotal;
          grandTotal += monthTotal;
          monthCount++;
        }
        row.total = grandTotal;
        row.avg = monthCount > 0 ? grandTotal / monthCount : 0;
        out.push(row);
      }
      return out;
    }
    const currentYear = now.getFullYear();
    const out = [];
    for (let yr = currentYear; yr >= 2019; yr--) {
      const row = { label: String(yr) };
      let grandTotal = 0, monthCount = 0;
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
      if (monthCount > 0) out.push(row);
    }
    return out;
  }, [giftIndex, selectedFunds, tableMode, now]);

  if (selectedFunds.size === 0) {
    return <div style={{ textAlign: "center", padding: 60, color: T.ink3, fontSize: 15 }}>Select at least one fund below.</div>;
  }

  const monthCols = tableMode === "fy" ? FY_MONTH_LABELS : MONTHS;

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13.5, fontFamily: T.sans }}>
        <thead>
          <tr style={{ borderBottom: `2px solid ${T.green}30` }}>
            <th style={{ textAlign: "left", padding: "8px 10px", color: T.greenDark, fontWeight: 700, position: "sticky", left: 0, background: T.card, minWidth: 76 }}>
              {tableMode === "fy" ? "FY" : "Year"}
            </th>
            {monthCols.map(m => (
              <th key={m} style={{ textAlign: "right", padding: "8px 8px", color: T.ink2, fontWeight: 600, minWidth: 74 }}>{m}</th>
            ))}
            <th style={{ textAlign: "right", padding: "8px 10px", color: T.greenDark, fontWeight: 700, minWidth: 92, borderLeft: `2px solid ${T.green}20` }}>Total</th>
            <th style={{ textAlign: "right", padding: "8px 10px", color: T.greenDark, fontWeight: 700, minWidth: 92 }}>Mo. Avg</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={row.label} style={{ borderBottom: `1px solid ${T.green}10`, background: ri % 2 === 0 ? "#fafcfa" : T.card }}>
              <td style={{ padding: "8px 10px", fontWeight: 700, color: T.greenDark, position: "sticky", left: 0, background: ri % 2 === 0 ? "#fafcfa" : T.card }}>{row.label}</td>
              {monthCols.map(m => (
                <td key={m} style={{ textAlign: "right", padding: "8px 8px", color: row[m] ? T.ink : "#c9d2cb", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {row[m] != null ? fmtCents(row[m]) : "—"}
                </td>
              ))}
              <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 700, color: T.greenDark, borderLeft: `2px solid ${T.green}20`, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {fmtCents(row.total)}
              </td>
              <td style={{ textAlign: "right", padding: "8px 10px", fontWeight: 600, color: T.ink2, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                {fmtCents(row.avg)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
