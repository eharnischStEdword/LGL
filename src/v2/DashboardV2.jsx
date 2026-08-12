import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { T, Card, ALL_FUNDS_KEY, SERIES_PALETTE, SERIES_OVERFLOW } from "./theme.jsx";
import {
  parseSpreadsheet, parseDateFlexible, parseAmount, detectColumns,
  DATA_FLOOR, buildGiftIndex, computeFundTrends, buildWeeklyModel,
  fyPaceThroughWeek, getFYLabel, fmtCents, FY_MONTH_LABELS,
  startOfDay, addDays, weekEndingSunday, weekKey,
} from "./lib.js";
import Masthead from "./Masthead.jsx";
import AnswerBand from "./AnswerBand.jsx";
import RecentWeeks, { WEEKLY_ALL } from "./RecentWeeks.jsx";
import EvidenceSection, { monthBucketsForPeriod } from "./EvidenceSection.jsx";
import FundLedger from "./FundLedger.jsx";
import Tour, { TOUR_SEEN_KEY } from "./Tour.jsx";

// v2: one scrolling page in meeting order — answers, evidence, controls on
// demand. Data auto-loads on arrival: the All Funds report plus the API
// top-up on the union axis (see server.js fetchLGLApiGifts); if the big
// report fails, we fall back to the Offertory hybrid endpoint with a plain
// banner. All math comes from src/v2/lib.js, which mirrors v1 verbatim.

// Stable fund colors: a fund keeps its slot for as long as it stays selected;
// adding or removing other funds never repaints it. 5th+ funds get grays.
function useFundColors(selectedFunds) {
  const mapRef = useRef(new Map());
  return useMemo(() => {
    const slots = [...SERIES_PALETTE, ...SERIES_OVERFLOW];
    const map = mapRef.current;
    for (const f of [...map.keys()]) if (!selectedFunds.has(f)) map.delete(f);
    for (const f of selectedFunds) {
      if (!map.has(f)) {
        const used = new Set(map.values());
        // Past the 8 named slots, a golden-angle hue keeps every extra fund
        // distinct instead of silently repeating the palette.
        map.set(f, slots.find(c => !used.has(c)) || `hsl(${Math.round((map.size * 137.5) % 360)} 38% 44%)`);
      }
    }
    const obj = Object.fromEntries(map);
    obj[ALL_FUNDS_KEY] = T.blue;
    return obj;
  }, [selectedFunds]);
}

// ── Per-user saved layout (Robin, 2026-08-12: "too much up top", wants the
// chart first). The five content sections can be reordered by drag or arrow
// buttons; the order persists in this browser's localStorage, so each staff
// member keeps their own arrangement without changing anyone else's. Sections
// added in future versions append at the end of a saved order.
const SECTIONS = [
  { id: "answers", label: "Monday answers" },
  { id: "weeks", label: "Recent weeks" },
  { id: "chart", label: "Chart, compare & table" },
  { id: "funds", label: "Fund list" },
  { id: "calc", label: "Net income calculator" },
];
const LAYOUT_KEY = "sev2.layoutOrder";

function loadSavedOrder() {
  const known = SECTIONS.map(s => s.id);
  try {
    const saved = JSON.parse(localStorage.getItem(LAYOUT_KEY) || "[]");
    const valid = (Array.isArray(saved) ? saved : []).filter(id => known.includes(id));
    for (const id of known) if (!valid.includes(id)) valid.push(id);
    return valid;
  } catch {
    return known;
  }
}

