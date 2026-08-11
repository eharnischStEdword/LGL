import { T, Card, ScopePill, StatusPill, Delta } from "./theme.jsx";
import { MONTHS, addDays, startOfDay, fmtWhole, fmtCents, fmtWeekLabel, fmtWeekLong, getFYLabel, FY_MONTH_LABELS } from "./lib.js";

// The three questions staff walk in with, answered in plain English and big
// numbers. Block B absorbs the v1 Financial Snapshot: same math, same
// byte-for-byte Copy-for-Bulletin payload, moved from dead-last to the top.

function QuestionHead({ children }) {
  return (
    <div style={{
      fontFamily: T.serif, fontStyle: "italic", fontSize: 14.5,
      color: T.ink2, marginBottom: 8,
    }}>{children}</div>
  );
}

function BigMoney({ children, color = T.greenDark }) {
  return (
    <div style={{ fontFamily: T.serif, fontSize: 33, color, lineHeight: 1.05 }}>
      {children}
    </div>
  );
}

/* ── Block A: How was giving this week? ──
   When a week is still counting (Sun-Wed), it IS "this week" to the reader,
   so it leads the card as clearly pending — never a green Complete next to a
   half-counted number (Eric, 2026-08-11). The last complete week and its
   comparisons move below the divider. Thu-Sat there is no counting week and
   the complete week leads as before (Sunday itself counts as pending). */
