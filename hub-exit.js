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
// 3. It fails loudly. A read that could not happen, or that did not reach the
//    end of LGL's result set, returns an error rather than a smaller number. A
//    number is a claim about a Sunday and a missing answer is not.
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
// detector treats that as "cannot tell".
//
// This exit no longer walks that way: it pages until LGL says there is nothing
// left (see the bounds below). The constant stays because the plate detector
// still uses it, and because this module still ACCEPTS a fetcher that hands
// back a bare list with no way of saying whether the list is all of them. For
// that shape the old judgement is the only one available and is kept exactly:
// a list at or above the cap may have been truncated, so it is refused.
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
          note: "the read reached the end of LGL's result set before anything was summed. A read that cannot be proved complete is refused, not reported" },
      ],
    },
    metrics: [
      { key: "giving.lgl_plate", value: summary.plateCents, unit: "cents" },
      { key: "giving.lgl_online", value: summary.onlineCents, unit: "cents" },
    ],
  };
}

// One cached dump, the date it reaches back to, and how far through LGL's
// result set the walk has got. A backfill asks for a run of consecutive weeks,
// and each week alone would re-pull months of gifts from LGL a hundred at a
// time: thirteen weeks timed out at twenty seconds a piece.
//
// The dump for an EARLIER date is a superset of the dump for a later one, so a
// request that needs less than what is already held reuses it. Every caller
// filters on received_date afterwards regardless, so reusing a wider dump can
// never widen an answer.
//
// The walk is now RESUMABLE, which is the part that makes a 2025 week possible
// at all. A deep pull that runs out of time refuses this request and keeps what
// it collected, so the next request continues from the offset it stopped at
// instead of starting the same thirteen months again. A backfill issues its
// weeks back to back, so a pull too big for one budget finishes inside the same
// run and every week after it is served from the finished dump.
//
// This holds gift objects in the process, and MAX_RECORDS below is what stops
// that being unbounded. A full dump at the ceiling is tens of megabytes on a
// Render instance that also serves the dashboard, which is a second reason the
// ceiling is a real limit rather than a formality.
const dump = {
  since: null,       // the updated_from day this walk asks LGL for
  gifts: null,       // what has landed so far, deduped
  keys: null,        // dedupe keys for the above
  offset: 0,         // the next offset to ask LGL for
  totalItems: null,  // LGL's own count for this query, learned on page one
  complete: false,   // whether the end of the result set was actually reached
  at: 0,             // when the last page landed
  probed: false,     // whether the gift_date_from probe has been made for it
};

// A finished dump is reusable for ten minutes: that is a freshness decision.
export const DUMP_TTL_MS = 10 * 60 * 1000;

// An UNFINISHED walk is resumable for longer, because abandoning it means a
// deep pull can never finish and the week is never recorded, which is the exact
// failure this module was changed to fix.
//
// Thirty minutes covers a hub run and its retries and does not leave a
// half-walked offset lying around overnight. Resuming an offset walk against a
// list that has changed underneath it is not free: LGL's gift search is not
// known to guarantee a stable order, so a record touched mid-walk can appear on
// two pages, which the id dedupe below absorbs, and in principle a record could
// move to a page the walk has already passed, which nothing here could detect.
// That risk is small across the seconds between one backfill week and the next
// and is not worth carrying across a day. ASSUMPTION: this repo has never
// verified LGL's default sort order for gifts/search.json.
export const RESUME_TTL_MS = 30 * 60 * 1000;

// ─── What bounds the walk now that the page cap does not ───
//
// The cap used to be the whole answer: 50 pages of 100, and a result at or
// above 4,900 was refused because it might have been cut off. That was right
// about the danger and wrong about the remedy. A week in August 2025 sets
// updated_from to July 2025, LGL hands back every record touched since then,
// and thirteen months of gifts is well past 4,900 rows. So every 2025 week the
// hub asked for was refused, the hub holds about twelve weeks of giving, and
// the dashboard's "vs a year ago" tile correctly reads no match.
//
// It pages through instead. Three things bound the walk, and every one of them
// ends in a refusal rather than a short total.

