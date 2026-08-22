// The plate-status detector: has the Sunday basket count reached LGL yet?
//
// This is the evidence that overrides the v2 dashboard's calendar rule, so a
// wrong answer here marks a week final while its giving figure is still short.
// The regression that started this file: the detector asked LGL for
// `gift_date_from`, LGL answers 400 Unknown query parameter, the catch turned
// that into "cannot tell", and the evidence path was silently dead from at
// least 2026-08-17. The first test below is the one that would have caught it.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import { plateStatusHandler, detectPlate, weekWindow } from "../plate-status.js";
import { _resetDump } from "../hub-exit.js";

const START = "2026-08-10"; // Monday
const WEEK = "2026-08-16";  // the Sunday that names the week

// Cash and check are plate money. eCheck and Cash App contain the letters and
// are not. A gift with no payment type says nothing either way.
const GIFTS = [
  { id: 1, fund_name: "Offertory", received_date: "2026-08-16", received_amount: 100, payment_type_name: "Cash" },
  { id: 2, fund_name: "Offertory", received_date: "2026-08-14", received_amount: 40, payment_type_name: "Credit Card" },
];
const ONLINE_ONLY = [
  { id: 3, fund_name: "Offertory", received_date: "2026-08-14", received_amount: 40, payment_type_name: "E-Check (ACH)" },
  { id: 4, fund_name: "Offertory", received_date: "2026-08-15", received_amount: 10, payment_type_name: "Cash App" },
];

const paged = (gifts) => ({
  items: gifts,
  offset: gifts.length,
  totalItems: gifts.length,
  complete: true,
  pages: 1,
  stoppedBy: "end",
});

function makeApp({ gifts = GIFTS, hasApiKey = true, calls = [], result = null,
                   throws = null, cache = {} } = {}) {
  _resetDump();
  const app = express();
  app.get("/api/lgl-plate-status", plateStatusHandler({
    fetchGiftsPaged: async (term) => {
      calls.push(term);
      if (throws && term.startsWith("updated_from")) throw new Error(throws);
      // The live API rejects gift_date_from. The shared read probes it once and
      // swallows the failure; stubbing that faithfully keeps this suite honest.
      if (term.startsWith("gift_date_from")) {
        throw new Error("LGL API 400: Unknown query parameter: gift_date_from");
      }
      return result || paged(gifts);
    },
    hasApiKey: () => hasApiKey,
    cache,
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

const ask = (base, week = WEEK) =>
  fetch(`${base}/api/lgl-plate-status?week=${week}`).then((r) => r.json());

test("the read asks LGL on updated_from, the axis it actually accepts", async () => {
  const calls = [];
  await serve(makeApp({ calls }), async (base) => {
    const json = await ask(base);
    assert.equal(json.week, WEEK);
    // The defect this file exists for: the FIRST thing asked must not be the
    // key LGL rejects, or every answer is "cannot tell".
    assert.match(calls[0], /^updated_from=/);
    assert.equal(json.plateLanded, true);
  });
});

test("the updated_from query reaches back before the week, not to its Monday", async () => {
  const calls = [];
  await serve(makeApp({ calls }), async (base) => {
    await ask(base);
    const since = calls[0].split("=")[1];
    // ENTRY_LOOKBACK_DAYS is 45; anything at or after the Monday would miss a
    // gift entered ahead of the day it was received.
    assert.ok(since < START, `expected a lookback before ${START}, got ${since}`);
  });
});

test("cash in the week means the count has landed", async () => {
  await serve(makeApp(), async (base) => {
    assert.equal((await ask(base)).plateLanded, true);
  });
});

test("online-only giving means the count has NOT landed yet", async () => {
  await serve(makeApp({ gifts: ONLINE_ONLY }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, false);
    assert.equal(json.giftCount, 2);
  });
});

test("cash to another fund is not the Offertory plate", async () => {
  const gifts = [
    { id: 5, fund_name: "Building Fund", received_date: "2026-08-16", received_amount: 999, payment_type_name: "Cash" },
    { id: 6, fund_name: "Offertory", received_date: "2026-08-16", received_amount: 50, payment_type_name: "Credit Card" },
  ];
  await serve(makeApp({ gifts }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, false);
    assert.equal(json.giftCount, 1, "only the Offertory gift is in the count");
  });
});

test("gifts outside the week are ignored", async () => {
  const gifts = [
    { id: 7, fund_name: "Offertory", received_date: "2026-08-09", received_amount: 100, payment_type_name: "Cash" },
    { id: 8, fund_name: "Offertory", received_date: "2026-08-17", received_amount: 100, payment_type_name: "Cash" },
    { id: 9, fund_name: "Offertory", received_date: "2026-08-13", received_amount: 20, payment_type_name: "Credit Card" },
  ];
  await serve(makeApp({ gifts }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, false);
    assert.equal(json.giftCount, 1);
  });
});

test("no payment types at all is 'cannot tell', not 'no plate yet'", async () => {
  const gifts = [{ id: 10, fund_name: "Offertory", received_date: "2026-08-16", received_amount: 100 }];
  await serve(makeApp({ gifts }), async (base) => {
    assert.equal((await ask(base)).plateLanded, null);
  });
});

test("an empty week is 'cannot tell', because nothing has been read into it", async () => {
  await serve(makeApp({ gifts: [] }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, null);
    assert.equal(json.giftCount, 0);
  });
});

