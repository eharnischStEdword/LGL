import { useEffect, useMemo, useState } from "react";
import { T } from "./theme.jsx";

// First-visit walkthrough. No library, no mask: each step scrolls its target
// into view and puts a gold glow on it, with one fixed card at the bottom of
// the screen carrying the words. Targets are looked up by [data-tour] ids so
// the tour survives the user's saved section order. Runs once per browser
// (sev2.tourSeen, set the moment it auto-starts); the masthead's "Show me
// around" replays it anytime.

export const TOUR_SEEN_KEY = "sev2.tourSeen";

const STEPS = [
  {
    target: null,
    title: "Welcome to the new giving dashboard",
    body: "One page, newest news first. This quick tour points out five things and takes under a minute.",
  },
  {
    target: "freshness",
    title: "How fresh is this data?",
    body: "The dot stays gold while Sunday's cash and checks are still being counted, and turns green once the count is in. Online gifts arrive on their own all week.",
  },
  {
    target: "answers",
    title: "The Monday answers",
    body: "How the week went, whether we are ahead of last year, and which funds moved. Copy for Bulletin lives here too.",
  },
  {
    target: "weeks",
    title: "The last eight weeks",
    body: "One bar per week, labeled by its Sunday. A striped bar means the count has not landed yet, so a low number early in the week is normal, not bad news.",
  },
  {
    target: "chart",
    title: "The chart, comparisons, and table",
    body: "Change the time period here, or switch the view to compare years and see the table. The dashed straight line is the trend.",
  },
  {
    target: "customize",
    title: "Make it yours",
    body: "If the page feels like too much, Customize layout lets you drag the sections into your own order, chart on top if you like. Your order saves on this computer and changes nothing for anyone else.",
  },
];

function findTarget(id) {
  return id ? document.querySelector(`[data-tour="${id}"]`) : null;
}

export default function Tour({ open, onClose }) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];

  // Reset to the first step each time the tour opens
  useEffect(() => { if (open) setStep(0); }, [open]);

  // Scroll to and glow the current step's target; restore on leave.
  useEffect(() => {
    if (!open) return undefined;
    const el = findTarget(current.target);
    if (!el) return undefined;
    const prev = {
      outline: el.style.outline,
      outlineOffset: el.style.outlineOffset,
      borderRadius: el.style.borderRadius,
      transition: el.style.transition,
    };
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    el.style.transition = "outline-color 0.25s";
    el.style.outline = `3px solid ${T.gold}`;
    el.style.outlineOffset = "5px";
    if (!prev.borderRadius) el.style.borderRadius = "8px";
    return () => {
      el.style.outline = prev.outline;
      el.style.outlineOffset = prev.outlineOffset;
      el.style.borderRadius = prev.borderRadius;
      el.style.transition = prev.transition;
    };
  }, [open, step, current.target]);

  // Esc closes
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const last = step === STEPS.length - 1;
  const btn = useMemo(() => ({
    base: {
      fontFamily: T.sans, fontSize: 13.5, fontWeight: 700, borderRadius: 7,
      padding: "8px 16px", cursor: "pointer",
    },
  }), []);

  if (!open) return null;

  return (
    <div style={{
      position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)",
      zIndex: 1000, width: "min(460px, calc(100vw - 32px))",
      background: T.card, border: `1px solid ${T.hairline}`, borderTop: `4px solid ${T.gold}`,
      borderRadius: 12, boxShadow: "0 12px 40px rgba(0,40,20,0.25)",
      padding: "16px 18px 14px", fontFamily: T.sans,
    }}>
      <div style={{ fontFamily: T.serif, fontSize: 17, color: T.greenDark, marginBottom: 5 }}>
        {current.title}
      </div>
      <div style={{ fontSize: 14, color: T.ink, lineHeight: 1.5, marginBottom: 12 }}>
        {current.body}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ display: "flex", gap: 5 }}>
          {STEPS.map((s, i) => (
            <span key={i} style={{
              width: 7, height: 7, borderRadius: "50%",
              background: i === step ? T.green : "#d3ddd6",
            }} />
          ))}
        </span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          {!last && (
            <button onClick={onClose} style={{
              ...btn.base, background: "none", border: "none", color: T.ink3, fontWeight: 600,
            }}>Skip</button>
          )}
          {step > 0 && (
            <button onClick={() => setStep(s => s - 1)} style={{
              ...btn.base, background: T.card, border: `1px solid ${T.hairline}`, color: T.greenDark,
            }}>Back</button>
          )}
          <button
            onClick={() => (last ? onClose() : setStep(s => s + 1))}
            style={{ ...btn.base, background: T.green, border: "none", color: "#fff" }}
          >{last ? "Done" : "Next"}</button>
        </span>
      </div>
    </div>
  );
}
