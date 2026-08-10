// v2 data layer.
// The monthly math here is copied VERBATIM from src/Dashboard.jsx (v1) so the
// two dashboards compute identical numbers while v1 stays untouched. Weekly
// functions are new in v2. When v1 retires, this file becomes the only copy.
import * as XLSX from "xlsx";
import { HISTORICAL_MONTHLY } from "./historical.js";

export const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
export const FY_START_MONTH = 7; // July
export const DATA_FLOOR = new Date(2019, 6, 1); // July 1, 2019 — start of historical data
export const FY_MONTH_LABELS = ["Jul","Aug","Sep","Oct","Nov","Dec","Jan","Feb","Mar","Apr","May","Jun"];

// Live gift-level data begins here; HISTORICAL_MONTHLY (monthly-only) can never
// feed weekly buckets, so the weekly panel floors at this date.
export const WEEKLY_FLOOR = new Date(2025, 0, 1);

/* ── verbatim v1 parsing helpers ── */

export function parseSpreadsheet(arrayBuffer, contentType) {
  if (contentType && (contentType.includes("text/") || contentType.includes("csv"))) {
    const text = new TextDecoder("utf-8").decode(arrayBuffer);
    const wb = XLSX.read(text, { type: "string" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { defval: "" });
  }
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

export function parseDateFlexible(str) {
  if (!str) return null;
  const num = typeof str === "number" ? str : parseFloat(str);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    // Excel serial: days since 1899-12-30, local time; round because CSV serials can be fractional
    const d = new Date(1899, 11, 30 + Math.round(num));
    if (!isNaN(d.getTime())) return d;
  }
  // Date-only ISO strings parse as LOCAL time so boundary gifts land in the right month/FY
  if (typeof str === "string") {
    const iso = str.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }
  const d = new Date(str);
  if (!isNaN(d.getTime())) return d;
  return null;
}

export function parseAmount(val) {
  if (typeof val === "number") return val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[$,\s]/g, "").replace(/\((.+)\)/, "-$1");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

export function detectColumns(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const datePatterns = ["gift date", "gift_date", "giftdate", "date", "deposit date", "deposit_date"];
  const amountPatterns = ["gift amount", "gift_amount", "giftamount", "amount", "gift amt", "total"];
  const fundPatterns = ["fund", "fund name", "fund_name"];
  function findCol(patterns) {
    for (const p of patterns) {
      const idx = lower.findIndex(h => h === p);
      if (idx !== -1) return headers[idx];
    }
    for (const p of patterns) {
      const idx = lower.findIndex(h => h.includes(p) && !h.includes("parent"));
      if (idx !== -1) return headers[idx];
    }
    return null;
  }
  return {
    dateCol: findCol(datePatterns),
    amountCol: findCol(amountPatterns),
    fundCol: findCol(fundPatterns)
  };
}

/* ── verbatim v1 date/bucket helpers ── */

export function getMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}`;
}

export function getMonthLabel(key) {
  const [y, m] = key.split("-");
  return `${MONTHS[parseInt(m)-1]} ${y}`;
}

export function getFYStart(date) {
  const y = date.getMonth() < FY_START_MONTH - 1 ? date.getFullYear() - 1 : date.getFullYear();
  return new Date(y, FY_START_MONTH - 1, 1);
}

export function getFYLabel(now = new Date()) {
  const start = getFYStart(now);
  const endYear = start.getFullYear() + 1;
  return `FY ${start.getFullYear()}-${String(endYear).slice(2)}`;
}

// Linear regression trend line computation (verbatim v1)
export function computeTrend(data, key) {
  const points = data.map((d, i) => ({ x: i, y: d[key] || 0 }));
  const n = points.length;
  if (n < 2) return null;
  let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (const p of points) {
    sumX += p.x; sumY += p.y; sumXY += p.x * p.y; sumXX += p.x * p.x;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const first = Math.max(0, intercept);
  const last = Math.max(0, intercept + slope * (n - 1));
  const pct = first > 0 ? ((last - first) / first) * 100 : 0;
  const trendData = data.map((d, i) => ({ ...d, [`${key}_trend`]: Math.max(0, intercept + slope * i) }));
  return { data: trendData, pct };
}

// Completed-month buckets for the current period and the equivalent prior-year
// period (verbatim v1). Current partial month excluded from BOTH windows.
export function periodBuckets(timeRange, now) {
  const curY = now.getFullYear();
  const curM = now.getMonth();
  const walk = (startY, startM, count) => {
    const out = [];
    let y = startY, m = startM;
    for (let i = 0; i < count; i++) {
      out.push({ y, m });
      m++; if (m > 11) { m = 0; y++; }
    }
    return out;
  };
  if (timeRange === "fy") {
    const fyStartY = curM >= FY_START_MONTH - 1 ? curY : curY - 1;
    const elapsed = curM >= FY_START_MONTH - 1 ? curM - (FY_START_MONTH - 1) : curM + (12 - (FY_START_MONTH - 1));
    if (elapsed <= 0) return null;
    const current = walk(fyStartY, FY_START_MONTH - 1, elapsed);
    return { current, prior: current.map(b => ({ y: b.y - 1, m: b.m })), label: "vs last year" };
  }
  if (timeRange === "ytd") {
    const elapsed = curM;
    if (elapsed <= 0) return null;
    const current = walk(curY, 0, elapsed);
    return { current, prior: current.map(b => ({ y: b.y - 1, m: b.m })), label: "vs last year" };
  }
  if (timeRange === "last12" || timeRange === "last24") {
    const n = timeRange === "last12" ? 12 : 24;
    let lastY = curY, lastM = curM - 1;
    if (lastM < 0) { lastM = 11; lastY--; }
    let sM = lastM - (n - 1), sY = lastY;
    while (sM < 0) { sM += 12; sY--; }
    const current = walk(sY, sM, n);
    let pM = sM - n, pY = sY;
    while (pM < 0) { pM += 12; pY--; }
    return { current, prior: walk(pY, pM, n), label: n === 12 ? "vs prior 12 mo" : "vs prior 24 mo" };
  }
  return null;
}

// Currency label formatter (verbatim v1): negatives as "-$1.2k"
export function fmtLabel(value) {
  const a = Math.abs(value);
  const s = a >= 1000 ? `$${(a / 1000).toFixed(1)}k` : `$${a.toFixed(0)}`;
  return value < 0 ? `-${s}` : s;
}

export const fmtWhole = (v) =>
  `${v < 0 ? "-" : ""}$${Math.abs(Math.round(v)).toLocaleString("en-US")}`;
export const fmtCents = (v) =>
  `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── gift index (verbatim v1 semantics) ── */

