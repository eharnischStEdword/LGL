// ─── The deep read: paging, and the refusals that guard it ───
//
// The hub asked this exit for a week in August 2025 and got a 502 every time,
// because updated_from reaches back before the window and LGL then hands back
// every record touched since, which is thirteen months of gifts. The old walk
// stopped at 50 pages and the exit refused anything that size rather than
// publish a total that might be short. It was right to refuse. It just never
// got the rest of the pages.
//
// These tests drive the REAL paging loop in lgl-api.js and the REAL exit in
// hub-exit.js against a stubbed HTTP layer. Nothing here touches Little Green
// Light and nothing here needs an API key. What is stubbed is exactly one
// thing: the answers LGL gives.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { hubMetricsHandler, MAX_RECORDS, _resetDump } from "../hub-exit.js";
import {
  fetchLGLApiGiftsPaged, LGL_PAGE_SIZE, LGL_DEEP_PAGE_SIZE,
} from "../lgl-api.js";

const TOKEN = "test-hub-token-do-not-use-anywhere-real";
const FROM = "2025-08-11";
const TO = "2025-08-17";
const RANGE = `?from=${FROM}&to=${TO}`;

// A week in August 2025, which is the exact request the hub could not get an
// answer to and the reason the "vs a year ago" tile reads no match.
const IN_WINDOW = 50;
const OUT_OF_WINDOW = 400;

// Every in-window gift is $10.00 of plate money, so the right answer is a
// number this file can state rather than compute the same way the code does.
const EXPECTED_PLATE_CENTS = IN_WINDOW * 1000;

function buildGifts() {
  const gifts = [];
  // The thirteen months of older records that updated_from drags along. They
  // are Offertory and they are plate money, so if any of them leaked into the
  // window the total would be wrong in the direction that matters.
  for (let i = 0; i < OUT_OF_WINDOW; i++) {
    gifts.push({
      id: 10000 + i, fund_name: "Offertory", received_date: "2025-03-02",
      received_amount: 99.99, payment_type_name: "Cash",
    });
  }
  for (let i = 0; i < IN_WINDOW; i++) {
    gifts.push({
      id: 20000 + i, fund_name: "Offertory", received_date: "2025-08-13",
      received_amount: 10.00, payment_type_name: "Check",
    });
  }
  return gifts;
}

// ─── The stubbed LGL ───
//
// Answers gifts/search.json the way the live API does: a page of items and a
// total_items count for the whole query. gift_date_from is rejected with the
// 400 the live API actually returns, because a test where the second axis works
// would be testing a world this parish does not live in.
function fakeLGL({ gifts, totalItems = null, requests = [],
                   delayMs = 0, pageOverride = null } = {}) {
  const total = totalItems === null ? gifts.length : totalItems;
  return async (url) => {
    const u = new URL(String(url));
    const term = u.searchParams.get("q[]");
    const offset = Number(u.searchParams.get("offset"));
    const limit = Number(u.searchParams.get("limit"));
    requests.push({ term, offset });

    if (term.startsWith("gift_date_from")) {
      return new Response("Unknown query parameter: gift_date_from",
        { status: 400 });
    }
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));

    const items = pageOverride ? pageOverride(offset, limit)
      : gifts.slice(offset, offset + limit);
    return Response.json({ items, total_items: total });
  };
}

function withFakeLGL(fake, run) {
  const real = globalThis.fetch;
  globalThis.fetch = fake;
  return Promise.resolve().then(run).finally(() => { globalThis.fetch = real; });
}

// The same wiring server.js uses, with the paged walk the hub exit now drives.
function makeApp(readOpts) {
  _resetDump();
  const app = express();
  app.get("/api/hub/v1/metrics", hubMetricsHandler({
    fetchGiftsAxis: fetchLGLApiGiftsPaged,
    hasApiKey: () => true,
    readOpts,
  }));
  return app;
}

async function serve(app, run) {
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise((r) => server.close(r));
  }
}

function get(base, path) {
  return fetch(base + path, { headers: { Authorization: `Bearer ${TOKEN}` } });
}

const plateOf = (body) =>
  Object.fromEntries(body.metrics.map((m) => [m.key, m.value]))["giving.lgl_plate"];

const updatedFromCalls = (requests) =>
  requests.filter((r) => r.term.startsWith("updated_from"));