// ONE. Wall clock. The hub's HTTP client gives this exit 90 seconds (TIMEOUT in
// sources.py of st-edward-plt-dashboard, read 2026-08-21). Going past that
// turns a refusal this route could have explained into a socket timeout, which
// reads to the hub as "the LGL service is down" and costs the weekly run the
// full ninety seconds. Sixty leaves a third of the hub's patience for the
// connection, the summarize pass and the reply, and a walk that hits it keeps
// its progress for the next request rather than losing it.
export const READ_BUDGET_MS = 60 * 1000;

// TWO. A ceiling on how many records one dump may ever walk, so that one
// malformed request cannot become an unbounded loop against somebody else's
// API.
//
// WHERE 25,000 CAME FROM, AND WHY IT WAS WRONG. It was derived from a rate: the
// LGL historical import recorded in CLAUDE.md is about 63,000 gifts over the 66
// months to December 2024, near 31 a day, so the deepest window this exit
// accepts (MAX_RANGE_DAYS plus ENTRY_LOOKBACK_DAYS, 445 days) was reckoned at
// about 14,000 records and 25,000 was called comfortable headroom. The comment
// even named its own weak point: nothing measured the current rate.
//
// The rate was never the thing that mattered. `updated_from` selects on when a
// record was last TOUCHED, so a single bulk operation inside LGL restamps
// however many records it touches and every query reaching back past that day
// returns all of them at once. The 2026-08-22 backfill is the measurement: 65
// of 79 weeks were refused on this ceiling, and not just the deep ones. The
// newest refusal was 2026-W21, so a query with `updated_from` in April 2026 was
// already reporting more than 25,000 records, against a daily run three months
// later that walked 1,750. No gift rate explains that. A bulk edit does.
//
// SO THE CEILING IS SIZED AGAINST THE DATABASE NOW, NOT AGAINST A RATE. An
// `updated_from` query cannot return more rows than LGL holds, and LGL holds on
// the order of 63,000 gifts. 75,000 is above that with room to grow, and a
// query claiming more than that is not a big backfill: it is this code being
// wrong about what it is talking to, which is what a ceiling should catch.
//
// Being wrong is still cheap in the safe direction. LGL reports total_items on
// the first page, so a query past the ceiling is refused after ONE request
// rather than after 250, and it is refused rather than truncated.
export const MAX_RECORDS = 75000;

// THREE. The same ceiling counted in requests, for the day LGL stops sending
// total_items and the walk cannot see how far it has to go. 250 pages is
// MAX_RECORDS at the 100-row page this repo asks for.
export const MAX_PAGES = 250;

// A read that did not reach the end of the result set. Separate from an
// ordinary failure because the route says something different about it: the
// data is fine, the request needs another go, and the next one resumes.
export class IncompleteRead extends Error {
  constructor(reason, message, publicMessage) {
    super(message);
    this.name = "IncompleteRead";
    this.reason = reason;             // "budget" | "ceiling" | "cap"
    this.publicMessage = publicMessage;
  }
}

// Same key the union merge in server.js uses, so the two agree about what makes
// two rows the same gift.
const keyOf = (g) => String(
  (g && g.id) != null
    ? g.id
    : `${g && g.received_date}|${g && g.received_amount}|${g && g.fund_name}`);

export function _resetDump() {
  dump.since = null;
  dump.gifts = null;
  dump.keys = null;
  dump.offset = 0;
  dump.totalItems = null;
  dump.complete = false;
  dump.at = 0;
  dump.probed = false;
}

