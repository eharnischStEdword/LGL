// The plate-status detector: has the Sunday basket count reached LGL yet?
//
// This is the evidence that overrides the v2 dashboard's calendar rule, so a
// wrong answer here marks a week final while its giving figure is still short.
// The regression that started this file: the detector asked LGL for
// `gift_date_from`, LGL answers 400 Unknown query parameter, the catch turned
// that into "cannot tell", and the evidence path was silently dead from at
// least 2026-08-17. The first test below is the one that would have caught it.
//
// The second regression, 2026-09-03: ONE plate gift marked the week complete,
// and one is what the mail brings. Five cheques dated the Thursday before a
// Sunday called that Sunday's count landed a week early while the 96-gift
// basket was still on its way. The count is the basket, and a basket is dozens
// of gifts, so the detector now asks for PLATE_BASKET_FLOOR of them.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  plateStatusHandler, detectPlate, weekWindow, weekWindows, clampWeeks,
  PLATE_BASKET_FLOOR, MAX_WEEKS } from "../plate-status.js";
import { _resetDump } from "../hub-exit.js";

const START = "2026-08-10"; // Monday
const WEEK = "2026-08-16";  // the Sunday that names the week

// n cash and cheque gifts to the Offertory on one day. A basket is dozens of
// these keyed against the Sunday; the mail is a handful on a weekday.
const plate = (n, day = WEEK, from = 100) =>
  Array.from({ length: n }, (unused, i) => ({
    id: from + i, fund_name: "Offertory", received_date: day, received_amount: 20,
    payment_type_name: i % 3 === 0 ? "Cash" : "Check",
  }));

const CARD = { id: 2, fund_name: "Offertory", received_date: "2026-08-14", received_amount: 40, payment_type_name: "Credit Card" };

// Cash and check are plate money. eCheck and Cash App contain the letters and
// are not. A gift with no payment type says nothing either way.
const BASKET = [...plate(PLATE_BASKET_FLOOR + 5), CARD];
const MAIL_ONLY = [...plate(5, "2026-08-13", 300), CARD];
const GIFTS = BASKET;
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

test("a basket of cash and cheques in the week means the count has landed", async () => {
  await serve(makeApp(), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, true);
    assert.equal(json.plateCount, PLATE_BASKET_FLOOR + 5);
    assert.equal(json.giftCount, PLATE_BASKET_FLOOR + 6);
  });
});

test("a handful of mail cheques is not the basket: the count has NOT landed", async () => {
  // The week of 23 August 2026: five cheques dated the Thursday, in LGL by the
  // Monday, and the 96-gift Sunday batch not there until the Friday. Under the
  // old "any plate gift" rule this answered true from Monday and the dashboard
  // called the week complete on the Wednesday with $551 of plate.
  await serve(makeApp({ gifts: MAIL_ONLY }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, false);
    assert.equal(json.plateCount, 5);
    assert.equal(json.giftCount, 6);
    assert.ok(json.types.includes("Check"), "the cheques are seen, they are just not a basket");
  });
});