// fund|year|month -> total, plus all-funds combined; historical backfill gated
// on the live KEY SET so a real $0 live month is never replaced, and the
// all-funds merge is case-insensitive so live/historical fund names never
// double-count.
export function buildGiftIndex(rawGifts) {
  const idx = {};
  const allIdx = {};
  const liveKeys = new Set();
  const liveAllKeys = new Set();
  for (const g of rawGifts) {
    const yr = g.date.getFullYear();
    const mo = g.date.getMonth();
    const fk = `${g.fund}|${yr}|${mo}`;
    idx[fk] = (idx[fk] || 0) + g.amount;
    liveKeys.add(fk);
    liveAllKeys.add(`${g.fund.toLowerCase().trim()}|${yr}|${mo}`);
    const ak = `${yr}|${mo}`;
    allIdx[ak] = (allIdx[ak] || 0) + g.amount;
  }
  for (const [fund, months] of Object.entries(HISTORICAL_MONTHLY)) {
    for (const [ym, amount] of Object.entries(months)) {
      const [y, m] = ym.split("-").map(Number);
      const fk = `${fund}|${y}|${m - 1}`;
      if (!liveKeys.has(fk)) idx[fk] = amount;
      if (!liveAllKeys.has(`${fund.toLowerCase().trim()}|${y}|${m - 1}`)) {
        const ak = `${y}|${m - 1}`;
        allIdx[ak] = (allIdx[ak] || 0) + amount;
      }
    }
  }
  return { byFund: idx, allFunds: allIdx };
}

