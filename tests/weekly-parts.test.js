// The Offertory split on the v2 weekly model: each recent week carries the
// Sunday basket, mail and office, online, and untyped, built from the same
// gift rows as the bar, for the Offertory fund only.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";

import { buildWeeklyModel, buildWeekParts, detectColumns, isPlateType, paymentKind } from "../src/v2/lib.js";
import { isPlateType as hubIsPlateType } from "../hub-exit.js";

// Saturday 29 August 2026: the newest ended week is the one ending Sunday 23.
const NOW = new Date(2026, 7, 29);

const gift = (y, m, d, amount, paymentType, fund = "Offertory") =>
  ({ date: new Date(y, m - 1, d), fund, amount, paymentType });

// The week of 17 to 23 August 2026 in miniature, the week before it, one early
// gift so weekly coverage starts well before both, and a Building Fund gift.
const RAW = [
  gift(2026, 6, 1, 100, "Check"),
  gift(2026, 8, 14, 5000, "ACH"), gift(2026, 8, 16, 9000, "Cash"),
  gift(2026, 8, 20, 551, "Check"),              // Thursday mail
  gift(2026, 8, 21, 6575.2, "Card - VISA"),      // online
  gift(2026, 8, 23, 6000, "Check"),              // Sunday basket
  gift(2026, 8, 23, 4361, "Cash"),               // Sunday basket
  gift(2026, 8, 22, 25, "Cash"),                 // a Saturday cash gift is mail, not vigil
  gift(2026, 8, 23, 40, ""),                     // no payment type: untyped
  gift(2026, 8, 16, 999, "Cash", "Building Fund"),
];

const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.005, `${msg}: ${a} vs ${b}`);

test("Offertory weeks carry the split, built from the same rows as the bar", () => {
  const m = buildWeeklyModel(RAW, "Offertory", NOW, 8, null);
  const w = m.weeks.find((x) => x.key === "2026-08-23");
  assert.ok(w && w.parts, "the newest week has parts");
  near(w.parts.basket, 10361, "basket");
  assert.equal(w.parts.basketGifts, 2);
  near(w.parts.mail, 576, "mail: Thursday cheque plus the Saturday cash");
  assert.equal(w.parts.mailGifts, 2);
  near(w.parts.online, 6575.2, "online");
  near(w.parts.untyped, 40, "untyped");
  near(w.parts.total, w.total, "the parts add up to the bar, always");

  const older = m.weeks.find((x) => x.key === "2026-08-16");
  assert.ok(older && older.parts);
  near(older.parts.basket, 9000, "older basket");
  near(older.parts.online, 5000, "older online");
  assert.equal(older.parts.mailGifts, 0);
});

test("the fund name is matched loosely, the way the dashboard finds the Offertory fund", () => {
  const renamed = RAW.map((g) => ({ ...g, fund: g.fund === "Offertory" ? "Offertory Collection" : g.fund }));
  const m = buildWeeklyModel(renamed, "Offertory Collection", NOW, 8, null);
  assert.ok(m.weeks.find((x) => x.key === "2026-08-23").parts);
});

test("All Funds and other funds get no parts, because the basket is an Offertory idea", () => {
  const all = buildWeeklyModel(RAW, null, NOW, 8, null);
  assert.ok(all.weeks.every((w) => w.parts === null), "All Funds carried parts");
  const other = buildWeeklyModel(RAW, "Building Fund", NOW, 8, null);
  assert.ok(other.weeks.every((w) => w.parts === null), "another fund carried parts");
});

test("a week with no Offertory gifts has no parts, and rows without a payment type are untyped", () => {
  const m = buildWeeklyModel(RAW, "Offertory", NOW, 8, null);
  const empty = m.weeks.find((x) => x.key === "2026-08-09");
  assert.ok(empty, "the week ending 9 August is on the panel");
  assert.equal(empty.parts, null);

  const untyped = buildWeekParts([gift(2026, 8, 23, 50, "Unknown"), gift(2026, 8, 23, 50, undefined)], "Offertory");
  const p = untyped.get("2026-08-23");
  near(p.untyped, 100, "Unknown and missing are both untyped");
  assert.equal(p.basket, 0);
  assert.equal(p.online, 0);
});

test("the plate line is the hub exit's line, word for word", () => {
  for (const name of ["Cash", "cash", "Check", "Personal Check", "Cash (counted)", "eCheck", "E-Check (ACH)",
                      "Cash App", "Credit Card", "Card - VISA (Apple Pay)", "ACH", "Unknown", "", null]) {
    assert.equal(isPlateType(name), hubIsPlateType(name), `v2 and the hub disagree about ${JSON.stringify(name)}`);
  }
  assert.equal(paymentKind("Check"), "plate");
  assert.equal(paymentKind("Card - VISA"), "online");
  assert.equal(paymentKind("Credit Card"), "online");
  assert.equal(paymentKind("Unknown"), "untyped");
  assert.equal(paymentKind(""), "untyped");
});

test("detectColumns finds the report's Payment type and not the parent gift's", () => {
  const offertory = ["Gift type", "Gift amount", "Payment type", "Deposit date", "Gift date", "Fund"];
  assert.equal(detectColumns(offertory).paymentCol, "Payment type");
  // The FULL GIVING REPORT lists the parent's payment type first.
  const allFunds = ["Gift type", "Gift date", "Amount", "Fund", "Parent gift pmt. type", "Gift amount", "Payment type"];
  assert.equal(detectColumns(allFunds).paymentCol, "Payment type");
  assert.equal(detectColumns(["Gift date", "Amount", "Fund"]).paymentCol, null);
});
