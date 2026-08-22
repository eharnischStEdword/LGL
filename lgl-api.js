// ─── Talking to the Little Green Light gift search ───
//
// This lived inside server.js as one loop that walked 50 pages and stopped. It
// is its own module now for two reasons. The hub exit needs a walk that can say
// whether it reached the end, which the old loop could not, and a walk that
// decides whether a Sunday's giving figure is publishable deserves to be
// exercised by the test suite without booting Express or holding an API key.
//
// server.js still imports the old function unchanged. v1, v2 and the
// plate-status detector behave exactly as they did.

export const LGL_API_BASE = "https://api.littlegreenlight.com/api/v1";

// 100 rows is what this repo has always asked LGL for, and the legacy walk at
// the bottom of this file still does, because `fetchLGLApiGiftsAxis` advances
// its offset by the LIMIT rather than by what came back, and PAGE_CAP_SUSPECT
// in hub-exit.js is "50 pages of 100". Changing this number would silently skip
// records there.
export const LGL_PAGE_SIZE = 100;

// The deep walk asks for more, and it is the reason a backfill is minutes
// rather than hours. A 100-row page measured 2.4 seconds against live LGL on
// 2026-08-22 (1,750 records in 42 seconds, from the hub-exit log line), which is
// almost entirely round trip rather than rows. The whole gift database is about
// 63,000 records, so at 100 a full-depth walk is over four hours of waiting for
// HTTP, and the 60-second budget per request could never converge on it.
//
// LGL's maximum page size is NOT documented anywhere this repo can reach, so
// this is a request rather than a fact, and the walk is written so that being
// wrong about it is harmless in BOTH directions. If LGL quietly serves fewer
// rows than asked for, the walk measures what it actually got and keeps going.
// If LGL refuses the limit outright, the first page is retried at 100 and the
// walk behaves exactly as it did before.
export const LGL_DEEP_PAGE_SIZE = 1000;

// ─── Rate limits: an assumption, not a fact ───
//
// Little Green Light publishes a rate limit that nobody on this project has
// verified, and until now nothing in this repo handled one at all: any non-2xx
// threw on the first answer. For the dashboard that meant a failed top-up. For
// the hub exit it meant a week with no giving number in it, from one throttled
// page out of a hundred.
//
// So the modest assumption is made here and written down as an assumption: that
// a limit arrives as HTTP 429, possibly carrying Retry-After in seconds. A 429
// or a 5xx is retried a couple of times with a short backoff. Anything else
// still throws on the first answer, because a 400 will not become a 200 on the
// third ask, and retrying a rejected query is exactly the behaviour that would
// hammer LGL over a typo.
export const LGL_PAGE_ATTEMPTS = 3;
export const LGL_RETRY_BASE_MS = 1000;
export const LGL_RETRY_MAX_MS = 8000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Read at call time rather than at import time so a test can set it, and so the
// key is never captured into a closure at module load.
function apiKey() {
  return process.env.LGL_API_KEY || "";
}