function SectionShell({ id, label, index, count, arranging, onMove, onDragStart, onDragEnter, onDragEnd, children }) {
  // The data-tour wrapper is always present so the first-visit tour can find
  // each section regardless of the user's saved order.
  if (!arranging) return <div data-tour={id}>{children}</div>;
  const arrowBtn = {
    border: `1px solid ${T.hairline}`, background: T.card, borderRadius: 5,
    color: T.greenDark, fontSize: 13, fontWeight: 700, cursor: "pointer",
    padding: "2px 9px", fontFamily: T.sans, lineHeight: 1.4,
  };
  return (
    <div
      draggable
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={e => e.preventDefault()}
      onDragEnd={onDragEnd}
      style={{
        border: `2px dashed ${T.green}55`, borderRadius: 12, marginBottom: 14,
        background: `${T.green}06`, cursor: "grab",
      }}
    >
      <div style={{
        display: "flex", alignItems: "center", gap: 10, padding: "8px 14px",
        borderBottom: `1px dashed ${T.green}30`, fontFamily: T.sans,
      }}>
        <span aria-hidden style={{ color: T.ink3, fontSize: 15, letterSpacing: 2 }}>⠿</span>
        <span style={{ fontWeight: 700, color: T.greenDark, fontSize: 14 }}>{label}</span>
        <span style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={{ ...arrowBtn, opacity: index === 0 ? 0.35 : 1 }} disabled={index === 0}
            onClick={() => onMove(-1)} title="Move up">▲</button>
          <button style={{ ...arrowBtn, opacity: index === count - 1 ? 0.35 : 1 }} disabled={index === count - 1}
            onClick={() => onMove(1)} title="Move down">▼</button>
        </span>
      </div>
      {/* Content is inert while arranging so a drag never clicks a control */}
      <div style={{ pointerEvents: "none", opacity: 0.92, padding: "10px 10px 0" }}>
        {children}
      </div>
    </div>
  );
}

// Normalize any date value to YYYY-MM-DD for dedup (v1 semantics)
function normDate(val) {
  if (!val) return "";
  const num = typeof val === "number" ? val : parseFloat(val);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    const d = new Date(1899, 11, 30 + Math.round(num));
    if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(val).trim();
}

