// ─── Has the plate count landed in LGL yet? ───
//
// The v2 dashboard marks a week complete from the Thursday after its Sunday,
// because Eric's export-imports are PLANNED for Mon/Thu and a plan is not a
// guarantee. This detector is the EVIDENCE that beats that calendar rule: it
// counts the Offertory gifts in the week that carry a plate payment type (cash
// or check) and asks whether there are enough of them to be a basket. true =
// the count is in. false = the basket is not in LGL yet, whatever else is.
// null = cannot tell, and the client falls back to the calendar, so this can
// never make things worse than the rule it replaces.
//
// WHY THIS MODULE EXISTS. The detector was fifty lines inside a route in
// server.js, and it asked LGL for `gift_date_from`, a parameter LGL does not
// accept. LGL answers 400 Unknown query parameter; the route's catch turned
// that into plateLanded: null; the client fell back to the calendar; and
// nothing on any screen said the evidence path had stopped working. It had been
// dead since at least 2026-08-17. Untestable code is how a defect gets to live
// that long, so the logic moved here where the suite can drive it without
// booting Express and without an LGL key.

import {
  fetchGiftsForRange,
  IncompleteRead,
  isOffertory,
  isPlateType,
  paymentTypeOf,
  receivedDay,
  summarizeOffertory,
} from "./hub-exit.js";

export const PLATE_CACHE_TTL_MS = 5 * 60 * 1000;

// How many ended weeks one request may ask the split for (`?weeks=N`). The
// Recent Weeks panel shows eight; twelve leaves room without letting a typo
// ask LGL for a year. Each extra week reaches the read seven days further
// back, on top of the 45-day entry lookback the shared read already has.
export const MAX_WEEKS = 12;