// TWO SHAPES OF FETCHER, and why both are allowed.
//
// The paged fetcher in lgl-api.js reports where it stopped and whether it
// reached the end, which is what this module wants. A fetcher that hands back a
// bare array cannot say whether the array is all of them, and that is the shape
// this module was originally written against. Rather than trusting a bare array,
// the old page-cap judgement is applied to it unchanged: a list at or above the
// cap may have been cut off, so it counts as NOT complete and gets refused. The
// no-silent-truncation rule then holds for both shapes in one place.
function asProgress(result, startOffset) {
  if (Array.isArray(result)) {
    return {
      items: result,
      offset: startOffset + result.length,
      totalItems: null,
      complete: result.length < PAGE_CAP_SUSPECT,
      pages: null,
      stoppedBy: result.length < PAGE_CAP_SUSPECT ? "end" : "cap",
    };
  }
  const r = result || {};
  return {
    items: Array.isArray(r.items) ? r.items : [],
    offset: Number.isFinite(r.offset) ? r.offset : startOffset,
    totalItems: Number.isFinite(r.totalItems) ? r.totalItems : null,
    complete: r.complete === true,
    pages: Number.isFinite(r.pages) ? r.pages : null,
    stoppedBy: r.stoppedBy || (r.complete === true ? "end" : "unknown"),
  };
}

// How far before the window to start looking, so a gift entered ahead of the day
// it is received is still caught. updated_from selects on when the RECORD was
// touched, and everything downstream buckets on received_date, so a pledge typed
// in three weeks early would otherwise be invisible in the week it lands.
export const ENTRY_LOOKBACK_DAYS = 45;

// ONE WALK AT A TIME. Two requests resuming the same dump would both continue
// from the same offset and both write their own idea of where it got to, so one
// of them re-reads pages LGL has already served and the other steps over records
// nobody read. The hub asks sequentially today and nothing else in this repo
// touches this dump, but a slow pull now spans a minute and an overlapping run
// is no longer far-fetched.
let inFlight = null;

export async function fetchGiftsForRange(fetchGiftsAxis, from, opts = {}) {
  while (inFlight) {
    await inFlight;
  }
  const run = walkForRange(fetchGiftsAxis, from, opts);
  inFlight = run.catch(() => {});
  try {
    return await run;
  } finally {
    inFlight = null;
  }
}