export default function DashboardV2() {
  const [rawGifts, setRawGifts] = useState([]);
  const [funds, setFunds] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(null);
  const [banner, setBanner] = useState(null);
  const [fileName, setFileName] = useState(null);
  const [offertoryOnly, setOffertoryOnly] = useState(false);
  const [dataLoadedAt, setDataLoadedAt] = useState(null);
  const [dataTimeKnown, setDataTimeKnown] = useState(false);
  const [importDate, setImportDate] = useState(null); // date of the bulk LGL report file
  const [plateStatus, setPlateStatus] = useState(null); // evidence: has the week's count been entered?
  const [authUser, setAuthUser] = useState(null);

  const [selectedFunds, setSelectedFunds] = useState(new Set());
  const [showAllFundsTotal, setShowAllFundsTotal] = useState(true);
  const [weeklyFund, setWeeklyFund] = useState(WEEKLY_ALL);
  // Parish staff think fiscally, so This FY is the home period — but in the
  // first months of a fiscal year a 1-2 point chart reads as a cliff, so the
  // landing period is Last 12 months until the FY has 3 completed months.
  const [period, setPeriod] = useState(() => {
    const m = new Date().getMonth(); // FY months elapsed: Jul=0 ... Jun=11
    const elapsed = m >= 6 ? m - 6 : m + 6;
    return elapsed >= 3 ? "fy" : "last12";
  });
  const [view, setView] = useState("trend");
  const [chartType, setChartType] = useState("line");
  const [useLogScale, setUseLogScale] = useState(false);
  const [basis, setBasis] = useState("fiscal");
  const [tableMode, setTableMode] = useState("fy");
  const [ledgerOpen, setLedgerOpen] = useState(false);
  const ledgerRef = useRef(null);

  const [sectionOrder, setSectionOrder] = useState(loadSavedOrder);
  const [arranging, setArranging] = useState(false);
  const [tourOpen, setTourOpen] = useState(false);
  const dragIdx = useRef(null);
  const moveSection = useCallback((index, dir) => {
    setSectionOrder(prev => {
      const next = [...prev];
      const j = index + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[index], next[j]] = [next[j], next[index]];
      try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }, []);
  const resetOrder = useCallback(() => {
    try { localStorage.removeItem(LAYOUT_KEY); } catch { /* ignore */ }
    setSectionOrder(SECTIONS.map(s => s.id));
  }, []);

  const now = useMemo(() => new Date(), []);

  useEffect(() => {
    fetch("/auth/status")
      .then(r => r.json())
      .then(data => { if (data.authenticated) setAuthUser(data.user); })
      .catch(() => {});
  }, []);

  const processRows = useCallback((rows, label, offertoryOnly) => {
    if (!rows || rows.length === 0) throw new Error("The report came back empty.");
    const cols = detectColumns(Object.keys(rows[0]));
    if (!cols.dateCol || !cols.amountCol || !cols.fundCol) {
      throw new Error(`Could not detect report columns (found date="${cols.dateCol}", amount="${cols.amountCol}", fund="${cols.fundCol}").`);
    }
    const gifts = [];
    const fundSet = new Set();
    for (const row of rows) {
      const date = parseDateFlexible(row[cols.dateCol]);
      const amount = parseAmount(row[cols.amountCol]);
      const fund = String(row[cols.fundCol] || "").trim();
      if (date && fund && date >= DATA_FLOOR) {
        gifts.push({ date, amount, fund });
        fundSet.add(fund);
      }
    }
    if (gifts.length === 0) throw new Error("No valid gift rows found in the report.");
    const sorted = [...fundSet].sort();
    const offertory = sorted.find(f => f.toLowerCase().includes("offertory"));
    setRawGifts(gifts);
    setFunds(sorted);
    setFileName(label);
    setSelectedFunds(new Set(offertory ? [offertory] : sorted.slice(0, 1)));
    setShowAllFundsTotal(!offertoryOnly);
    setOffertoryOnly(offertoryOnly);
    setWeeklyFund(offertory || WEEKLY_ALL);
    setLoaded(true);
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    setBanner(null);
    setLoaded(false);
    try {
      // Primary: the All Funds report + client-side union-axis top-up
      const resp = await fetch("/api/lgl-all-funds");
      // The auth gate skips /api paths, so an expired session surfaces here as
      // a 401 JSON body rather than a login redirect — send the user to sign in.
      if (resp.status === 401) { setLoadError("SESSION_EXPIRED"); return; }
      if (!resp.ok) throw new Error(`All Funds report: HTTP ${resp.status}`);
      const ct = resp.headers.get("content-type") || "";
      const reportDate = resp.headers.get("x-report-date");
      if (reportDate) {
        const [ry, rm, rd] = reportDate.split("-").map(Number);
        setImportDate(new Date(ry, rm - 1, rd));
      }
      const buf = await resp.arrayBuffer();
      const rows = parseSpreadsheet(buf, ct);
      let added = 0;
      let refreshedAt = null;
      if (reportDate && rows.length > 0) {
        try {
          const apiResp = await fetch(`/api/lgl-recent-gifts?since=${reportDate}&axis=union`);
          if (apiResp.ok) {
            const json = await apiResp.json();
            refreshedAt = json.refreshedAt || null;
            const gifts = json.gifts || [];
            if (gifts.length > 0) {
              const cols = detectColumns(Object.keys(rows[0]));
              if (cols.dateCol && cols.amountCol && cols.fundCol) {
                const seen = new Set();
                for (const row of rows) {
                  const d = normDate(row[cols.dateCol]);
                  const a = parseFloat(String(row[cols.amountCol] || "0").replace(/[$,]/g, "")) || 0;
                  const f = String(row[cols.fundCol] || "").trim().toLowerCase();
                  seen.add(`${d}|${a.toFixed(2)}|${f}`);
                }
                for (const g of gifts) {
                  const key = `${normDate(g.date)}|${Number(g.amount).toFixed(2)}|${(g.fund || "").toLowerCase()}`;
                  if (!seen.has(key)) {
                    const newRow = {};
                    newRow[cols.dateCol] = g.date;
                    newRow[cols.amountCol] = g.amount;
                    newRow[cols.fundCol] = g.fund;
                    rows.push(newRow);
                    seen.add(key);
                    added++;
                  }
                }
              }
            }
          }
        } catch {
          // top-up failure is non-fatal; the report alone still loads
        }
      }
      if (refreshedAt) { setDataLoadedAt(new Date(refreshedAt)); setDataTimeKnown(true); }
      else if (reportDate) {
        const [y, m, d] = reportDate.split("-").map(Number);
        setDataLoadedAt(new Date(y, m - 1, d));
        setDataTimeKnown(false);
      } else { setDataLoadedAt(new Date()); setDataTimeKnown(true); }
      processRows(rows, `All Funds report${added ? ` +${added} recent` : ""}`, false);
    } catch (primaryErr) {
      // Fallback: Offertory hybrid (server-side merge), with a plain banner
      try {
        const resp = await fetch("/api/lgl-data-hybrid?axis=union");
        if (resp.status === 401) { setLoadError("SESSION_EXPIRED"); return; }
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const json = await resp.json();
        if (json.reportDate) {
          const [ry, rm, rd] = json.reportDate.split("-").map(Number);
          setImportDate(new Date(ry, rm - 1, rd));
        }
        if (json.refreshedAt) { setDataLoadedAt(new Date(json.refreshedAt)); setDataTimeKnown(true); }
        processRows(json.rows, `Offertory only${json.apiGiftsAdded ? ` +${json.apiGiftsAdded} recent` : ""}`, true);
        setBanner(`The All Funds report failed to load (${primaryErr.message}), so this is Offertory only. Fund-level views are limited until it recovers.`);
      } catch (fallbackErr) {
        setLoadError(`Could not load giving data. All Funds: ${primaryErr.message}. Offertory fallback: ${fallbackErr.message}.`);
      }
    }
  }, [processRows]);

  useEffect(() => { load(); }, [load]);

  // First visit in this browser: start the walkthrough once the page has real
  // content. Seen is stamped at start so a mid-tour reload never re-traps;
  // "Show me around" in the masthead replays it anytime.
  useEffect(() => {
    if (!loaded) return undefined;
    let seen = null;
    try { seen = localStorage.getItem(TOUR_SEEN_KEY); } catch { seen = "1"; }
    if (seen) return undefined;
    const t = setTimeout(() => {
      try { localStorage.setItem(TOUR_SEEN_KEY, "1"); } catch { /* ignore */ }
      setTourOpen(true);
    }, 700);
    return () => clearTimeout(t);
  }, [loaded]);

  // Evidence check: has the newest ended week's cash/check count actually been
  // entered in LGL? The Mon/Thu import schedule is a plan, not a guarantee, so
  // the weekly model prefers this over the calendar when it can tell.
  useEffect(() => {
    const upcoming = weekEndingSunday(now);
    const lastEnded = upcoming.getTime() <= startOfDay(now).getTime() ? upcoming : addDays(upcoming, -7);
    fetch(`/api/lgl-plate-status?week=${weekKey(lastEnded)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => { if (j) setPlateStatus(j); })
      .catch(() => {}); // no evidence — the calendar rule stands
  }, [now]);

  const toggleFund = useCallback((fund) => {
    setSelectedFunds(prev => {
      const next = new Set(prev);
      if (next.has(fund)) next.delete(fund);
      else next.add(fund);
      return next;
    });
  }, []);

  const giftIndex = useMemo(() => buildGiftIndex(rawGifts), [rawGifts]);
  const fundColorMap = useFundColors(selectedFunds);

  const offertoryFund = useMemo(
    () => funds.find(f => f.toLowerCase().includes("offertory")) || null,
    [funds]
  );

  const weeklyModel = useMemo(
    () => (loaded ? buildWeeklyModel(rawGifts, weeklyFund === WEEKLY_ALL ? null : weeklyFund, now, 8, plateStatus) : null),
    [rawGifts, weeklyFund, now, loaded, plateStatus]
  );

  const fyPace = useMemo(
    () => (weeklyModel?.lastComplete
      ? fyPaceThroughWeek(rawGifts, weeklyFund === WEEKLY_ALL ? null : weeklyFund, weeklyModel.lastComplete.endSunday, now, weeklyModel.minLiveDate)
      : null),
    [rawGifts, weeklyFund, weeklyModel, now]
  );

  const fyTrends = useMemo(
    () => (loaded ? computeFundTrends(giftIndex, funds, "fy", now) : { map: {}, label: "" }),
    [giftIndex, funds, now, loaded]
  );

  const movers = useMemo(() => {
    const out = [];
    for (const [fund, t] of Object.entries(fyTrends.map)) {
      if (fund === offertoryFund) continue; // Offertory has its own two blocks
      if (t.kind === "pct") out.push({ fund, kind: "pct", delta: t.current - t.prior });
      else if (t.kind === "new") out.push({ fund, kind: "new", delta: t.current });
    }
    return out
      .filter(m => Math.abs(m.delta) >= 1)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 3);
  }, [fyTrends, offertoryFund]);

  const lastCompletedFyIdx = ((now.getMonth() + 6) % 12) - 1;
  const moversWindow = lastCompletedFyIdx >= 0
    ? `vs last FY, through ${FY_MONTH_LABELS[lastCompletedFyIdx]}`
    : "vs last FY";

  const monthBuckets = useMemo(() => monthBucketsForPeriod(period, now), [period, now]);
  const periodLabel = { fy: getFYLabel(now), last12: "last 12 months", ytd: `calendar ${now.getFullYear()} YTD`, all: "since Jul 2019" }[period];

  const openLedger = useCallback(() => {
    setLedgerOpen(true);
    setTimeout(() => ledgerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, []);

  const weeklyFundLabel = weeklyFund === WEEKLY_ALL ? "All Funds" : weeklyFund;

  if (loadError === "SESSION_EXPIRED") {
    return (
      <Shell>
        <Card style={{ maxWidth: 620, margin: "80px auto", textAlign: "center" }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, color: T.greenDark, marginBottom: 8 }}>Your session has expired</div>
          <div style={{ fontSize: 14, color: T.ink2, marginBottom: 14 }}>Sign in again to reload the giving data.</div>
          <a href="/auth/login" style={{
            display: "inline-block", background: T.green, color: "#fff", fontWeight: 700, fontSize: 14,
            borderRadius: 7, padding: "9px 22px", textDecoration: "none", fontFamily: T.sans,
          }}>Sign in again</a>
        </Card>
      </Shell>
    );
  }

  if (loadError) {
    return (
      <Shell>
        <Card style={{ maxWidth: 620, margin: "80px auto", textAlign: "center" }}>
          <div style={{ fontFamily: T.serif, fontSize: 19, color: T.greenDark, marginBottom: 8 }}>Could not load giving data</div>
          <div style={{ fontSize: 14, color: T.ink2, marginBottom: 14 }}>{loadError}</div>
          <button onClick={load} style={{
            background: T.green, color: "#fff", fontWeight: 700, fontSize: 14,
            border: "none", borderRadius: 7, padding: "9px 22px", cursor: "pointer", fontFamily: T.sans,
          }}>Try again</button>
        </Card>
      </Shell>
    );
  }

  if (!loaded) {
    return (
      <Shell>
        <div style={{ textAlign: "center", margin: "110px auto" }}>
          <div style={{
            width: 56, height: 56, borderRadius: "50%", background: T.green,
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 16px", color: "#fff", fontSize: 26, fontFamily: T.serif,
          }}>&#10013;</div>
          <div style={{ fontFamily: T.serif, fontSize: 20, color: T.greenDark }}>St. Edward Giving</div>
          <div style={{ fontSize: 14, color: T.ink2, marginTop: 6 }}>Loading the latest giving data&hellip;</div>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      <Masthead
        authUser={authUser} fileName={fileName}
        giftCount={rawGifts.length} fundCount={funds.length}
        dataLoadedAt={dataLoadedAt} dataTimeKnown={dataTimeKnown} importDate={importDate} plateStatus={plateStatus} now={now}
        onStartTour={() => setTourOpen(true)}
      />

      {banner && (
        <div style={{
          background: "#fbf6e2", border: `1px solid ${T.goldLight}`, borderRadius: 8,
          fontSize: 13.5, color: "#6d5a0a", padding: "10px 14px", marginBottom: 14,
        }}>{banner}</div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 10, margin: "-4px 0 10px", fontFamily: T.sans }}>
        {arranging ? (
          <>
            <span style={{ fontSize: 12.5, color: T.ink2 }}>
              Drag sections (or use the arrows) into the order you like. Your order saves on this computer.
            </span>
            <button onClick={resetOrder} style={{
              background: "none", border: `1px solid ${T.hairline}`, borderRadius: 6,
              color: T.ink2, fontSize: 12.5, fontWeight: 600, cursor: "pointer",
              padding: "5px 12px", fontFamily: T.sans,
            }}>Reset order</button>
            <button onClick={() => setArranging(false)} style={{
              background: T.green, border: "none", borderRadius: 6, color: "#fff",
              fontSize: 12.5, fontWeight: 700, cursor: "pointer", padding: "6px 14px", fontFamily: T.sans,
            }}>Done</button>
          </>
        ) : (
          <button data-tour="customize" onClick={() => setArranging(true)} style={{
            background: "none", border: "none", color: T.ink3, fontSize: 12.5,
            fontWeight: 600, cursor: "pointer", fontFamily: T.sans, padding: 0,
          }}>⠿ Customize layout</button>
        )}
      </div>

      {sectionOrder.map((id, i) => {
        const meta = SECTIONS.find(s => s.id === id);
        const nodes = {
          answers: (
            <AnswerBand
              weeklyModel={weeklyModel}
              weeklyFundLabel={weeklyFundLabel}
              fyTrend={offertoryFund ? fyTrends.map[offertoryFund] : null}
              movers={movers}
              moversWindowLabel={moversWindow}
              rawGifts={rawGifts}
              offertoryFund={offertoryFund}
              now={now}
            />
          ),
          weeks: (
            <RecentWeeks
              weeklyModel={weeklyModel}
              weeklyFund={weeklyFund}
              funds={funds}
              onFundChange={setWeeklyFund}
              fyPace={fyPace}
              now={now}
            />
          ),
          chart: (
            <EvidenceSection
              giftIndex={giftIndex}
              selectedFunds={selectedFunds}
              showAllFundsTotal={showAllFundsTotal}
              fundColorMap={fundColorMap}
              fundCount={funds.length}
              now={now}
              period={period} setPeriod={setPeriod}
              view={view} setView={setView}
              chartType={chartType} setChartType={setChartType}
              useLogScale={useLogScale} setUseLogScale={setUseLogScale}
              basis={basis} setBasis={setBasis}
              tableMode={tableMode} setTableMode={setTableMode}
              onOpenLedger={openLedger}
            />
          ),
          funds: (
            <FundLedger
              funds={funds}
              giftIndex={giftIndex}
              monthBuckets={monthBuckets}
              periodLabel={periodLabel}
              selectedFunds={selectedFunds}
              toggleFund={toggleFund}
              showAllFundsTotal={showAllFundsTotal}
              setShowAllFundsTotal={setShowAllFundsTotal}
              trendMap={fyTrends.map}
              isOffertoryOnly={offertoryOnly}
              open={ledgerOpen}
              setOpen={setLedgerOpen}
              ledgerRef={ledgerRef}
            />
          ),
          calc: <NetIncomeCalc />,
        };
        return (
          <SectionShell
            key={id}
            id={id}
            label={meta?.label || id}
            index={i}
            count={sectionOrder.length}
            arranging={arranging}
            onMove={(dir) => moveSection(i, dir)}
            onDragStart={(e) => { dragIdx.current = i; e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", id); } catch { /* older browsers */ } }}
            onDragEnter={() => {
              const from = dragIdx.current;
              if (from == null || from === i) return;
              setSectionOrder(prev => {
                const next = [...prev];
                const [moved] = next.splice(from, 1);
                next.splice(i, 0, moved);
                return next;
              });
              dragIdx.current = i;
            }}
            onDragEnd={() => {
              dragIdx.current = null;
              // Functional update so we always persist the final preview order,
              // never a stale closure from the render where the drag began.
              setSectionOrder(prev => {
                try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(prev)); } catch { /* ignore */ }
                return prev;
              });
            }}
          >
            {nodes[id]}
          </SectionShell>
        );
      })}

      <div style={{ margin: "18px 0 8px", fontSize: 12.5, color: T.ink3, textAlign: "center" }}>
        Gifts aggregated by calendar month per fund; weekly detail from live 2025+ data. Fiscal year begins July 1.
        Dashed straight lines show the trend over complete months.
      </div>

      <Tour open={tourOpen} onClose={() => setTourOpen(false)} />
    </Shell>
  );
}

function Shell({ children }) {
  // zoom scales every px size in the page uniformly (Eric 2026-08-11: v2 type
  // too small). Old Firefox ignores zoom and falls back to normal size.
  return (
    <div style={{ minHeight: "100vh", background: T.page, fontFamily: T.sans, color: T.ink, padding: "18px 22px" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", zoom: 1.15 }}>{children}</div>
    </div>
  );
}

// The manual FY revenue/expenses net-income calculator from the v1 Financial
// Snapshot, unchanged math, parked as a quiet utility (used about monthly).
function NetIncomeCalc() {
  const [rev, setRev] = useState("");
  const [exp, setExp] = useState("");
  const [calced, setCalced] = useState(false);
  const revN = parseAmount(rev);
  const expN = parseAmount(exp);
  const net = revN - expN;
  return (
    <Card style={{ marginBottom: 14 }}>
      <div style={{ fontFamily: T.serif, fontSize: 16, color: T.greenDark, marginBottom: 8 }}>
        Fiscal year net income <span style={{ fontSize: 12.5, color: T.ink3, fontFamily: T.sans }}>(manual entry, for the bulletin)</span>
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
        {[["Total Revenue", rev, setRev], ["Total Expenses", exp, setExp]].map(([label, val, set]) => (
          <div key={label} style={{ flex: "1 1 170px", maxWidth: 240 }}>
            <label style={{ fontSize: 13, color: T.ink2, display: "block", marginBottom: 4 }}>{label}</label>
            <input
              type="text" value={val}
              onChange={e => { set(e.target.value); setCalced(false); }}
              placeholder="e.g. 302793"
              style={{
                width: "100%", boxSizing: "border-box", padding: "7px 12px", fontSize: 14,
                border: `1px solid ${T.hairline}`, borderRadius: 6, fontFamily: T.sans,
              }}
            />
          </div>
        ))}
        <button
          onClick={() => setCalced(true)}
          disabled={!rev || !exp}
          style={{
            padding: "8px 18px", fontSize: 14, fontWeight: 700, fontFamily: T.sans,
            background: rev && exp ? T.green : "#c9d2cb", color: "#fff",
            border: "none", borderRadius: 6, cursor: rev && exp ? "pointer" : "default",
          }}
        >Calculate</button>
        {calced && (
          <div style={{ fontSize: 14.5, paddingBottom: 6 }}>
            Net income:{" "}
            <span style={{ fontFamily: T.serif, fontSize: 18, color: net >= 0 ? T.green : T.red }}>
              {net < 0 ? `(${fmtCents(Math.abs(net))})` : fmtCents(net)}
            </span>
          </div>
        )}
      </div>
    </Card>
  );
}