const fmtDay = (dt) =>
  `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;

// WHICH WEEK. The client names the week it cares about (its newest ended
// Sunday) so a server-timezone day shift can never make the two disagree. The
// fallback computes it here for a caller that does not, and for the tests.
export function weekWindow(weekParam, now = new Date()) {
  let endSunday;
  if (/^\d{4}-\d{2}-\d{2}$/.test(weekParam || "")) {
    const [wy, wm, wd] = String(weekParam).split("-").map(Number);
    endSunday = new Date(wy, wm - 1, wd);
  } else {
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = today.getDay(); // 0 Sun
    const upcoming = dow === 0 ? today
      : new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - dow));
    endSunday = upcoming.getTime() <= today.getTime() ? upcoming
      : new Date(upcoming.getFullYear(), upcoming.getMonth(), upcoming.getDate() - 7);
  }
  const weekStart = new Date(endSunday.getFullYear(), endSunday.getMonth(), endSunday.getDate() - 6);
  return { startKey: fmtDay(weekStart), weekKey: fmtDay(endSunday) };
}

// The n ended weeks up to and including weekKey, OLDEST FIRST, which is the
// order the Recent Weeks panel draws them in.
export function weekWindows(weekKey, n) {
  const [y, m, d] = String(weekKey).split("-").map(Number);
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const end = new Date(y, m - 1, d - 7 * i);
    const start = new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6);
    out.push({ startKey: fmtDay(start), weekKey: fmtDay(end) });
  }
  return out;
}

// `?weeks=` as a number this route is willing to serve. Nonsense is one week,
// which is what every caller before 2026-09-03 got.
export function clampWeeks(raw) {
  const n = parseInt(String(raw === undefined || raw === null ? "" : raw), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_WEEKS);
}

// One week's parts for the fund dashboard: the Sunday basket, the mail and
// office cash and cheques received on other days, and online. It is the SAME
// summarizeOffertory the hub exit ships to the PLT hub, called on the same
// gifts, so the two dashboards cannot disagree about a week. Money is cents
// here as it is there; the client turns it into dollars once, at the edge.
export function weekParts(gifts, startKey, weekKey) {
  const s = summarizeOffertory(gifts, startKey, weekKey);
  const d = detectPlate(gifts, startKey, weekKey);
  return {
    week: weekKey,
    start: startKey,
    plateLanded: d.plateLanded,
    giftCount: d.giftCount,
    plateCount: d.plateCount,
    sundayCents: s.plateSundayCents,
    sundayGifts: s.plateSundayGifts,
    midweekCents: s.plateMidweekCents,
    midweekGifts: s.plateMidweekGifts,
    onlineCents: s.onlineCents,
    unclassifiedCents: s.unclassifiedCents,
  };
}

// THE JUDGEMENT, given the gifts.
//
// Offertory only. The old inline version looked at every fund, so a cash gift
// to the Building Fund in the same week said the plate had landed and marked
// the Offertory week complete while the basket count was still on paper. The
// hub exit already reports plate and online money for the Offertory fund alone
// (`isOffertory`, same predicate), and this detector decides whether the figure
// beside it is final, so the two have to be looking at the same money.
//
// A week whose Offertory gifts all arrived with NO payment type answers null
// rather than false: LGL is not telling us what kind of money it was, and
// "no plate yet" is a claim we cannot make from that.
//
// HOW MANY PLATE GIFTS MAKE A BASKET. Until 2026-09-03 the answer was one, and
// one is what the mail brings. The week of 17 to 23 August 2026 held five
// cheques dated Thursday 20 August and 96 cash and cheque gifts dated Sunday
// 23 August, and those 96 reached LGL four days after the weekend. Under "any
// plate gift" the five cheques marked the week complete from the Wednesday
// with $551.00 of plate standing in for $10,912.00. The money counters' sheet
// for that Sunday matched the Sunday batch to $50.00, so "the count landed"
// means the Sunday batch, 75 to 100 gifts, and not any cash or cheque in the
// week (ALERT-2026-09-03-plate-is-not-the-count.md).
//
// Twenty is a judgement from that one measured week plus the hub's range: well
// under a real basket, well over a week of mail. Recheck it once Barb keys the
// collection at count time and a few weeks have run.
//
// WHAT IT COSTS. A weekend whose Offertory basket is genuinely tiny reads
// "waiting on the count" until the next Sunday ends and the calendar takes
// over. The PLT hub's D88 records Christmas and Easter as their own Pushpay
// tally, so those are the weekends where that will happen.
export const PLATE_BASKET_FLOOR = 20;

export function detectPlate(gifts, startKey, weekKey) {
  const items = (gifts || []).filter((g) => {
    if (!isOffertory(g)) return false;
    const day = receivedDay(g);
    return day !== null && day >= startKey && day <= weekKey;
  });
  const types = [...new Set(items.map(paymentTypeOf).filter(Boolean))];
  const typed = items.filter((g) => paymentTypeOf(g));
  const plateCount = typed.filter((g) => isPlateType(paymentTypeOf(g))).length;
  const plateLanded = typed.length === 0
    ? null
    : plateCount >= PLATE_BASKET_FLOOR;
  return { plateLanded, giftCount: items.length, plateCount, types };
}

// ─── The route ───
//
// fetchGiftsPaged is lgl-api.js's fetchLGLApiGiftsPaged, injected so the suite
// can drive this without the LGL API. It goes through fetchGiftsForRange, which
// is the SAME read the hub exit uses: it asks on `updated_from` (the axis LGL
// actually answers), reaches back ENTRY_LOOKBACK_DAYS before the window, proves
// it reached the end of the result set, and shares one cached dump. So a hub
// backfill and a dashboard load no longer pull the same gifts twice.
//
// A read that could not be proved complete is null, not false. Half the week's
// gifts with no plate money in them is not evidence that no plate money exists.
export function plateStatusHandler({
  fetchGiftsPaged,
  hasApiKey,
  cache = {},
  ttlMs = PLATE_CACHE_TTL_MS,
  readOpts,
  clock = Date.now,
  now = () => new Date(),
}) {
  return async function plateStatus(req, res) {
    const { startKey, weekKey } = weekWindow(req.query && req.query.week, now());
    // The split for the last N weeks rides on the same read (2026-09-03). The
    // read reaches back to the OLDEST week's Monday; the judgement about the
    // count is still made on the newest week alone, as before.
    const nWeeks = clampWeeks(req.query && req.query.weeks);
    const windows = weekWindows(weekKey, nWeeks);

    if (!hasApiKey()) {
      return res.json({ week: weekKey, plateLanded: null, message: "No LGL_API_KEY configured" });
    }

    const cacheKey = `plate_${weekKey}_${nWeeks}`;
    const cached = cache[cacheKey];
    if (cached && clock() - cached.time < ttlMs) {
      return res.json(cached.data);
    }

    let gifts;
    try {
      gifts = await fetchGiftsForRange(fetchGiftsPaged, windows[0].startKey, readOpts || {});
    } catch (err) {
      if (err instanceof IncompleteRead) {
        console.warn(`[plate] week ${weekKey}: read did not finish (${err.reason}) — client falls back to calendar rule`);
        return res.json({ week: weekKey, plateLanded: null, error: err.publicMessage });
      }
      console.warn(`[plate] detector failed (${err && err.message}) — client falls back to calendar rule`);
      return res.json({ week: weekKey, plateLanded: null, error: err && err.message });
    }

    const { plateLanded, giftCount, plateCount, types } = detectPlate(gifts, startKey, weekKey);
    const weeks = windows.map((w) => weekParts(gifts, w.startKey, w.weekKey));
    console.log(`[plate] week ${weekKey}: ${giftCount} Offertory gifts in week, ${plateCount} cash/check (floor ${PLATE_BASKET_FLOOR}), types=[${types.join(", ")}], plateLanded=${plateLanded}, split for ${nWeeks} week(s)`);
    const result = { week: weekKey, plateLanded, giftCount, plateCount, types, weeks, refreshedAt: new Date().toISOString() };
    cache[cacheKey] = { time: clock(), data: result };
    return res.json(result);
  };
}
