import { T } from "./theme.jsx";

// Two separate freshness signals: the fetch timestamp (always true) and a
// completeness dot (amber Mon-Tue: Sunday collections usually post Mon-Tue,
// so the newest week may still grow; green Wed onward, matching lib.js
// isWeekComplete which flips weeks complete at Wednesday 00:00). On Monday
// the timestamp is true and the data still is not — hence two signals.
function completenessState(now) {
  const day = now.getDay(); // 0 Sun .. 6 Sat
  const amber = day >= 1 && day <= 2;
  return {
    color: amber ? T.gold : T.green,
    label: amber
      ? "Sunday collections usually post Mon-Tue; the newest week may still grow."
      : "All recent weeks should be fully posted.",
  };
}

export default function Masthead({ authUser, fileName, giftCount, fundCount, dataLoadedAt, dataTimeKnown, now }) {
  const comp = completenessState(now);
  const timeStr = dataLoadedAt && dataTimeKnown
    ? `, ${dataLoadedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
    : "";
  const dateStr = dataLoadedAt
    ? dataLoadedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      paddingBottom: 14, borderBottom: `2px solid ${T.green}22`, marginBottom: 16,
    }}>
      <div style={{
        width: 40, height: 40, borderRadius: "50%", background: T.green,
        color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: T.serif, fontSize: 19, flexShrink: 0,
      }}>&#10013;</div>
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: T.serif, fontSize: 22, color: T.greenDark, fontWeight: 700, lineHeight: 1.1 }}>
            St. Edward Giving
          </span>
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase",
            background: T.blue, color: "#fff", borderRadius: 4, padding: "2px 7px",
          }}>v2 preview</span>
        </div>
        <div style={{ fontSize: 13, color: T.ink2, marginTop: 2, display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
          {dataLoadedAt && (
            <span><b style={{ color: T.ink }}>Updated {dateStr}{timeStr}</b></span>
          )}
          <span title={comp.label} style={{ display: "inline-flex", alignItems: "center", gap: 5, cursor: "help" }}>
            <span style={{
              width: 9, height: 9, borderRadius: "50%", background: comp.color,
              boxShadow: `0 0 0 3px ${comp.color}22`, display: "inline-block",
            }} />
            <span>{comp.color === T.gold ? "newest week still posting" : "weeks fully posted"}</span>
          </span>
          {fileName && <span>&middot; {fileName}</span>}
          {giftCount > 0 && <span>&middot; {giftCount.toLocaleString()} gifts &middot; {fundCount} funds</span>}
        </div>
      </div>
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, fontSize: 13, color: T.ink2 }}>
        {authUser && (
          <span>{authUser.name} &middot; <a href="/auth/logout" style={{ color: T.green, fontWeight: 600, textDecoration: "none" }}>Sign out</a></span>
        )}
        <a href="/" style={{
          padding: "6px 13px", background: T.card, border: `1px solid ${T.hairline}`,
          borderRadius: 6, color: T.greenDark, fontWeight: 600, textDecoration: "none",
        }}>Classic view</a>
      </div>
    </div>
  );
}