test("a week in 2025 is paged through instead of refused", async () => {
  process.env.HUB_EXIT_TOKEN = TOKEN;
  const requests = [];
  const gifts = buildGifts();
  const app = makeApp({ pageSize: 100 });

  // globalThis.fetch is the stub for the OUTBOUND LGL call and for this test's
  // own inbound request, so the app is served inside the swap and the stub
  // passes anything that is not an LGL URL to the real implementation.
  const real = globalThis.fetch;
  const lgl = fakeLGL({ gifts, requests });
  globalThis.fetch = (url, init) =>
    String(url).includes("littlegreenlight.com") ? lgl(url) : real(url, init);
  try {
    await serve(app, async (base) => {
      const resp = await get(base, "/api/hub/v1/metrics" + RANGE);
      assert.equal(resp.status, 200, "the deep read must not be refused any more");
      const body = await resp.json();

      // 450 records, of which 50 are in the window. Getting this number right
      // is the whole point: a walk that stopped at the old cap would have
      // reported a smaller one and looked exactly as confident.
      assert.equal(plateOf(body), EXPECTED_PLATE_CENTS);
      assert.equal(body.freshness.records_in_period, IN_WINDOW);
      const signals = Object.fromEntries(
        body.freshness.signals.map((s) => [s.key, s.value]));
      assert.equal(signals.capped, 0);
    });
  } finally {
    globalThis.fetch = real;
  }

  // Five pages of a hundred, walked in order, and every one of them asked for.
  const walked = updatedFromCalls(requests);
  assert.equal(walked.length, Math.ceil(gifts.length / LGL_PAGE_SIZE));
  assert.deepEqual(walked.map((r) => r.offset), [0, 100, 200, 300, 400]);
});

test("a walk that stops short refuses, and the next request finishes it", async () => {
  // This is the property the whole change turns on. A read that could not
  // reach the end must not be summed, and the refusal must not throw away the
  // pages LGL already served or the deep week never lands at all.
  process.env.HUB_EXIT_TOKEN = TOKEN;
  const requests = [];
  const gifts = buildGifts();
  // Mutated between the two requests, which is how one app serves a bounded
  // walk and then an unbounded one.
  const readOpts = { maxPages: 2, pageSize: 100 };
  const app = makeApp(readOpts);

  const real = globalThis.fetch;
  const lgl = fakeLGL({ gifts, requests });
  globalThis.fetch = (url, init) =>
    String(url).includes("littlegreenlight.com") ? lgl(url) : real(url, init);
  try {
    await serve(app, async (base) => {
      const first = await get(base, "/api/hub/v1/metrics" + RANGE);
      assert.equal(first.status, 502, "a short walk must not answer with a total");
      const body = await first.text();
      assert.ok(!body.includes("giving.lgl_plate"), "a refusal carried metrics");
      assert.match(JSON.parse(body).error, /did not reach the end/);

      delete readOpts.maxPages;
      const second = await get(base, "/api/hub/v1/metrics" + RANGE);
      assert.equal(second.status, 200);
      // THE FULL total, not the part that fitted in the first request.
      assert.equal(plateOf(await second.json()), EXPECTED_PLATE_CENTS);
    });
  } finally {
    globalThis.fetch = real;
  }

  const walked = updatedFromCalls(requests);
  // Resumed, not restarted: five pages across the two requests, and the second
  // request picked up at offset 200 rather than asking LGL for the first two
  // pages all over again.
  assert.deepEqual(walked.map((r) => r.offset), [0, 100, 200, 300, 400]);
});