// Per-fund honest trend (verbatim v1 fundTrends semantics)
export function computeFundTrends(giftIndex, funds, timeRange, now) {
  const pb = periodBuckets(timeRange, now);
  if (!pb) return { map: {}, label: "" };
  const sumFund = (buckets, fund) =>
    buckets.reduce((s, b) => s + (giftIndex.byFund[`${fund}|${b.y}|${b.m}`] || 0), 0);
  const map = {};
  for (const f of funds) {
    const cur = sumFund(pb.current, f);
    const pri = sumFund(pb.prior, f);
    if (cur === 0 && pri === 0) { map[f] = { kind: "none" }; continue; }
    if (pri === 0) { map[f] = { kind: "new", current: cur }; continue; }
    map[f] = { kind: "pct", pct: ((cur - pri) / pri) * 100, current: cur, prior: pri };
  }
  return { map, label: pb.label };
}

/* ── NEW: weekly engine (v2 only) ──
   A collection week runs Monday through Sunday and is labeled by its ending
   Sunday ("Week ending Sun, Aug 2"). A week is PROVISIONAL until the
   Wednesday after its ending Sunday (plate cash/checks are counted and posted
   Mon-Tue); provisional weeks are excluded from the 4-week average, FY pace,
   and every year-over-year comparison. Prior-year partner = the week ending
   exactly 364 days earlier (preserves day-of-week). Weeks containing
   Christmas, Easter, or Ash Wednesday are flagged instead of compared. */

export function addDays(date, n) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
}

export function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

// The Sunday that ENDS the Mon-Sun week containing `date`.
export function weekEndingSunday(date) {
  const d = startOfDay(date);
  const day = d.getDay(); // 0 = Sunday
  return day === 0 ? d : addDays(d, 7 - day);
}