// Ask LGL for everything that could belong to this window, on whichever axis it
// will actually answer.
//
// `gift_date_from` is NOT a parameter LGL accepts. It answers
// 400 Unknown query parameter, and it has been doing so in the plate detector
// since at least 2026-08-17, where a fallback hides it. Asking for it alone, as
// this route first did, made every read fail. `updated_from` is the axis this
// repo has always relied on and is verified working against the live API.
//
// updated_from alone has a known blind spot, recorded beside fetchLGLApiGifts in
// server.js: it misses a gift received inside the window whose record has not
// been touched since before it. The lookback above covers the ordinary version
// of that, and gift_date_from is still tried as a second axis in case LGL ever
// starts accepting it, with its failure swallowed rather than fatal.
//
// Everything is filtered on received_date afterwards regardless of how it
// arrived, so a wider net can never widen the answer.
async function walkForRange(fetchGiftsAxis, from, opts = {}) {
  const {
    lookbackDays = ENTRY_LOOKBACK_DAYS,
    clock = Date.now,
    budgetMs = READ_BUDGET_MS,
    maxRecords = MAX_RECORDS,
    maxPages = MAX_PAGES,
    // Left undefined in production so lgl-api.js owns the number. The suite
    // sets it, because a test that has to know the shipped page size to count
    // pages breaks every time that number is tuned.
    pageSize,
  } = opts || {};

  const since = new Date(`${from}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - lookbackDays);
  const sinceDay = since.toISOString().slice(0, 10);

  const startedAt = clock();
  const deadline = startedAt + budgetMs;

  const reachesBack = dump.since !== null && dump.since <= sinceDay;
  if (reachesBack && dump.complete && startedAt - dump.at < DUMP_TTL_MS) {
    return dump.gifts;
  }

  // A walk still in progress for a query that reaches back at least this far is
  // continued rather than restarted, even when this request needs less depth
  // than it does. Its query is a superset of this one and the received_date
  // filter downstream is what actually decides the answer.
  const resumable = reachesBack && !dump.complete && dump.gifts &&
    startedAt - dump.at < RESUME_TTL_MS;
  if (!resumable) {
    _resetDump();
    dump.since = sinceDay;
    dump.gifts = [];
    dump.keys = new Set();
    dump.at = startedAt;
  }

  const allowance = maxRecords - dump.offset;
  if (allowance <= 0) {
    const total = dump.totalItems;
    _resetDump();
    refuseCeiling(total, maxRecords);
  }

  // Progress is banked page by page, so a page that throws halfway through a
  // long walk does not throw away the pages LGL already served for it.
  const bank = (items, offset, totalItems) => {
    for (const g of items || []) {
      const k = keyOf(g);
      if (dump.keys.has(k)) continue;
      dump.keys.add(k);
      dump.gifts.push(g);
    }
    dump.offset = offset;
    if (totalItems !== null && totalItems !== undefined) dump.totalItems = totalItems;
    dump.at = clock();

    // The ceiling is checked HERE, from inside the walk, because LGL reports
    // total_items on the first page and there is no reason to spend the rest of
    // the budget walking towards a refusal that is already decided.
    if (dump.totalItems !== null && dump.totalItems > maxRecords) {
      refuseCeiling(dump.totalItems, maxRecords);
    }
  };

  let progress;
  try {
    progress = asProgress(
      await fetchGiftsAxis(`updated_from=${dump.since}`, {
        startOffset: dump.offset,
        maxRecords: allowance,
        maxPages,
        deadline,
        onPage: bank,
        ...(pageSize ? { pageSize } : {}),
      }),
      dump.offset);
  } catch (err) {
    // A walk that can never be allowed to finish is not worth resuming: the
    // next request would spend its whole budget arriving at the same refusal.
    if (err instanceof IncompleteRead && err.reason === "ceiling") _resetDump();
    throw err;
  }

  // A bare-array fetcher never calls onPage, so its rows are banked here. The
  // paged one has banked them already and re-banking is a no-op against the
  // dedupe set.
  bank(progress.items, progress.offset, progress.totalItems);
  dump.complete = progress.complete;

  if (!dump.complete) {
    if (dump.totalItems !== null && dump.totalItems > maxRecords) {
      // Not resumable: continuing a walk that can never be allowed to finish
      // would spend the next request's budget to arrive at the same refusal.
      const total = dump.totalItems;
      _resetDump();
      refuseCeiling(total, maxRecords);
    }
    if (progress.stoppedBy === "cap") {
      // A fetcher that hands back a bare list has no offset to resume from, so
      // there is nothing here worth keeping for the next request.
      const rows = progress.items.length;
      _resetDump();
      throw new IncompleteRead("cap",
        `a bare gift list of ${rows} rows is at or above the page cap`,
        "the LGL result may have been truncated by the page cap, refusing to report a partial total");
    }
    console.warn(`[hub-exit] the LGL walk since ${dump.since} stopped at ${dump.offset} of ` +
      `${dump.totalItems === null ? "an unknown number of" : dump.totalItems} records ` +
      `(${progress.stoppedBy}) after ${Math.round((clock() - startedAt) / 1000)}s; ` +
      "refusing this request and keeping the progress for the next one");
    // One sentence for every way the walk can stop short, because all of them
    // mean the same thing to the hub: this is not all the gifts. Which one it
    // was goes in the log line above, where the person tuning the bounds will
    // look for it.
    throw new IncompleteRead(progress.stoppedBy,
      `the walk since ${dump.since} reached ${dump.offset} records and did not finish`,
      "the LGL read did not reach the end of the result set within one request, " +
      "refusing to report a partial total. The next request resumes where this one stopped");
  }

  // The second axis, once per dump and only after the first one finished. It is
  // merged ONLY when it came back complete: a partial second axis can only be a
  // partial addition, and the first axis has already answered on its own terms.
  if (!dump.probed) {
    dump.probed = true;
    try {
      const other = asProgress(
        await fetchGiftsAxis(`gift_date_from=${dump.since}`,
          { startOffset: 0, maxRecords, maxPages, deadline,
            ...(pageSize ? { pageSize } : {}) }),
        0);
      if (other.complete) {
        for (const g of other.items) {
          const k = keyOf(g);
          if (dump.keys.has(k)) continue;
          dump.keys.add(k);
          dump.gifts.push(g);
        }
      } else {
        console.log(`[hub-exit] gift_date_from axis did not finish (${other.stoppedBy}), ignoring it`);
      }
    } catch (err) {
      // Expected today. Logged at info because it is the known state of the LGL
      // API, not a new fault, and updated_from already answered.
      console.log(`[hub-exit] gift_date_from axis unavailable (${err && err.message}), using updated_from only`);
    }
  }

  console.log(`[hub-exit] LGL walk since ${dump.since} complete: ${dump.gifts.length} gifts, ` +
    `${dump.offset} records read in ${Math.round((clock() - startedAt) / 1000)}s`);
  dump.at = clock();
  return dump.gifts;
}

function refuseCeiling(total, maxRecords) {
  // SAID OUT LOUD, because for one morning it was not. This is the only refusal
  // in the module that used to log nothing: the route turns an IncompleteRead
  // into a 502 carrying the public sentence and never writes the number down,
  // so 65 refused weeks left no trace on this service at all and the count that
  // caused them had to be inferred from the hub's side. A refusal that cannot
  // say what it refused is most of the way to a silent failure.
  console.error(`[hub-exit] refusing: LGL reports ` +
    `${total === null ? "more than" : total} records for this query, past the ` +
    `${maxRecords} this exit will walk in one dump`);
  throw new IncompleteRead("ceiling",
    `LGL reports ${total === null ? "more than" : total} records for this query, ` +
    `past the ${maxRecords} this exit will walk`,
    "the LGL query covers more records than this exit will read in one go, " +
    "refusing to report a partial total");
}

// ─── The route ───
//
// fetchGiftsAxis is server.js's fetchLGLApiGiftsPaged, passed in so this module
// can be exercised without the LGL API and without a key. It may also be a
// fetcher that returns a bare list of gifts; see asProgress for what that costs.
// hasApiKey reports whether LGL_API_KEY is set.
// readOpts overrides the bounds above. Production passes nothing; the test
// suite uses it to make a walk stop short on a page count rather than on a
// stopwatch, because a test that depends on how fast a machine runs is a test
// that fails on a Tuesday for no reason.
export function hubMetricsHandler({ fetchGiftsAxis, hasApiKey, readOpts }) {
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
      raw = await fetchGiftsForRange(fetchGiftsAxis, from, readOpts || {});
    } catch (err) {
      // A read that did not reach the end of LGL's result set is the case this
      // route exists to get right. Summing what did arrive would publish a
      // giving figure short by an unknown amount, and a short total is
      // indistinguishable from a quiet Sunday once it is a number on a
      // dashboard. So it is refused, the same as any other failure, and the
      // message says which kind it was so the next person is not guessing.
      if (err instanceof IncompleteRead) {
        return res.status(502).json({ error: err.publicMessage });
      }
      // The upstream message is logged, not returned: it is LGL's text and this
      // payload is read by a machine.
      console.error(`[hub-exit] LGL read failed: ${err && err.message}`);
      return res.status(502).json({ error: "could not read the gift data from LGL" });
    }

    if (!Array.isArray(raw)) {
      return res.status(502).json({ error: "LGL returned something that is not a list of gifts" });
    }

    const summary = summarizeOffertory(raw, from, to);
    return res.json(buildPayload({ from, to, summary }));
  };
}