test("a query past the record ceiling is refused after one request, not after two hundred and fifty", async () => {
  process.env.HUB_EXIT_TOKEN = TOKEN;
  const requests = [];
  const gifts = buildGifts();
  const app = makeApp({ maxRecords: 250, pageSize: 100 });

  const real = globalThis.fetch;
  // LGL says the query has far more records than the ceiling allows. The walk
  // learns that on the first page, which is the reason the ceiling is cheap to
  // be wrong about.
  const lgl = fakeLGL({ gifts, totalItems: 100000, requests });
  globalThis.fetch = (url, init) =>
    String(url).includes("littlegreenlight.com") ? lgl(url) : real(url, init);
  try {
    await serve(app, async (base) => {
      const resp = await get(base, "/api/hub/v1/metrics" + RANGE);
      assert.equal(resp.status, 502);
      assert.match((await resp.json()).error, /more records than this exit will read/);
    });
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(updatedFromCalls(requests).length, 1,
    "the ceiling should cost one page, not the whole walk");
});

test("a gift served on two pages is counted once", async () => {
  // Offset paging over a list that is being written to can hand the same record
  // back twice. Counting it twice would overstate a Sunday, which is the same
  // sin as understating one.
  process.env.HUB_EXIT_TOKEN = TOKEN;
  const one = { id: 777, fund_name: "Offertory", received_date: "2025-08-13",
                received_amount: 25.00, payment_type_name: "Cash" };
  const requests = [];
  const app = makeApp({ pageSize: 100 });

  const real = globalThis.fetch;
  const lgl = fakeLGL({
    gifts: [], totalItems: 150, requests,
    // Page one is a hundred rows ending in gift 777; page two is fifty rows
    // starting with gift 777 again, the shape a shifted result set produces.
    pageOverride: (offset) => (offset === 0
      ? [...Array.from({ length: 99 }, (unused, i) => ({
          id: i, fund_name: "Building Fund", received_date: "2025-08-13",
          received_amount: 5, payment_type_name: "Cash" })), one]
      : [one, ...Array.from({ length: 49 }, (unused, i) => ({
          id: 500 + i, fund_name: "Building Fund", received_date: "2025-08-13",
          received_amount: 5, payment_type_name: "Cash" }))]),
  });
  globalThis.fetch = (url, init) =>
    String(url).includes("littlegreenlight.com") ? lgl(url) : real(url, init);
  try {
    await serve(app, async (base) => {
      const body = await (await get(base, "/api/hub/v1/metrics" + RANGE)).json();
      assert.equal(plateOf(body), 2500, "the repeated gift was counted twice");
      assert.equal(body.freshness.records_in_period, 1);
    });
  } finally {
    globalThis.fetch = real;
  }
});

test("the ceiling in the shipped configuration is above the whole gift database", () => {
  // THIS TEST USED TO PASS WHILE THE THING IT GUARDS WAS BROKEN, which is worth
  // more than the assertion. It multiplied 445 days by the gift rate from the
  // historical import, got about 14,000, and concluded that a ceiling of 25,000
  // was comfortable. Meanwhile the 2026-08-22 backfill was refused on that
  // ceiling for 65 of 79 weeks, out to a week whose query reached back only four
  // months.
  //
  // The rate was never what mattered. `updated_from` selects on when a record
  // was last TOUCHED, so one bulk edit inside LGL restamps everything it touches
  // and every query reaching past that day returns all of it at once. There is
  // no rate that predicts that, and the only honest bound is the size of the
  // database: an updated_from query cannot return more rows than LGL holds.
  // MEASURED, not reasoned, and the first two attempts at this number were both
  // reasoned and both wrong. 25,000 came from a gift rate. 75,000 came from the
  // 63,000 in CLAUDE.md, which was the historical import through December 2024
  // with two years missing off the end. The live refusal log gave the real one:
  // "LGL reports 80152 records for this query", 2026-08-22.
  const measuredDeepestQuery = 80152;
  assert.ok(MAX_RECORDS > measuredDeepestQuery * 1.5,
    "the ceiling must clear the deepest query LGL has actually reported, with " +
    "room for the database to grow, because one bulk edit inside LGL can make " +
    "a single query ask for all of it");
});

test("the deep walk asks LGL for a page far bigger than the legacy 100", () => {
  // A 100-row page measured 2.4 seconds against live LGL. The whole database is
  // about 63,000 records, so at 100 a full-depth walk is over four hours of
  // round trips and the 60-second budget can never converge on it. This is the
  // number that makes a backfill finish, so a silent revert of it should fail
  // here rather than be discovered by a cron that runs all morning.
  assert.ok(LGL_DEEP_PAGE_SIZE >= 500,
    `a deep page of ${LGL_DEEP_PAGE_SIZE} puts a full backfill back into hours`);
  assert.equal(LGL_PAGE_SIZE, 100,
    "the legacy walk advances its offset by the LIMIT, so its page size must " +
    "not move: PAGE_CAP_SUSPECT is 50 pages of 100");
});

test("a server that quietly caps the page does not end the walk early", async () => {
  // THE DANGEROUS ONE. Asking for 1,000 and being served 100 makes every page
  // short. Judged against what was ASKED for, the first page looks like the end
  // of the results and the walk reports a COMPLETE read of a tenth of them:
  // a short total wearing the word "complete", which is the single failure this
  // module exists to prevent.
  const gifts = buildGifts();          // 450
  const requests = [];
  await withFakeLGL(fakeLGL({
    gifts, requests,
    pageOverride: (offset, limit) => gifts.slice(offset, offset + Math.min(limit, 100)),
  }), async () => {
    const result = await fetchLGLApiGiftsPaged("updated_from=2025-06-27",
      { pageSize: 1000 });
    assert.equal(result.complete, true);
    assert.equal(result.offset, gifts.length, "every record, not just the first page");
    assert.equal(result.served, 100, "the walk measured what it was actually given");
    assert.ok(updatedFromCalls(requests).length >= 5,
      "it kept paging at the size the server was willing to serve");
  });
});

test("a page size LGL refuses drops to 100 and the walk still finishes", async () => {
  let asked = [];
  await withFakeLGL(async (url) => {
    const u = new URL(String(url));
    const limit = Number(u.searchParams.get("limit"));
    const offset = Number(u.searchParams.get("offset"));
    asked.push(limit);
    if (limit > 100) {
      return new Response("limit must be between 1 and 100", { status: 400 });
    }
    const gifts = buildGifts();
    return Response.json({ items: gifts.slice(offset, offset + limit),
                           total_items: gifts.length });
  }, async () => {
    const result = await fetchLGLApiGiftsPaged("updated_from=2025-06-27",
      { pageSize: 1000 });
    assert.equal(result.complete, true, "a refused page size must not lose the read");
    assert.equal(result.offset, 450);
    assert.equal(asked[0], 1000, "it tried the big page first");
    assert.equal(asked[1], 100, "and dropped straight to the size that works");
  });
});

// ─── The paging loop on its own ───

test("the wall clock stops the walk, and says so rather than lying about it", async () => {
  const gifts = buildGifts();
  const requests = [];
  // A HAND-CRANKED CLOCK, not the real one. This test used to set a deadline 20
  // real milliseconds out and hope the machine got two pages done inside it; it
  // failed once on a busy laptop on 2026-08-22, which is exactly the kind of
  // failure that teaches people to re-run a suite instead of reading it. Time
  // moves 10ms per look now, so the third check is past the deadline, always.
  let ticks = 0;
  const clock = () => 1000 + (ticks++ * 10);
  await withFakeLGL(fakeLGL({ gifts, requests }), async () => {
    const result = await fetchLGLApiGiftsPaged("updated_from=2025-06-27",
      { deadline: 1025, pageSize: 100, clock });
    assert.equal(result.complete, false, "an unfinished walk must not claim to be finished");
    assert.equal(result.stoppedBy, "budget");
    assert.ok(result.pages >= 1 && result.pages < 5,
      `expected the clock to stop the walk part way, got ${result.pages} pages`);
    assert.equal(result.totalItems, gifts.length);
  });
});

test("completeness comes from LGL's own count, not from how much came back", async () => {
  const requests = [];
  await withFakeLGL(fakeLGL({ gifts: buildGifts(), requests }), async () => {
    const result = await fetchLGLApiGiftsPaged("updated_from=2025-06-27");
    assert.equal(result.complete, true);
    assert.equal(result.stoppedBy, "end");
    assert.equal(result.offset, 450);
    assert.equal(result.totalItems, 450);
  });
});

test("a walk with no total to go on ends on a short page", async () => {
  // The fallback for the day LGL stops sending total_items. A page smaller than
  // the one that was asked for is the end of the list.
  await withFakeLGL(async (url) => {
    const offset = Number(new URL(String(url)).searchParams.get("offset"));
    const items = offset === 0
      ? Array.from({ length: LGL_PAGE_SIZE }, (unused, i) => ({ id: i }))
      : [{ id: 999 }];
    return Response.json({ items });
  }, async () => {
    const result = await fetchLGLApiGiftsPaged("updated_from=2025-06-27");
    assert.equal(result.complete, true);
    assert.equal(result.offset, LGL_PAGE_SIZE + 1);
    assert.equal(result.totalItems, null);
  });
});

test("a throttled page is retried and a rejected one is not", async () => {
  // ASSUMPTION under test, not a verified fact about LGL: that a rate limit
  // arrives as 429 with Retry-After in seconds. The fractional value here is a
  // test convenience so the suite does not sleep a whole second.
  let attempts = 0;
  await withFakeLGL(async (url) => {
    attempts++;
    if (attempts === 1) {
      return new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } });
    }
    return Response.json({ items: [{ id: 1 }], total_items: 1 });
  }, async () => {
    const result = await fetchLGLApiGiftsPaged("updated_from=2025-06-27");
    assert.equal(result.complete, true);
    assert.equal(attempts, 2, "the throttled page should have been asked for twice");
  });

  let rejected = 0;
  await withFakeLGL(async () => {
    rejected++;
    return new Response("Unknown query parameter", { status: 400 });
  }, async () => {
    await assert.rejects(() => fetchLGLApiGiftsPaged("gift_date_from=2025-06-27"),
      /LGL API 400/);
    assert.equal(rejected, 1, "a rejected query must not be asked again");
  });
});