// One page. Returns the rows and LGL's own count of how many rows the whole
// query has, which is the only thing that lets a caller prove it reached the
// end rather than guess from how much came back.
export async function fetchLGLGiftPage(queryTerm, offset, deadline = null,
                                      limit = LGL_PAGE_SIZE) {
  const params = new URLSearchParams();
  params.append("q[]", queryTerm);
  params.append("limit", String(limit));
  params.append("offset", String(offset));
  const url = `${LGL_API_BASE}/gifts/search.json?${params}`;

  let wait = LGL_RETRY_BASE_MS;
  for (let attempt = 1; ; attempt++) {
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${apiKey()}` } });
    if (resp.ok) {
      const data = await resp.json();
      const total = Number(data && data.total_items);
      return {
        items: (data && data.items) || [],
        totalItems: Number.isFinite(total) ? total : null,
      };
    }

    const body = await resp.text();
    const retryable = resp.status === 429 || resp.status >= 500;
    if (!retryable || attempt >= LGL_PAGE_ATTEMPTS) {
      throw new Error(`LGL API ${resp.status}: ${String(body).slice(0, 200)}`);
    }

    const header = Number(resp.headers && resp.headers.get
      ? resp.headers.get("retry-after") : NaN);
    const asked = Number.isFinite(header) && header > 0 ? header * 1000 : wait;
    const pause = Math.min(asked, LGL_RETRY_MAX_MS);

    // A retry spends the caller's time budget like anything else does. Sleeping
    // past the deadline would hand the hub a socket timeout instead of an
    // explained refusal, which reads as "the service is down".
    if (deadline !== null && Date.now() + pause >= deadline) {
      throw new Error(`LGL API ${resp.status}: no time left in the read budget to retry`);
    }
    await sleep(pause);
    wait = Math.min(wait * 2, LGL_RETRY_MAX_MS);
  }
}

// ─── The walk that knows whether it finished ───
//
// Every stop is reported rather than implied. `complete` is true only when the
// end of the result set was reached, and the three ceilings exist so that one
// malformed request cannot turn into an unbounded loop against somebody else's
// API. A caller that gets complete: false has NOT been handed all the rows and
// must not sum them as though it had.
//
// `onPage` is called after every page that lands, so a caller can keep what it
// already has when a later page throws. Without it a transient failure on page
// ninety throws away eighty-nine pages LGL has already served, and the retry
// asks for all of them again.
export async function fetchLGLApiGiftsPaged(queryTerm, opts = {}) {
  const {
    startOffset = 0,
    maxRecords = Infinity,
    maxPages = Infinity,
    deadline = null,
    onPage = null,
    pageSize = LGL_DEEP_PAGE_SIZE,
    // Injected so a test can decide when time passes. hub-exit.js already takes
    // one for the same reason: a budget test that races the real clock fails on
    // a Tuesday when the machine is busy, and a suite nobody trusts is worse
    // than no suite.
    clock = Date.now,
  } = opts || {};

  let offset = startOffset;
  let totalItems = null;
  let pages = 0;
  let stoppedBy = "end";
  let limit = pageSize;
  // What LGL ACTUALLY hands back for a full page, learned from the first one.
  // Not the same thing as what was asked for, and the difference is the whole
  // reason this variable exists. See the short-page rule below.
  let served = null;

  for (;;) {
    if (pages >= maxPages) { stoppedBy = "pages"; break; }
    if (offset - startOffset >= maxRecords) { stoppedBy = "records"; break; }
    if (deadline !== null && clock() >= deadline) { stoppedBy = "budget"; break; }

    let page;
    try {
      page = await fetchLGLGiftPage(queryTerm, offset, deadline, limit);
    } catch (err) {
      // ONE retry, and only with positive evidence that the PAGE SIZE is what
      // was refused. "A rejected query must not be asked again" is an invariant
      // of this file with its own test: a 400 will not become a 200 on the
      // second ask, and re-asking is how a typo turns into hammering somebody
      // else's API. A larger page is a different request rather than the same
      // one, but only if the rejection was actually about the limit, so that
      // has to be read out of the message rather than assumed from the timing.
      //
      // ASSUMPTION: that LGL says "limit" when it refuses one. If it refuses a
      // page of a thousand in words that do not, this throws instead, the read
      // fails, and the cron goes red and says so. That is the loud direction.
      const aboutTheLimit = /\blimit\b/i.test(err && err.message);
      if (pages > 0 || limit === LGL_PAGE_SIZE || !aboutTheLimit) throw err;
      console.warn(`[lgl-api] LGL refused a page of ${limit} (${err.message}), ` +
                   `falling back to ${LGL_PAGE_SIZE} for this walk`);
      limit = LGL_PAGE_SIZE;
      page = await fetchLGLGiftPage(queryTerm, offset, deadline, limit);
    }
    pages += 1;
    if (page.totalItems !== null) totalItems = page.totalItems;
    offset += page.items.length;
    if (served === null && page.items.length > 0) served = page.items.length;
    if (onPage) onPage(page.items, offset, totalItems);

    // THE END, PROVED THREE WAYS, in the order they can be trusted.
    //
    // LGL's own total is the honest one. An empty page is the backstop that
    // stops this loop spinning if the others ever disagree with reality:
    // without it, an API answering zero rows forever at a live offset would
    // page until the ceiling.
    //
    // A SHORT PAGE IS THE DANGEROUS ONE, and it is the last resort now rather
    // than a peer of the other two. It is consulted only when LGL has stopped
    // sending a total, and it is measured against what LGL actually SERVED
    // rather than against what was asked for. Measured against the request, a
    // server that silently caps pages at 100 while being asked for 1,000 makes
    // every page short, so the walk would stop after the first one and report a
    // COMPLETE read of a hundredth of the result set. That is the exact failure
    // this module exists to prevent, arriving through the door marked "the end".
    if (page.items.length === 0) break;
    if (totalItems !== null && offset >= totalItems) break;
    if (totalItems === null && served !== null && page.items.length < served) break;
  }

  return { complete: stoppedBy === "end", offset, totalItems, pages, stoppedBy, served };
}

// ─── The original walk, unchanged on purpose ───
//
// The hybrid endpoint, the recent-gifts top-up and the plate-status detector all
// call this, and PAGE_CAP_SUSPECT in hub-exit.js is the count this loop can
// return at full stretch: 50 pages of 100. Changing either number without the
// other would make the plate detector's "cannot tell" threshold wrong, so this
// is left exactly as it was. The only difference is that a throttled page now
// gets retried instead of failing the whole read.
export async function fetchLGLApiGiftsAxis(queryTerm) {
  const gifts = [];
  let offset = 0;
  const limit = LGL_PAGE_SIZE;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    const { items, totalItems } = await fetchLGLGiftPage(queryTerm, offset);
    gifts.push(...items);
    if (offset + items.length >= (totalItems || 0)) break;
    offset += limit;
  }
  return gifts;
}
