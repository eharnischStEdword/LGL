// v2 visual language. One meaning per channel:
//   gold        = "in progress / careful" (never a fund color, never a verdict)
//   green/red   = direction of a delta, nothing else
//   SE blue     = the All Funds (Total) identity, everywhere
//   series slots = fund identity on chart marks only (4 validated steps + gray)
// Type: Georgia for headline money and section titles, Trebuchet for UI.
// Whole dollars at card altitude; cents only in tables, tooltips, bulletin.

export const T = {
  page: "#EEF4F1",
  card: "#ffffff",
  ink: "#22302a",
  ink2: "#5a6b60",
  ink3: "#8a978e",
  hairline: "#dde6e0",
  green: "#00843D",
  greenDark: "#005921",
  gold: "#DAAA00",
  goldLight: "#DDCC71",
  goldInk: "#7a6206",
  blue: "#003764",
  red: "#B23A2F",
  serif: "'Georgia', 'Cambria', serif",
  sans: "'Trebuchet MS', 'Calibri', sans-serif",
};

// Chart series palette — brand-derived steps validated for colorblind
// separation and 3:1 contrast on the off-white surface (green kept exact;
// blue/gold shifted to chart-legible steps; see docs/v2-proposal.html §6).
export const SERIES_PALETTE = ["#00843D", "#2A6FB0", "#B8860B", "#B23A2F"];
export const SERIES_OVERFLOW = ["#6b7770", "#8f9a92", "#4d5a52", "#a5b0a8"]; // 5th+ funds: grays
export const ALL_FUNDS_KEY = "All Funds (Total)";

export function Card({ style, children }) {
  return (
    <div style={{
      background: T.card, border: `1px solid ${T.hairline}`, borderRadius: 10,
      padding: "16px 18px", boxShadow: "0 1px 3px rgba(0,89,33,0.05)", ...style
    }}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 10, flexWrap: "wrap" }}>
      <span style={{ fontFamily: T.serif, fontSize: 18, color: T.greenDark }}>{children}</span>
      {right && <span style={{ marginLeft: "auto", fontSize: 13, color: T.ink3 }}>{right}</span>}
    </div>
  );
}

// Scope pill: gold = "read carefully" (clipped window, in progress)
export function ScopePill({ children, title }) {
  return (
    <span title={title} style={{
      display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 999,
      padding: "2px 9px", background: "#faf3d8", color: T.goldInk,
      border: `1px solid ${T.goldLight}`, verticalAlign: "middle", whiteSpace: "nowrap",
      cursor: title ? "help" : "default", fontFamily: T.sans,
    }}>{children}</span>
  );
}

export function StatusPill({ complete }) {
  return complete ? (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 999,
      padding: "2px 9px", background: "#e3f2e9", color: T.greenDark, fontFamily: T.sans,
    }}>✓ Complete</span>
  ) : (
    <span style={{
      display: "inline-block", fontSize: 11, fontWeight: 700, borderRadius: 999,
      padding: "2px 9px", background: "#faf3d8", color: T.goldInk,
      border: `1px dashed ${T.gold}`, fontFamily: T.sans,
    }}>Counting</span>
  );
}

// The one delta grammar: arrow + percent + dollars + explicit window.
// `pct` may be null (dollars only). Green/red mean direction, nothing else.
export function Delta({ value, pct, window: win, size = 13.5 }) {
  const up = value >= 0;
  const color = up ? T.green : T.red;
  const arrow = up ? "▲" : "▼";
  const sign = up ? "+" : "-";
  const dollars = `${sign}$${Math.abs(Math.round(value)).toLocaleString("en-US")}`;
  const pctStr = pct == null ? "" : ` (${sign}${Math.abs(pct).toFixed(1)}%)`;
  return (
    <span style={{ fontSize: size, fontFamily: T.sans }}>
      <span style={{ color, fontWeight: 700 }}>{arrow} {dollars}{pctStr}</span>
      {win && <span style={{ color: T.ink3 }}> {win}</span>}
    </span>
  );
}

export function InfoTip({ text }) {
  return (
    <span title={text} style={{
      display: "inline-block", width: 15, height: 15, borderRadius: "50%",
      border: `1px solid ${T.ink3}`, color: T.ink3, fontSize: 10, textAlign: "center",
      lineHeight: "14px", fontFamily: T.serif, fontStyle: "italic",
      verticalAlign: "1px", cursor: "help", marginLeft: 6,
    }}>i</span>
  );
}

// Labeled segmented control — the ONE control style for period/view choices.
export function Segmented({ label, options, value, onChange }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      {label && <span style={{
        fontSize: 11, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: T.ink3, fontFamily: T.sans,
      }}>{label}</span>}
      <div style={{ display: "flex", background: "#e8efe9", borderRadius: 7, padding: 2 }}>
        {options.map(o => (
          <button
            key={o.key}
            onClick={() => onChange(o.key)}
            style={{
              padding: "6px 13px", borderRadius: 5, border: "none",
              background: value === o.key ? T.card : "transparent",
              color: value === o.key ? T.greenDark : T.ink2,
              fontSize: 13, fontWeight: value === o.key ? 700 : 500,
              cursor: "pointer", fontFamily: T.sans, whiteSpace: "nowrap",
              boxShadow: value === o.key ? "0 1px 3px rgba(0,0,0,0.12)" : "none",
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Tiny corner toggle (Line/Bar, Log) — quieter than the segmented control.
export function MiniToggle({ active, onClick, children, title }) {
  return (
    <button onClick={onClick} title={title} style={{
      padding: "4px 10px", borderRadius: 5,
      border: `1px solid ${active ? T.greenDark : T.hairline}`,
      background: active ? `${T.green}12` : T.card,
      color: active ? T.greenDark : T.ink3,
      fontSize: 12, fontWeight: active ? 700 : 500, cursor: "pointer", fontFamily: T.sans,
    }}>{children}</button>
  );
}