// ─── The thing Eric actually asked for ───

test("a thirteen week backfill of 2025 makes one walk and answers every week", async () => {
  // This is the failure in one test. The hub walked thirteen weeks of 2025
  // oldest first, each one asked LGL for everything touched since 45 days
  // before its own Monday, and every single one came back 502. The hub recorded
  // nothing, so it holds about twelve weeks of giving and the dashboard's "vs a
  // year ago" tile reads no match, correctly.
  process.env.HUB_EXIT_TOKEN = TOKEN;

  const WEEKS = 13;
  const PER_WEEK = 10;
  const GIFT = 20.00;
  // Roughly the size of the real thirteen month dump: about 175 Offertory gifts
  // a week is what the hub's own source_reads recorded, and the dump carries
  // every fund, not just Offertory. NOT a measurement, a plausible scale.
  const NOISE = 9900 - WEEKS * PER_WEEK;

  const day = (d) => d.toISOString().slice(0, 10);
  const weeks = [];
  // Thirteen Mon-Sun weeks ending on consecutive Sundays, oldest first, which
  // is the order fetch_sources walks a backfill.
  const lastSunday = new Date(Date.UTC(2025, 7, 17));
  for (let i = WEEKS - 1; i >= 0; i--) {
    const end = new Date(lastSunday);
    end.setUTCDate(end.getUTCDate() - 7 * i);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - 6);
    weeks.push({ from: day(start), to: day(end) });
  }

  const gifts = [];
  for (let i = 0; i < NOISE; i++) {
    gifts.push({ id: 100000 + i, fund_name: "Building Fund",
      received_date: "2025-02-09", received_amount: 5, payment_type_name: "Cash" });
  }
  weeks.forEach((w, wi) => {
    const wednesday = new Date(`${w.from}T00:00:00Z`);
    wednesday.setUTCDate(wednesday.getUTCDate() + 2);
    for (let i = 0; i < PER_WEEK; i++) {
      gifts.push({ id: 900000 + wi * 100 + i, fund_name: "Offertory",
        received_date: day(wednesday), received_amount: GIFT,
        payment_type_name: "Check" });
    }
  });

  const requests = [];
  const app = makeApp({ pageSize: 100 });
  const real = globalThis.fetch;
  const lgl = fakeLGL({ gifts, requests });
  globalThis.fetch = (url, init) =>
    String(url).includes("littlegreenlight.com") ? lgl(url) : real(url, init);
  try {
    await serve(app, async (base) => {
      for (const w of weeks) {
        const resp = await get(base, `/api/hub/v1/metrics?from=${w.from}&to=${w.to}`);
        assert.equal(resp.status, 200, `week ${w.to} was refused`);
        const body = await resp.json();
        assert.equal(plateOf(body), PER_WEEK * GIFT * 100,
          `week ${w.to} reported the wrong plate total`);
        assert.equal(body.period.from, w.from);
        assert.equal(body.period.to, w.to);
      }
    });
  } finally {
    globalThis.fetch = real;
  }

  // Ninety-nine pages once, not ninety-nine pages thirteen times. The dump the
  // oldest week pulled reaches back further than every later week needs, so the
  // other twelve are answered without asking LGL anything at all.
  const walked = updatedFromCalls(requests);
  assert.equal(walked.length, Math.ceil(gifts.length / LGL_PAGE_SIZE));
  assert.equal(new Set(walked.map((r) => r.term)).size, 1,
    "the backfill started more than one walk");
});
