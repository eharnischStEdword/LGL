// ─── Has the plate count landed in LGL yet? ───
//
// The v2 dashboard marks a week complete from the Thursday after its Sunday,
// because Eric's export-imports are PLANNED for Mon/Thu and a plan is not a
// guarantee. This detector is the EVIDENCE that beats that calendar rule: it
// asks LGL whether any Offertory gift in the week carries a plate payment type
// (cash or check). true = the count is in. false = no plate money for that week
// yet. null = cannot tell, and the client falls back to the calendar, so this
// can never make things worse than the rule it replaces.
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
} from "./hub-exit.js";

export const PLATE_CACHE_TTL_MS = 5 * 60 * 1000;

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
export function detectPlate(gifts, startKey, weekKey) {
  const items = (gifts || []).filter((g) => {
    if (!isOffertory(g)) return false;
    const day = receivedDay(g);
    return day !== null && day >= startKey && day <= weekKey;
  });
  const types = [...new Set(items.map(paymentTypeOf).filter(Boolean))];
  const typed = items.filter((g) => paymentTypeOf(g));
  const plateLanded = typed.length === 0
    ? null
    : typed.some((g) => isPlateType(paymentTypeOf(g)));
  return { plateLanded, giftCount: items.length, types };
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

    if (!hasApiKey()) {
      return res.json({ week: weekKey, plateLanded: null, message: "No LGL_API_KEY configured" });
    }

    const cacheKey = `plate_${weekKey}`;
    const cached = cache[cacheKey];
    if (cached && clock() - cached.time < ttlMs) {
      return res.json(cached.data);
    }

    let gifts;
    try {
      gifts = await fetchGiftsForRange(fetchGiftsPaged, startKey, readOpts || {});
    } catch (err) {
      if (err instanceof IncompleteRead) {
        console.warn(`[plate] week ${weekKey}: read did not finish (${err.reason}) — client falls back to calendar rule`);
        return res.json({ week: weekKey, plateLanded: null, error: err.publicMessage });
      }
      console.warn(`[plate] detector failed (${err && err.message}) — client falls back to calendar rule`);
      return res.json({ week: weekKey, plateLanded: null, error: err && err.message });
    }

    const { plateLanded, giftCount, types } = detectPlate(gifts, startKey, weekKey);
    console.log(`[plate] week ${weekKey}: ${giftCount} Offertory gifts in week, types=[${types.join(", ")}], plateLanded=${plateLanded}`);
    const result = { week: weekKey, plateLanded, giftCount, types, refreshedAt: new Date().toISOString() };
    cache[cacheKey] = { time: clock(), data: result };
    return res.json(result);
  };
}