test("online-only giving means the count has NOT landed yet", async () => {
  await serve(makeApp({ gifts: ONLINE_ONLY }), async (base) => {
    const json = await ask(base);
    assert.equal(json.plateLanded, false);
    assert.equal(json.giftCount, 2);
    assert.equal(json.plateCount, 0);
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

test("weeks=N returns each week's split, oldest first, from ONE read that reaches the oldest Monday", async () => {
  const calls = [];
  // The week ending 9 August: a 30-gift basket dated its Sunday, four mail
  // cheques dated its Thursday, one card gift. Then WEEK with its basket.
  const gifts = [
    ...plate(30, "2026-08-09", 1000),
    ...plate(4, "2026-08-06", 2000),
    { id: 3000, fund_name: "Offertory", received_date: "2026-08-08", received_amount: 50, payment_type_name: "Card - VISA" },
    ...BASKET,
  ];
  await serve(makeApp({ gifts, calls }), async (base) => {
    const json = await fetch(`${base}/api/lgl-plate-status?week=${WEEK}&weeks=2`).then((r) => r.json());
    // The newest week's judgement is where it always was.
    assert.equal(json.week, WEEK);
    assert.equal(json.plateLanded, true);
    assert.equal(json.plateCount, PLATE_BASKET_FLOOR + 5);

    assert.deepEqual(json.weeks.map((w) => w.week), ["2026-08-09", WEEK]);
    const [older, newest] = json.weeks;
    assert.equal(older.start, "2026-08-03");
    assert.equal(older.sundayGifts, 30);
    assert.equal(older.sundayCents, 30 * 2000);
    assert.equal(older.midweekGifts, 4);
    assert.equal(older.midweekCents, 4 * 2000);
    assert.equal(older.onlineCents, 5000);
    assert.equal(older.plateLanded, true);
    assert.equal(older.giftCount, 35);
    assert.equal(newest.sundayGifts, PLATE_BASKET_FLOOR + 5);
    assert.equal(newest.midweekGifts, 0);
    assert.equal(newest.midweekCents, 0);
    assert.equal(newest.onlineCents, 4000);
    // Sunday plus midweek is the plate figure the hub is sent, always.
    for (const w of json.weeks) {
      const d = detectPlate(gifts, w.start, w.week);
      assert.equal(w.sundayGifts + w.midweekGifts, d.plateCount, `${w.week} parts do not add up`);
    }

    const reads = calls.filter((c) => c.startsWith("updated_from"));
    assert.equal(reads.length, 1, "two weeks must not mean two reads");
    const since = reads[0].split("=")[1];
    assert.ok(since < "2026-08-03", `the read reached back only to ${since}, not before the oldest Monday`);
  });
});

test("a plain ask still answers one week, and the split rides along for it", async () => {
  await serve(makeApp(), async (base) => {
    const json = await ask(base);
    assert.equal(json.weeks.length, 1);
    assert.equal(json.weeks[0].week, WEEK);
    assert.equal(json.weeks[0].sundayGifts, PLATE_BASKET_FLOOR + 5);
  });
});

test("weeks is clamped: nonsense is one week, and never more than MAX_WEEKS", () => {
  assert.equal(clampWeeks(undefined), 1);
  assert.equal(clampWeeks("eight"), 1);
  assert.equal(clampWeeks("0"), 1);
  assert.equal(clampWeeks("-3"), 1);
  assert.equal(clampWeeks("8"), 8);
  assert.equal(clampWeeks(String(MAX_WEEKS + 40)), MAX_WEEKS);
});

test("weekWindows walks back seven days at a time, oldest first, across a month end", () => {
  assert.deepEqual(weekWindows("2026-08-02", 2), [
    { startKey: "2026-07-20", weekKey: "2026-07-26" },
    { startKey: "2026-07-27", weekKey: "2026-08-02" },
  ]);
  assert.deepEqual(weekWindows(WEEK, 1), [{ startKey: START, weekKey: WEEK }]);
});

// ─── The pieces, without a server ───

test("detectPlate: the judgement is Offertory, in the week, with a type", () => {
  // Enough Offertory plate gifts in the week to be a basket, plus a Building
  // Fund cash gift and an Offertory cash gift from a fortnight earlier, neither
  // of which may count towards it.
  const mixed = [
    ...plate(PLATE_BASKET_FLOOR),
    { fund_name: "Offertory", received_date: "2026-08-16", payment_type: { name: "Check" } },
    { fund_name: "Building Fund", received_date: "2026-08-16", payment_type_name: "Cash" },
    { fund_name: "Offertory", received_date: "2026-08-01", payment_type_name: "Cash" },
  ];
  const out = detectPlate(mixed, START, WEEK);
  assert.equal(out.plateLanded, true);
  assert.equal(out.giftCount, PLATE_BASKET_FLOOR + 1);
  assert.equal(out.plateCount, PLATE_BASKET_FLOOR + 1);
  assert.deepEqual(out.types.sort(), ["Cash", "Check"]);

  // Take the basket away and the same two outsiders do not make one.
  const outsiders = detectPlate(mixed.slice(PLATE_BASKET_FLOOR), START, WEEK);
  assert.equal(outsiders.plateLanded, false);
  assert.equal(outsiders.giftCount, 1);
  assert.equal(outsiders.plateCount, 1);
});

test("detectPlate: the floor is the line between the mail and a basket", () => {
  // One under the floor is the mail; the floor itself is a basket. Written
  // against the constant so tuning the number does not break the suite, and
  // so the boundary is the thing under test rather than a literal.
  const under = detectPlate([...plate(PLATE_BASKET_FLOOR - 1), CARD], START, WEEK);
  assert.equal(under.plateLanded, false);
  assert.equal(under.plateCount, PLATE_BASKET_FLOOR - 1);

  const at = detectPlate([...plate(PLATE_BASKET_FLOOR), CARD], START, WEEK);
  assert.equal(at.plateLanded, true);
  assert.equal(at.plateCount, PLATE_BASKET_FLOOR);

  // Online types that contain the letters never count towards the floor.
  const lookalikes = Array.from({ length: PLATE_BASKET_FLOOR }, (unused, i) => ({
    id: 500 + i, fund_name: "Offertory", received_date: WEEK, received_amount: 20,
    payment_type_name: i % 2 ? "E-Check (ACH)" : "Cash App",
  }));
  const fake = detectPlate(lookalikes, START, WEEK);
  assert.equal(fake.plateLanded, false);
  assert.equal(fake.plateCount, 0);
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