test("a read that did not finish is null, never false", async () => {
  const partial = {
    items: ONLINE_ONLY,
    offset: 2,
    totalItems: 900,
    complete: false,
    pages: 1,
    stoppedBy: "budget",
  };
  await serve(makeApp({ result: partial }), async (base) => {
    const json = await ask(base);
    // Half a week with no plate money in it is not evidence that no plate money
    // exists. Answering false here would publish a short total as final.
    assert.equal(json.plateLanded, null);
    assert.ok(json.error, "the refusal says why");
  });
});

test("an LGL failure falls back rather than guessing", async () => {
  await serve(makeApp({ throws: "LGL API 503: upstream" }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, null);
    assert.match(json.error, /503/);
  });
});

test("no API key says so and answers null", async () => {
  const calls = [];
  await serve(makeApp({ hasApiKey: false, calls }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, null);
    assert.match(json.message, /LGL_API_KEY/);
    assert.equal(calls.length, 0, "and never dials LGL without one");
  });
});

test("a second ask inside the TTL is served from the cache", async () => {
  const calls = [];
  const cache = {};
  await serve(makeApp({ calls, cache }), async (base) => {
    const first = await ask(base);
    const second = await ask(base);
    assert.deepEqual(second, first);
    assert.equal(calls.filter((c) => c.startsWith("updated_from")).length, 1);
  });
});

// ─── The pieces, without a server ───

test("detectPlate: the judgement is Offertory, in the week, with a type", () => {
  const mixed = [
    { fund_name: "Offertory", received_date: "2026-08-16", payment_type: { name: "Check" } },
    { fund_name: "Building Fund", received_date: "2026-08-16", payment_type_name: "Cash" },
    { fund_name: "Offertory", received_date: "2026-08-01", payment_type_name: "Cash" },
  ];
  const out = detectPlate(mixed, START, WEEK);
  assert.equal(out.plateLanded, true);
  assert.equal(out.giftCount, 1);
  assert.deepEqual(out.types, ["Check"]);
});

test("detectPlate: a gift with no received_date is not in anybody's week", () => {
  const out = detectPlate([{ fund_name: "Offertory", payment_type_name: "Cash" }], START, WEEK);
  assert.equal(out.giftCount, 0);
  assert.equal(out.plateLanded, null);
});

test("weekWindow: the week the client names wins", () => {
  assert.deepEqual(weekWindow(WEEK), { startKey: START, weekKey: WEEK });
});

test("weekWindow: without a week it takes the newest ENDED Sunday", () => {
  // Wednesday 2026-08-19 -> the week that ended Sunday 2026-08-16.
  assert.deepEqual(weekWindow(null, new Date(2026, 7, 19)),
    { startKey: START, weekKey: WEEK });
  // On a Sunday, that Sunday is the newest ended week.
  assert.deepEqual(weekWindow("", new Date(2026, 7, 16)),
    { startKey: START, weekKey: WEEK });
});

test("weekWindow: a malformed week param falls back rather than throwing", () => {
  assert.deepEqual(weekWindow("last-week", new Date(2026, 7, 19)),
    { startKey: START, weekKey: WEEK });
});
