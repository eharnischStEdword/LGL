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

// 100 rows is what this repo has always asked LGL for. It is NOT known to be
// the maximum: nothing here has ever tried a larger page, so raising it is a
// live experiment rather than a tuning knob.
export const LGL_PAGE_SIZE = 100;

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
export async function fetchLGLGiftPage(queryTerm, offset, deadline = null) {
  const params = new URLSearchParams();
  params.append("q[]", queryTerm);
  params.append("limit", String(LGL_PAGE_SIZE));
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
  } = opts || {};

  let offset = startOffset;
  let totalItems = null;
  let pages = 0;
  let stoppedBy = "end";

  for (;;) {
    if (pages >= maxPages) { stoppedBy = "pages"; break; }
    if (offset - startOffset >= maxRecords) { stoppedBy = "records"; break; }
    if (deadline !== null && Date.now() >= deadline) { stoppedBy = "budget"; break; }

    const page = await fetchLGLGiftPage(queryTerm, offset, deadline);
    pages += 1;
    if (page.totalItems !== null) totalItems = page.totalItems;
    offset += page.items.length;
    if (onPage) onPage(page.items, offset, totalItems);

    // THE END, PROVED THREE WAYS, in the order they can be trusted.
    //
    // LGL's own total is the honest one. A short page is the ordinary fallback
    // for the day LGL stops sending total_items. An empty page is the backstop
    // that stops this loop spinning if the other two ever disagree with
    // reality: without it, an API that answered zero rows forever at a live
    // offset would page until the ceiling.
    if (page.items.length === 0) break;
    if (totalItems !== null && offset >= totalItems) break;
    if (page.items.length < LGL_PAGE_SIZE) break;
  }

  return { complete: stoppedBy === "end", offset, totalItems, pages, stoppedBy };
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
