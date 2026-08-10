import { T, Card, StatusPill } from "./theme.jsx";
import { fmtLabel, fmtWhole, fmtWeekLabel, getFYLabel } from "./lib.js";

// The Recent Weeks panel: 8 Mon-Sun bars labeled by ending Sunday. Provisional
// ("counting") weeks render striped gold with gray labels and are excluded
// from the 4-week average and every comparison. Gold stripes mean "still in
// progress", never a value judgment — no red arrow can appear on a counting
// week. One fund at a time (Offertory default): weekly resolution across 42
// funds is exactly the wall of info v2 removes.

export const WEEKLY_ALL = "__ALL__";
const ALL = WEEKLY_ALL;

export default function RecentWeeks({ weeklyModel, weeklyFund, funds, onFundChange, fyPace, now }) {
  const fundLabel = weeklyFund === ALL ? "All Funds" : weeklyFund;

  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 4 }}>
        <span style={{ fontFamily: T.serif, fontSize: 18, color: T.greenDark }}>
          Recent Weeks &middot; {fundLabel}
        </span>
        <select
          value={weeklyFund}
          onChange={e => onFundChange(e.target.value)}
          style={{
            fontSize: 12.5, fontFamily: T.sans, color: T.greenDark,
            border: `1px solid ${T.hairline}`, borderRadius: 6, padding: "3px 6px",
            background: T.card, cursor: "pointer",
          }}
        >
          {funds.map(f => <option key={f} value={f}>{f}</option>)}
          <option value={ALL}>All Funds (Total)</option>
        </select>
        <span style={{ marginLeft: "auto", fontSize: 12, color: T.ink3 }}>weekly detail available from 2025</span>
      </div>

      {!weeklyModel || weeklyModel.weeks.length === 0 ? (
        <div style={{ padding: "40px 0", textAlign: "center", color: T.ink3, fontSize: 14 }}>
          No weekly data yet for {fundLabel}.
        </div>
      ) : (
        <WeeklyBody weeklyModel={weeklyModel} fyPace={fyPace} now={now} />
      )}
    </Card>
  );
}

function WeeklyBody({ weeklyModel, fyPace, now }) {
  const { weeks, counting, fourWeekAvg, thisWeekSoFar, lastComplete } = weeklyModel;
  const max = Math.max(...weeks.map(w => w.total), fourWeekAvg || 0, 1);
  const H = 180; // bar area height in px

  return (
    <>
      {counting.length > 0 && (
        <div style={{
          background: "#fbf6e2", border: `1px solid ${T.goldLight}`, borderRadius: 6,
          fontSize: 12.5, color: "#6d5a0a", padding: "7px 12px", margin: "8px 0 6px",
        }}>
          {counting.length === 1 && lastComplete
            ? <>Sunday's collection is still being counted. The week ending {fmtWeekLabel(counting[0].endSunday)} shows gifts posted so far; plate and checks usually post by Tuesday.</>
            : <>The newest {counting.length === 1 ? "week is" : "weeks are"} still being counted; plate and checks usually post by Tuesday.</>}
        </div>
      )}

      {/* Fixed geometry so every bar shares one baseline: label row (18px) +
          bar area (H px) + footer (40px + 6px gap = bars bottom out 46px up).
          The dashed 4-week-average line is positioned from those constants,
          inside an inner positioning context so it spans the full scrollable
          width on narrow screens. */}
      <div style={{ overflowX: "auto", marginTop: 8 }}>
      <div style={{ display: "flex", gap: 12, position: "relative", minWidth: "100%", width: "max-content", padding: "0 4px", boxSizing: "border-box" }}>
        {fourWeekAvg != null && fourWeekAvg > 0 && (
          <div style={{
            position: "absolute", left: 0, right: 0,
            bottom: 46 + (fourWeekAvg / max) * H,
            borderTop: `2px dashed ${T.blue}`, opacity: 0.55, pointerEvents: "none",
          }} />
        )}
        {weeks.map(w => {
          const h = Math.max((w.total / max) * H, w.total > 0 ? 3 : 0);
          const isLastComplete = lastComplete && w.key === lastComplete.key;
          return (
            <div key={w.key} style={{ flex: 1, minWidth: 52 }}
              title={`${fmtWeekLabel(w.endSunday)}: ${fmtWhole(w.total)}${w.complete ? "" : " (still counting)"}${w.holyDay ? " · holy-day week" : ""}`}>
              <div style={{ height: H + 18, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end" }}>
                <span style={{ fontSize: 11, color: w.complete ? T.ink2 : "#b09310", marginBottom: 4, fontVariantNumeric: "tabular-nums" }}>
                  {w.total > 0 ? fmtLabel(w.total) : "—"}
                </span>
                <div style={{
                  width: "100%", maxWidth: 44, height: h,
                  borderRadius: "4px 4px 0 0",
                  background: w.complete
                    ? (isLastComplete ? T.greenDark : T.green)
                    : `repeating-linear-gradient(45deg, ${T.gold}55 0 5px, ${T.card} 5px 10px)`,
                  border: w.complete ? "none" : `1.5px dashed ${T.gold}`,
                  borderBottom: "none",
                  boxSizing: "border-box",
                }} />
              </div>
              <div style={{ height: 40, fontSize: 11, color: T.ink3, marginTop: 6, textAlign: "center", lineHeight: 1.3 }}>
                {isLastComplete ? <b style={{ color: T.ink2 }}>{fmtWeekLabel(w.endSunday)}</b> : fmtWeekLabel(w.endSunday)}
                {w.holyDay && <span title="Contains Christmas, Easter, or Ash Wednesday — comparisons suppressed"> ✝</span>}
                {!w.complete && <><br /><StatusPill complete={false} /></>}
              </div>
            </div>
          );
        })}
      </div>
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap", marginTop: 10, fontSize: 11.5, color: T.ink2 }}>
        {fourWeekAvg != null && fourWeekAvg > 0 && (
          <span>
            <span style={{ display: "inline-block", width: 22, borderTop: `2px dashed ${T.blue}`, verticalAlign: 3, marginRight: 5 }} />
            4-week average of complete weeks ({fmtLabel(fourWeekAvg)})
          </span>
        )}
        {thisWeekSoFar != null && thisWeekSoFar > 0 && (
          <span style={{ color: T.ink3 }}>This week so far: {fmtWhole(thisWeekSoFar)} (online gifts land daily)</span>
        )}
      </div>

      {fyPace && fyPace.prior > 0 && (
        <div style={{
          marginTop: 12, background: "#eef3f8", border: "1px solid #d7e2ec",
          borderRadius: 6, padding: "8px 12px", fontSize: 13, color: T.blue,
        }}>
          {getFYLabel(now)} pace: <b>{fmtWhole(fyPace.current)}</b> to date,{" "}
          {Math.abs(((fyPace.current - fyPace.prior) / fyPace.prior) * 100).toFixed(1)}%{" "}
          {fyPace.current >= fyPace.prior ? "ahead of" : "behind"} last year through the same completed week.
        </div>
      )}
    </>
  );
}
