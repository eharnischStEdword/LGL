// The Offertory split on the v2 weekly model: each recent week carries the
// Sunday basket, mail and office, and online from the live LGL read, in
// dollars, for the Offertory fund only.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";

import { buildWeeklyModel, partsFromSplit } from "../src/v2/lib.js";

// Saturday 29 August 2026: the newest ended week is the one ending Sunday 23.
const NOW = new Date(2026, 7, 29);

const gift = (y, m, d, amount, fund = "Offertory") => ({ date: new Date(y, m - 1, d), fund, amount });

// The report file's view of two weeks, plus one early gift so weekly coverage
// starts well before either of them.
const RAW = [
  gift(2026, 6, 1, 100),
  gift(2026, 8, 14, 5000), gift(2026, 8, 16, 9000),
  gift(2026, 8, 20, 551), gift(2026, 8, 21, 6575.2), gift(2026, 8, 23, 10361),
  gift(2026, 8, 16, 999, "Building Fund"),
];

// What /api/lgl-plate-status?weeks=2 says about the same two weeks.
const SPLIT = {
  week: "2026-08-23", plateLanded: true,
  weeks: [
    { week: "2026-08-16", start: "2026-08-10", plateLanded: true,
      sundayCents: 900000, sundayGifts: 80, midweekCents: 0, midweekGifts: 0,
      onlineCents: 500000, unclassifiedCents: 0 },
    { week: "2026-08-23", start: "2026-08-17", plateLanded: true,
      sundayCents: 1036100, sundayGifts: 96, midweekCents: 55100, midweekGifts: 5,
      onlineCents: 657520, unclassifiedCents: 0 },
  ],
};

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} vs ${b}`);

test("Offertory weeks carry the split from the live read, in dollars", () => {
  const m = buildWeeklyModel(RAW, "Offertory", NOW, 8, SPLIT);
  const w = m.weeks.find((x) => x.key === "2026-08-23");
  assert.ok(w && w.parts, "the newest week has parts");
  near(w.parts.basket, 10361, "basket");
  assert.equal(w.parts.basketGifts, 96);
  near(w.parts.mail, 551, "mail");
  assert.equal(w.parts.mailGifts, 5);
  near(w.parts.online, 6575.2, "online");
  near(w.parts.total, 17487.2, "parts total");
  // And the bar's own total, from the report file, agrees with it here.
  near(w.total, 17487.2, "bar total");

  const older = m.weeks.find((x) => x.key === "2026-08-16");
  assert.ok(older && older.parts);
  near(older.parts.basket, 9000, "older basket");
  assert.equal(older.parts.mailGifts, 0);
});

test("the fund name is matched loosely, the way the dashboard finds the Offertory fund", () => {
  const m = buildWeeklyModel(RAW.map((g) => ({ ...g, fund: g.fund === "Offertory" ? "Offertory Collection" : g.fund })),
    "Offertory Collection", NOW, 8, SPLIT);
  assert.ok(m.weeks.find((x) => x.key === "2026-08-23").parts);
});

test("All Funds and other funds get no parts, because the read splits only the Offertory", () => {
  const all = buildWeeklyModel(RAW, null, NOW, 8, SPLIT);
  assert.ok(all.weeks.every((w) => w.parts === null), "All Funds carried parts");
  const other = buildWeeklyModel(RAW, "Building Fund", NOW, 8, SPLIT);
  assert.ok(other.weeks.every((w) => w.parts === null), "another fund carried parts");
});

test("a week the read did not cover has no parts, and no read at all means none anywhere", () => {
  const m = buildWeeklyModel(RAW, "Offertory", NOW, 8, SPLIT);
  const uncovered = m.weeks.find((x) => x.key === "2026-08-09");
  assert.ok(uncovered, "the week ending 9 August is on the panel");
  assert.equal(uncovered.parts, null);

  const none = buildWeeklyModel(RAW, "Offertory", NOW, 8, null);
  assert.ok(none.weeks.every((w) => w.parts === null));
  const oldShape = buildWeeklyModel(RAW, "Offertory", NOW, 8, { week: "2026-08-23", plateLanded: true });
  assert.ok(oldShape.weeks.every((w) => w.parts === null), "a response without weeks is the old shape and still fine");
});

test("partsFromSplit reads zero for anything the server did not send", () => {
  const p = partsFromSplit({});
  assert.deepEqual(p, { basket: 0, basketGifts: 0, mail: 0, mailGifts: 0, online: 0, untyped: 0, total: 0 });
  const q = partsFromSplit({ sundayCents: "1036100", sundayGifts: 96, onlineCents: null });
  near(q.basket, 10361, "string cents still read");
  assert.equal(q.online, 0);
});
