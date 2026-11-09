// The report topped up from the API, and the collapse that put a wrong basket
// on the v2 page on 2026-09-04. See the head of top-up.js.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";
import { mergeApiGifts, mergeRecentGifts, deduplicateKey } from "../top-up.js";

const COLS = { dateCol: "Date", amountCol: "Amount", fundCol: "Fund",
               paymentCol: "Payment type" };

const apiGift = (amount, date = "2026-08-30", payment = "Cash") => ({
  received_date: date, received_amount: amount, fund_name: "Offertory",
  payment_type_name: payment,
});

const reportRow = (amount, date = "2026-08-30") => ({
  Date: date, Amount: amount, Fund: "Offertory", "Payment type": "Cash",
});

test("a basket of repeated amounts arrives whole", () => {
  // 30 August: 97 gifts, and only 21 distinct amounts among them, which is what
  // an envelope basket looks like. The Set kept 21 and lost $4,657.50.
  const amounts = [];
  for (let i = 0; i < 97; i++) amounts.push([5, 10, 20, 20, 20, 50, 100][i % 7]);
  const rows = [];
  const added = mergeApiGifts(rows, amounts.map(a => apiGift(a)), COLS);

  assert.equal(added, 97, "gifts sharing an amount were dropped as copies");
  assert.equal(rows.length, 97);
  const total = rows.reduce((sum, r) => sum + r.Amount, 0);
  assert.equal(total, amounts.reduce((sum, a) => sum + a, 0),
               "the basket total does not match the gifts that made it");
});

test("a gift the report already holds is not counted twice", () => {
  // The whole point of the dedup, and it still has to work: the report's own
  // $20.00 stays one gift when the API sends the same one back.
  const rows = [reportRow(20)];
  const added = mergeApiGifts(rows, [apiGift(20)], COLS);

  assert.equal(added, 0, "a gift already in the report was added again");
  assert.equal(rows.length, 1);
});

test("only the copies the report holds are held back", () => {
  // Two $20.00 gifts in the report, five in the API: three are new. Counting
  // is the whole difference from the Set, which held back all five.
  const rows = [reportRow(20), reportRow(20)];
  const added = mergeApiGifts(rows, [20, 20, 20, 20, 20].map(a => apiGift(a)),
                              COLS);

  assert.equal(added, 3);
  assert.equal(rows.length, 5);
});

test("a gift on another day or in another fund is its own row", () => {
  const rows = [reportRow(20)];
  const other = { ...apiGift(20, "2026-08-23") };
  const building = { ...apiGift(20), fund_name: "Building Fund" };
  const added = mergeApiGifts(rows, [other, building], COLS);

  assert.equal(added, 2, "the key stopped separating date or fund");
});

test("the payment type rides along, so the split can read it", () => {
  // Without it a topped-up gift is untyped and drops out of the basket into
  // the untyped band, which is a different wrong number.
  const rows = [];
  mergeApiGifts(rows, [apiGift(20, "2026-08-30", "Check")], COLS);

  assert.equal(rows[0]["Payment type"], "Check");
});

test("the key still ignores the columns it never had", () => {
  // A report with no payment column still merges; the key is date, amount and
  // fund, and that is all it has ever been.
  assert.equal(deduplicateKey(reportRow(20), "Date", "Amount", "Fund"),
               "2026-08-30|20.00|offertory");
});

test("the page's own top-up counts repeated gifts too", () => {
  // The page merges /api/lgl-recent-gifts into the All Funds report itself, and
  // kept the Set after the server lost it: on 2026-11-09 it showed 40 of 47
  // topped-up Offertory gifts, $253.41 short.
  const rows = [reportRow(20)];
  const recent = [20, 20, 20].map((amount) => ({
    date: "2026-08-30", amount, fund: "Offertory", paymentType: "Cash" }));
  const added = mergeRecentGifts(rows, recent, COLS);

  assert.equal(added, 2, "one is the report's own, the other two are new gifts");
  assert.equal(rows.length, 3);
  assert.equal(rows[2]["Payment type"], "Cash");
});