function WeekBlock({ weeklyModel, fundLabel, now }) {
  const lc = weeklyModel?.lastComplete;
  const pending = weeklyModel?.counting?.length
    ? weeklyModel.counting[weeklyModel.counting.length - 1]
    : null;
  if (!lc && !pending) {
    return (
      <Card>
        <QuestionHead>How was giving this week?</QuestionHead>
        <div style={{ color: T.ink3, fontSize: 14 }}>No weekly data yet — weekly detail begins with live 2025 data.</div>
      </Card>
    );
  }
  const prior = weeklyModel.priorYearWeek;
  const avg = weeklyModel.fourWeekAvg;
  const comparisons = lc && (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {prior && prior.holyDay ? (
        <span><ScopePill title="This week or its partner week last year contains Christmas, Easter, or Ash Wednesday; a percent comparison would mislead.">holy-day week &middot; % not compared</ScopePill></span>
      ) : prior && prior.total > 0 ? (
        <Delta value={lc.total - prior.total} pct={((lc.total - prior.total) / prior.total) * 100} window="vs same week last year" />
      ) : prior ? (
        <span style={{ fontSize: 13, color: T.ink3 }}>no gifts in the same week last year</span>
      ) : (
        <span style={{ fontSize: 13, color: T.ink3 }}>same-week comparison n/a &mdash; weekly history starts Jan 2025</span>
      )}
      {avg != null && avg > 0 && (
        <Delta value={lc.total - avg} pct={((lc.total - avg) / avg) * 100} window="vs 4-week average" />
      )}
    </div>
  );
  if (pending) {
    return (
      <Card>
        <QuestionHead>How was giving this week?</QuestionHead>
        <BigMoney color={T.goldInk}>{fmtWhole(pending.total)} <span style={{ fontSize: 15, color: T.ink3 }}>so far</span></BigMoney>
        <div style={{ fontSize: 12.5, color: T.ink3, margin: "3px 0 6px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <span>{fmtWeekLong(pending.endSunday)} &middot; {fundLabel}</span>
          <StatusPill complete={false} />
        </div>
        <div style={{ fontSize: 12.5, color: T.ink3 }}>
          {now && startOfDay(now).getTime() > addDays(pending.endSunday, 4).getTime()
            ? <>Waiting on the money counters &middot; the count has not been entered yet.</>
            : <>Waiting on the money counters &middot; cash &amp; checks usually land by Thursday, {fmtWeekLabel(addDays(pending.endSunday, 4))}.</>}
        </div>
        <div style={{ borderTop: `1px solid ${T.hairline}`, marginTop: 10, paddingTop: 8 }}>
          {lc ? (
            <>
              <div style={{ fontSize: 12.5, color: T.ink2, marginBottom: 5 }}>
                Last complete week: <b style={{ color: T.ink }}>{fmtWhole(lc.total)}</b> &middot; {fmtWeekLong(lc.endSunday)} <StatusPill complete />
              </div>
              {comparisons}
            </>
          ) : (
            <div style={{ fontSize: 12.5, color: T.ink3 }}>No complete week yet.</div>
          )}
        </div>
      </Card>
    );
  }
  return (
    <Card>
      <QuestionHead>How was giving this week?</QuestionHead>
      <BigMoney>{fmtWhole(lc.total)}</BigMoney>
      <div style={{ fontSize: 12.5, color: T.ink3, margin: "3px 0 8px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span>{fmtWeekLong(lc.endSunday)} &middot; {fundLabel}</span>
        <StatusPill complete />
      </div>
      {comparisons}
    </Card>
  );
}

/* ── Block B: Are we ahead of last year? (absorbs the Financial Snapshot) ── */
function FyBlock({ fyTrend, rawGifts, offertoryFund, now }) {
  // Bulletin month math — verbatim v1 Financial Snapshot semantics
  const lastMonth = now.getMonth() === 0
    ? new Date(now.getFullYear() - 1, 11, 1)
    : new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonth = lastMonth.getMonth() === 0
    ? new Date(lastMonth.getFullYear() - 1, 11, 1)
    : new Date(lastMonth.getFullYear(), lastMonth.getMonth() - 1, 1);
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
  const diffSign = (v) => v >= 0 ? "+" : "";

  function copyForBulletin() {
    // Byte-for-byte v1 payload (colors/format unchanged so the bulletin
    // rendering never shifts between dashboard versions).
    const fmtFull = fmtCents;
    const mn = monthName(lastMonth);
    const pm = monthName(prevMonth);
    const lym = monthName(lastYearMonth);
    const mDiffStr = `${diffSign(monthDiff)}${fmtFull(Math.abs(monthDiff))}`;
    const yDiffStr = lastYearTotal > 0
      ? `${diffSign(yearDiff)}${fmtFull(Math.abs(yearDiff))} (${diffSign(yearDiff)}${((yearDiff / lastYearTotal) * 100).toFixed(1)}%)`
      : "N/A";
    const mDiffColor = monthDiff >= 0 ? "#00843D" : "#c0392b";
    const yDiffColor = yearDiff >= 0 ? "#00843D" : "#c0392b";

    const html = `<table style="border-collapse:collapse;font-family:'Noto Sans',Calibri,Arial,sans-serif;font-size:11pt;width:auto;max-width:360px;">
  <tr><td colspan="2" style="font-weight:bold;font-size:12pt;color:#005921;padding:4px 8px 6px 8px;border-bottom:2px solid #00843D;">Offertory Collections — ${mn}</td></tr>
  <tr><td style="padding:3px 8px;color:#333;">${mn}</td><td style="padding:3px 8px;text-align:right;font-weight:bold;color:#005921;">${fmtFull(lastMonthTotal)}</td></tr>
  <tr><td style="padding:3px 8px;color:#333;">${pm}</td><td style="padding:3px 8px;text-align:right;font-weight:bold;color:#005921;">${fmtFull(prevMonthTotal)}</td></tr>
  <tr><td style="padding:3px 8px;color:#666;">${lym} <span style="color:#999;">(prior yr)</span></td><td style="padding:3px 8px;text-align:right;font-weight:bold;color:#005921;">${lastYearTotal > 0 ? fmtFull(lastYearTotal) : "N/A"}</td></tr>
  <tr><td colspan="2" style="padding:2px 0;border-bottom:1px solid #ddd;"></td></tr>
  <tr><td style="padding:3px 8px;color:#333;">Month-to-month</td><td style="padding:3px 8px;text-align:right;font-weight:bold;color:${mDiffColor};">${mDiffStr}</td></tr>
  <tr><td style="padding:3px 8px;color:#333;">Year-over-year</td><td style="padding:3px 8px;text-align:right;font-weight:bold;color:${yDiffColor};">${yDiffStr}</td></tr>
</table>`;

    const blob = new Blob([html], { type: "text/html" });
    const plainRows = [
      `Offertory Collections — ${mn}`,
      `${mn}\t${fmtFull(lastMonthTotal)}`,
      `${pm}\t${fmtFull(prevMonthTotal)}`,
      `${lym} (prior yr)\t${lastYearTotal > 0 ? fmtFull(lastYearTotal) : "N/A"}`,
      ``,
      `Month-to-month\t${mDiffStr}`,
      `Year-over-year\t${yDiffStr}`,
    ].join("\n");
    const textBlob = new Blob([plainRows], { type: "text/plain" });

    navigator.clipboard.write([
      new ClipboardItem({ "text/html": blob, "text/plain": textBlob })
    ]).then(() => {
      const btn = document.getElementById("v2-copy-snapshot-btn");
      if (btn) { btn.textContent = "Copied!"; setTimeout(() => { btn.textContent = "Copy for Bulletin"; }, 2000); }
    });
  }

  const fyLabel = getFYLabel(now);
  const lastCompletedFyIdx = ((now.getMonth() + 6) % 12) - 1;
  const throughLabel = lastCompletedFyIdx >= 0 ? FY_MONTH_LABELS[lastCompletedFyIdx] : null;

  return (
    <Card>
      <QuestionHead>Are we ahead of last year?</QuestionHead>
      {fyTrend && fyTrend.kind === "pct" ? (
        <>
          <BigMoney>{fmtWhole(fyTrend.current)}</BigMoney>
          <div style={{ fontSize: 12.5, color: T.ink3, margin: "3px 0 8px", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span>{fyLabel} to date &middot; Offertory</span>
            {throughLabel && (
              <ScopePill title="Completed months only: the month in progress is left out of both years so the comparison covers the same window.">
                through {throughLabel} &middot; completed months
              </ScopePill>
            )}
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <Delta value={fyTrend.current - fyTrend.prior} pct={fyTrend.pct} window="vs last FY, same window" />
            <span style={{ fontSize: 13, color: T.ink3 }}>
              Last year at this point: <span style={{ fontFamily: T.serif, color: T.greenDark }}>{fmtWhole(fyTrend.prior)}</span>
            </span>
          </div>
        </>
      ) : fyTrend && fyTrend.kind === "new" ? (
        <>
          <BigMoney>{fmtWhole(fyTrend.current)}</BigMoney>
          <div style={{ marginTop: 6 }}><ScopePill>New this FY &mdash; no prior-year window</ScopePill></div>
        </>
      ) : (
        <div style={{ color: T.ink3, fontSize: 14 }}>
          The fiscal year just started; the first completed month arrives in August.
        </div>
      )}

      <div style={{ borderTop: `1px solid ${T.hairline}`, marginTop: 12, paddingTop: 9, fontSize: 13 }}>
        {[
          [monthName(lastMonth), lastMonthTotal, null],
          [monthName(prevMonth), prevMonthTotal, null],
          [`${monthName(lastYearMonth)} (prior yr)`, lastYearTotal, "muted"],
        ].map(([label, val, m]) => (
          <div key={label} style={{ display: "flex", justifyContent: "space-between", padding: "2.5px 0", color: m ? T.ink3 : T.ink2 }}>
            <span>{label}</span>
            <span style={{ fontFamily: T.serif, color: T.greenDark, fontVariantNumeric: "tabular-nums" }}>
              {val > 0 ? fmtCents(val) : "—"}
            </span>
          </div>
        ))}
        <button
          id="v2-copy-snapshot-btn"
          onClick={copyForBulletin}
          style={{
            marginTop: 8, background: T.green, color: "#fff", fontSize: 12.5,
            fontWeight: 700, border: "none", borderRadius: 6, padding: "7px 13px",
            cursor: "pointer", fontFamily: T.sans,
          }}
        >Copy for Bulletin</button>
      </div>
    </Card>
  );
}

/* ── Block C: Which funds moved? ── */
function MoversBlock({ movers, windowLabel }) {
  return (
    <Card>
      <QuestionHead>Which funds moved?</QuestionHead>
      {movers.length === 0 ? (
        <div style={{ color: T.ink3, fontSize: 14 }}>No fund moved meaningfully in this window yet.</div>
      ) : (
        <div>
          {movers.map(m => (
            <div key={m.fund} style={{
              display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline",
              padding: "5.5px 0", borderBottom: `1px solid #f1f5f2`, fontSize: 13.5,
            }}>
              <span style={{ color: T.ink, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{m.fund}</span>
              {m.kind === "new"
                ? <ScopePill>New &middot; {fmtWhole(m.delta)}</ScopePill>
                : <Delta value={m.delta} pct={null} />}
            </div>
          ))}
          <div style={{ fontSize: 12, color: T.ink3, marginTop: 7 }}>{windowLabel}</div>
        </div>
      )}
    </Card>
  );
}

export default function AnswerBand({ weeklyModel, weeklyFundLabel, fyTrend, movers, moversWindowLabel, rawGifts, offertoryFund, now }) {
  return (
    <div style={{
      display: "grid", gap: 12, marginBottom: 14,
      gridTemplateColumns: "repeat(auto-fit, minmax(270px, 1fr))",
    }}>
      <WeekBlock weeklyModel={weeklyModel} fundLabel={weeklyFundLabel} now={now} />
      {offertoryFund
        ? <FyBlock fyTrend={fyTrend} rawGifts={rawGifts} offertoryFund={offertoryFund} now={now} />
        : (
          <Card>
            <QuestionHead>Are we ahead of last year?</QuestionHead>
            <div style={{ color: T.ink3, fontSize: 14 }}>No Offertory fund found in this report.</div>
          </Card>
        )}
      <MoversBlock movers={movers} windowLabel={moversWindowLabel} />
    </div>
  );
}
