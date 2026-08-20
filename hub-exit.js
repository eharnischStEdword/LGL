// ─── The PLT hub's read-only exit ───
//
// Implements docs/exit-contract.md version 1 from the PLT dashboard repo
// (st-edward-plt-dashboard). The Service System implements the same contract in
// hub_exit.py and was first; keep this in step with the document rather than
// with local taste, because the point of the contract is that the second
// integration is an afternoon.
//
// Four things this module is careful about:
//
// 1. It answers to a machine credential, not the Microsoft session every other
//    route uses, and it is matched by EXACT path. The session gate in server.js
//    waves through anything whose path starts with "/api", so this route owns
//    its own door and must never be wrapped in requireAuth.
//
// 2. It never emits a donor name, an email address, a gift id, or an address.
//    Every value in the payload is a sum or a count over Offertory gifts.
//
// 3. It fails loudly. A read that could not happen, or that the page cap may
//    have truncated, returns an error rather than a smaller number. A number is
//    a claim about a Sunday and a missing answer is not.
//
// 4. Money is whole cents, always an integer, never a float.

import crypto from "crypto";

export const CONTRACT = 1;

// The name the hub records against every figure it takes from here.
export const SOURCE = "lgl";

// The one fund this exit reports on. Same string the hybrid Offertory endpoint
// filters by in server.js, defined once so the two cannot drift apart.
export const OFFERTORY_FUND = "Offertory";

// fetchLGLApiGiftsAxis stops at 50 pages of 100, so a result at or above this
// size may have been cut off before the gifts we care about. The plate-status
// detector treats that as "cannot tell"; this exit treats it as "cannot answer".
export const PAGE_CAP_SUSPECT = 4900;

// Long enough for any backfill the hub might ask for, short enough that a typo
// cannot ask LGL for the whole history.
export const MAX_RANGE_DAYS = 400;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// ─── The plate versus online split ───
//
// Defined ONCE here and imported by the v2 plate-status detector in server.js.
// A second copy would drift, and the day the two disagree is the day the
// dashboard says the count landed while the hub says the basket was empty.
//
// Word boundaries on purpose: eCheck, E-Check (ACH) and Cash App are ONLINE
// payment types that happen to contain the letters "check" or "cash", and they
// arrive without anybody counting a basket.
export const isPlateType = (t) =>
  !!t && /\b(cash|check)\b/i.test(t) && !/e-?check/i.test(t) && !/cash app/i.test(t);

// LGL has returned the payment type both as a flat name and as a nested object.
export const paymentTypeOf = (gift) =>
  (gift && (gift.payment_type_name || (gift.payment_type && gift.payment_type.name))) || null;

export const isOffertory = (gift) =>
  String((gift && gift.fund_name) || "").trim().toLowerCase() === OFFERTORY_FUND.toLowerCase();

// WHICH DATE FIELD, AND WHY IT MATTERS.
//
// received_date. That is the field the plate-status detector filters on, the
// field the dashboard buckets gifts by, and the day the money was received,
// which is the day the paper count sheet is for. The hub sets this figure beside
// a hand count of the same Sunday, so the two systems have to agree about what
// day a gift belongs to or a real reconciliation looks like a discrepancy.
//
// Sliced to ten characters so a value that ever arrives as a full timestamp
// still compares as a day. ISO day strings sort lexicographically, so plain
// string comparison is a date comparison here.
export const receivedDay = (gift) =>
  String((gift && gift.received_date) || "").slice(0, 10) || null;

// Same parse the hybrid endpoint's dedupe key uses, so "$1,234.56" and 1234.56
// agree, then rounded to whole cents. The contract carries money as cents on
// purpose: a float dollar amount should not have to survive two systems.
export function toCents(amount) {
  const dollars = parseFloat(String(amount === null || amount === undefined ? "0" : amount)
    .replace(/[$,]/g, ""));
  return Number.isFinite(dollars) ? Math.round(dollars * 100) : 0;
}