export function weekKey(sunday) {
  return `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;
}

export function fmtWeekLabel(sunday) {
  return `${MONTHS[sunday.getMonth()]} ${sunday.getDate()}`;
}

export function fmtWeekLong(sunday) {
  return `Week ending Sun, ${MONTHS[sunday.getMonth()]} ${sunday.getDate()}`;
}

// Complete on the Wednesday after the ending Sunday (a date rule, not a guess
// about batch posting): endSunday +1 = Mon, +2 = Tue, +3 = Wed 00:00.
export function isWeekComplete(endSunday, now) {
  return startOfDay(now).getTime() >= addDays(endSunday, 3).getTime();
}

// Anonymous Gregorian algorithm (Computus) — Easter Sunday for a given year.
export function easterSunday(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3 = March, 4 = April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

// Does the Mon-Sun week ending at `endSunday` contain a non-comparable holy
// day (Christmas, Easter, or Ash Wednesday)?
export function isHolyDayWeek(endSunday) {
  const weekStart = addDays(endSunday, -6);
  const contains = (d) => d.getTime() >= weekStart.getTime() && d.getTime() <= endSunday.getTime();
  for (const year of new Set([weekStart.getFullYear(), endSunday.getFullYear()])) {
    if (contains(new Date(year, 11, 25))) return true; // Christmas
    const easter = easterSunday(year);
    if (contains(easter)) return true;
    if (contains(addDays(easter, -46))) return true; // Ash Wednesday
  }
  return false;
}

// Bucket live gifts into Mon-Sun weeks for one fund (or all funds when
// fund == null). Only gifts on/after WEEKLY_FLOOR participate.
export function buildWeekTotals(rawGifts, fund) {
  const totals = new Map(); // weekKey -> amount
  for (const g of rawGifts) {
    if (g.date < WEEKLY_FLOOR) continue;
    if (fund && g.fund !== fund) continue;
    const wk = weekKey(weekEndingSunday(g.date));
    totals.set(wk, (totals.get(wk) || 0) + g.amount);
  }
  return totals;
}

// The full weekly model for the Recent Weeks panel + answer band.
// Returns null when there is no live weekly data at all.
export function buildWeeklyModel(rawGifts, fund, now, nWeeks = 8) {
  const live = rawGifts.filter(g => g.date >= WEEKLY_FLOOR);
  if (live.length === 0) return null;
  const totals = buildWeekTotals(rawGifts, fund);
  const minLiveDate = live.reduce((min, g) => (g.date < min ? g.date : min), live[0].date);

  // The most recent week whose ending Sunday is on or before today. On a
  // Monday this is the week that ended yesterday (always provisional).
  const today = startOfDay(now);
  const upcoming = weekEndingSunday(today);
  const lastEnded = upcoming.getTime() <= today.getTime() ? upcoming : addDays(upcoming, -7);

  const weeks = [];
  for (let i = nWeeks - 1; i >= 0; i--) {
    const endSunday = addDays(lastEnded, -7 * i);
    if (addDays(endSunday, -6) < minLiveDate) continue; // partial data coverage — omit
    const complete = isWeekComplete(endSunday, now);
    weeks.push({
      endSunday,
      key: weekKey(endSunday),
      total: totals.get(weekKey(endSunday)) || 0,
      complete,
      holyDay: isHolyDayWeek(endSunday),
    });
  }
  if (weeks.length === 0) return null;

  const completeWeeks = weeks.filter(w => w.complete);
  const lastComplete = completeWeeks.length > 0 ? completeWeeks[completeWeeks.length - 1] : null;
  const counting = weeks.filter(w => !w.complete);

  // 4-week rolling average over the 4 most recent COMPLETE weeks
  const last4 = completeWeeks.slice(-4);
  const fourWeekAvg = last4.length === 4
    ? last4.reduce((s, w) => s + w.total, 0) / 4
    : null;

  // Same week last year (364 days back) for the last complete week; n/a when
  // the partner week predates live gift-level coverage.
  let priorYearWeek = null;
  if (lastComplete) {
    const partner = addDays(lastComplete.endSunday, -364);
    if (addDays(partner, -6).getTime() >= Math.max(WEEKLY_FLOOR.getTime(), startOfDay(minLiveDate).getTime())) {
      priorYearWeek = {
        endSunday: partner,
        total: totals.get(weekKey(partner)) || 0,
        holyDay: isHolyDayWeek(partner) || lastComplete.holyDay,
      };
    }
  }

  // This week so far (the in-progress Mon-Sun week containing today) — only
  // when today is not itself an ending Sunday already counted above.
  const currentWeekEnd = weekEndingSunday(today);
  const thisWeekSoFar = currentWeekEnd.getTime() > lastEnded.getTime()
    ? (totals.get(weekKey(currentWeekEnd)) || 0)
    : null;

  return { weeks, lastComplete, counting, fourWeekAvg, priorYearWeek, thisWeekSoFar, minLiveDate };
}

// FY-to-date pace through the last complete week, vs the prior FY through the
// same week (364 days back). Sums LIVE gifts only — both windows start after
// WEEKLY_FLOOR or return null.
export function fyPaceThroughWeek(rawGifts, fund, lastCompleteSunday, now, minLiveDate) {
  if (!lastCompleteSunday) return null;
  const fyStart = getFYStart(now);
  const priorFyStart = new Date(fyStart.getFullYear() - 1, fyStart.getMonth(), fyStart.getDate());
  const priorSunday = addDays(lastCompleteSunday, -364);
  // Same live-coverage floor as the partner-week check: the prior window must
  // be fully inside live gift-level data or the pace is n/a, never a fake $0.
  const floor = minLiveDate
    ? new Date(Math.max(WEEKLY_FLOOR.getTime(), startOfDay(minLiveDate).getTime()))
    : WEEKLY_FLOOR;
  if (priorFyStart < floor) return null;
  if (lastCompleteSunday < fyStart) return null; // FY just rolled; no complete week yet
  const sumRange = (from, toExclusive) => rawGifts.reduce((s, g) => {
    if (fund && g.fund !== fund) return s;
    return (g.date >= from && g.date < toExclusive) ? s + g.amount : s;
  }, 0);
  const current = sumRange(fyStart, addDays(lastCompleteSunday, 1)); // through end of Sunday
  const prior = sumRange(priorFyStart, addDays(priorSunday, 1));
  return { current, prior, throughSunday: lastCompleteSunday };
}