function isRealDay(s) {
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function dayGap(from, to) {
  const at = (s) => {
    const [y, m, d] = s.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((at(to) - at(from)) / 86400000);
}

export function parseRange(query) {
  const q = query || {};
  const clean = (v) => String(v === null || v === undefined ? "" : v).trim();
  const from = clean(q.from);
  const to = clean(q.to);
  if (!from || !to) return { problem: "give from and to as YYYY-MM-DD" };
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return { problem: "from and to must be YYYY-MM-DD" };
  if (!isRealDay(from) || !isRealDay(to)) return { problem: "from and to must be real dates" };
  if (to < from) return { problem: "to is before from" };
  if (dayGap(from, to) > MAX_RANGE_DAYS) {
    return { problem: `range is longer than ${MAX_RANGE_DAYS} days` };
  }
  return { from, to };
}

// crypto.timingSafeEqual THROWS when the two buffers are different lengths, so
// the lengths are compared first. That leaks the length of the secret and
// nothing else, which is the same trade Python's hmac.compare_digest makes.
function timingSafeEquals(given, expected) {
  const left = Buffer.from(String(given), "utf8");
  const right = Buffer.from(String(expected), "utf8");
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}

export function bearerAuthorized(header, expected) {
  if (!expected) return false;
  const raw = String(header || "");
  if (!raw.startsWith("Bearer ")) return false;
  return timingSafeEquals(raw.slice(7).trim(), expected);
}

// Read at request time, not at import time, so setting the variable on Render
// takes effect on the next deploy rather than needing one more code change, and
// so a test can turn it on and off.
export function exitToken() {
  return (process.env.HUB_EXIT_TOKEN || "").trim() || null;
}

// ─── The numbers ───
//
// A gift with NO payment type at all is counted in NEITHER figure. It is not
// evidence of plate money and it is not evidence of online money, and silently
// filing it under plate would make the hub read a basket that nobody counted.
// It is disclosed instead, as a count and as an amount, so the payload can never
// quietly under-report without saying that it did.
export function summarizeOffertory(gifts, from, to) {
  let plateCents = 0;
  let onlineCents = 0;
  let unclassified = 0;
  let unclassifiedCents = 0;
  let recordsInPeriod = 0;
  let lastRecordAt = null;

  for (const gift of gifts || []) {
    if (!isOffertory(gift)) continue;
    const day = receivedDay(gift);
    if (!day) continue;

    // The newest Offertory gift SEEN, not the newest one inside the period. A
    // source that has stopped receiving data looks exactly like a quiet week
    // unless it says otherwise, and that is the whole job of this field.
    if (!lastRecordAt || day > lastRecordAt) lastRecordAt = day;

    if (day < from || day > to) continue;
    recordsInPeriod += 1;

    const cents = toCents(gift.received_amount);
    const type = paymentTypeOf(gift);
    if (!type) {
      unclassified += 1;
      unclassifiedCents += cents;
      continue;
    }
    if (isPlateType(type)) plateCents += cents;
    else onlineCents += cents;
  }

  return { plateCents, onlineCents, unclassified, unclassifiedCents, recordsInPeriod, lastRecordAt };
}

export function buildPayload({ from, to, summary, generatedAt }) {
  return {
    contract: CONTRACT,
    source: SOURCE,
    generated_at: generatedAt || new Date().toISOString(),
    period: { from, to, grain: "week" },
    freshness: {
      // LGL gives a gift a DAY, not a time, so this is a day. The hub stores
      // freshness as it is told it and does not parse a clock out of this.
      last_record_at: summary.lastRecordAt,
      records_in_period: summary.recordsInPeriod,
      signals: [
        { key: "unclassified", value: summary.unclassified,
          note: "Offertory gifts in the period with no payment type, counted in neither figure" },
        { key: "unclassified_cents", value: summary.unclassifiedCents,
          note: "how much money those gifts carry, so the two figures can be reconciled against the fund total" },
        { key: "capped", value: 0,
          note: "the LGL page cap did not truncate this read. A read that may have been truncated is refused, not reported" },
      ],
    },
    metrics: [
      { key: "giving.lgl_plate", value: summary.plateCents, unit: "cents" },
      { key: "giving.lgl_online", value: summary.onlineCents, unit: "cents" },
    ],
  };
}

// ─── The route ───
//
// fetchGiftsAxis is server.js's fetchLGLApiGiftsAxis, passed in so this module
// can be exercised without the LGL API and without a key. hasApiKey reports
// whether LGL_API_KEY is set.
export function hubMetricsHandler({ fetchGiftsAxis, hasApiKey }) {
  return async function hubMetrics(req, res) {
    // Not configured is not the same as forbidden, and the status code alone
    // saying which side is wrong saves an afternoon.
    if (!exitToken()) {
      return res.status(503).json({ error: "the hub exit is not configured on this service" });
    }
    if (!bearerAuthorized(req.get ? req.get("authorization") : null, exitToken())) {
      return res.status(401).json({ error: "bad or missing bearer token" });
    }

    const { from, to, problem } = parseRange(req.query);
    if (problem) return res.status(400).json({ error: problem });

    // Checked after the token so an unauthenticated caller learns nothing about
    // how this service is configured.
    if (!hasApiKey()) {
      return res.status(503).json({ error: "the LGL API key is not configured on this service" });
    }

    let raw;
    try {
      // Same axis the plate-status detector uses, then filtered on
      // received_date. See receivedDay above for why that field.
      raw = await fetchGiftsAxis(`gift_date_from=${from}`);
    } catch (err) {
      // The upstream message is logged, not returned: it is LGL's text and this
      // payload is read by a machine.
      console.error(`[hub-exit] LGL read failed: ${err && err.message}`);
      return res.status(502).json({ error: "could not read the gift data from LGL" });
    }

    if (!Array.isArray(raw)) {
      return res.status(502).json({ error: "LGL returned something that is not a list of gifts" });
    }
    if (raw.length >= PAGE_CAP_SUSPECT) {
      // Truncated is indistinguishable from a quiet week once it is summed, so
      // it is refused. Zeros and short totals are both claims about a Sunday.
      console.warn(`[hub-exit] ${raw.length} gifts returned, at or above the page cap, refusing to report`);
      return res.status(502).json({
        error: "the LGL result may have been truncated by the page cap, refusing to report a partial total",
      });
    }

    const summary = summarizeOffertory(raw, from, to);
    return res.json(buildPayload({ from, to, summary }));
  };
}
