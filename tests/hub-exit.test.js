// The PLT hub's read-only exit.
//
// The four things worth guarding: it does not answer without the right token,
// it never emits anything identifying, it does not become a hole in the auth
// gate for the rest of the app, and it refuses rather than reporting a number
// it is not sure of.
//
// Run with: npm test   (node's built-in runner, no dependencies to install)

import test from "node:test";
import assert from "node:assert/strict";
import express from "express";

import {
  hubMetricsHandler,
  isPlateType,
  paymentTypeOf,
  summarizeOffertory,
  toCents,
  PAGE_CAP_SUSPECT,
} from "../hub-exit.js";

const TOKEN = "test-hub-token-do-not-use-anywhere-real";
const FROM = "2026-08-10";
const TO = "2026-08-16";
const RANGE = `?from=${FROM}&to=${TO}`;

// Nine gifts. The identifying fields are here on purpose: the leak test below
// is only worth anything if there is something to leak.
const GIFTS = [
  { id: 90001, fund_name: "Offertory", received_date: "2026-08-10", received_amount: 100.00,
    payment_type_name: "Cash", constituent_name: "Testcase Donor One",
    email_address: "donor.one@example.invalid", address: "1 Testcase Row" },
  { id: 90002, fund_name: "Offertory", received_date: "2026-08-11", received_amount: 250.50,
    payment_type_name: "Check", constituent_name: "Testcase Donor Two",
    email_address: "donor.two@example.invalid", address: "2 Testcase Row" },
  // Online types that contain the letters "check" and "cash" and must not count
  // as plate money.
  { id: 90003, fund_name: "Offertory", received_date: "2026-08-12", received_amount: 40.00,
    payment_type_name: "E-Check (ACH)", constituent_name: "Testcase Donor Three" },
  { id: 90004, fund_name: "Offertory", received_date: "2026-08-13", received_amount: 10.00,
    payment_type_name: "Cash App", constituent_name: "Testcase Donor Four" },
  { id: 90005, fund_name: "Offertory", received_date: "2026-08-14", received_amount: "$500.25",
    payment_type: { name: "Credit Card" }, constituent_name: "Testcase Donor Five" },
  // No payment type at all. Counted in neither figure, disclosed as a signal.
  { id: 90006, fund_name: "Offertory", received_date: "2026-08-16", received_amount: 75.00,
    constituent_name: "Testcase Donor Six" },
  // A different fund, in the period. Never counted.
  { id: 90007, fund_name: "Building Fund", received_date: "2026-08-12", received_amount: 999.00,
    payment_type_name: "Cash", constituent_name: "Testcase Donor Seven" },
  // Offertory, after the period. Sets last_record_at, counts in nothing.
  { id: 90008, fund_name: "Offertory", received_date: "2026-08-18", received_amount: 888.00,
    payment_type_name: "Cash", constituent_name: "Testcase Donor Eight" },
  // Offertory, before the period.
  { id: 90009, fund_name: "Offertory", received_date: "2026-08-09", received_amount: 777.00,
    payment_type_name: "Check", constituent_name: "Testcase Donor Nine" },
];

// A stand-in for server.js, wired in the SAME order: the exact exit path, the
// refusal for everything else under /api/hub, then the SPA catch-all that
// answers 200 with the dashboard shell for any unknown path.
function makeApp({ gifts = GIFTS, hasApiKey = true, fail = null, calls = [] } = {}) {
  const app = express();
  app.get("/api/hub/v1/metrics", hubMetricsHandler({
    fetchGiftsAxis: async (term) => {
      calls.push(term);
      if (fail) throw new Error(fail);
      return gifts;
    },
    hasApiKey: () => hasApiKey,
  }));
  app.use("/api/hub", (req, res) => {
    res.status(404).json({ error: "no such endpoint" });
  });
  app.get("/{*splat}", (req, res) => res.status(200).send("<!doctype html><title>dashboard</title>"));
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

function get(base, path, token) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  return fetch(base + path, { headers });
}

function withToken(value) {
  if (value === null) delete process.env.HUB_EXIT_TOKEN;
  else process.env.HUB_EXIT_TOKEN = value;
}

test("no token configured says so rather than refusing", async () => {
  withToken(null);
  await serve(makeApp(), async (base) => {
    const resp = await get(base, "/api/hub/v1/metrics" + RANGE);
    assert.equal(resp.status, 503);
    assert.match((await resp.json()).error, /not configured/);
  });
});

test("a wrong token is refused", async () => {
  withToken(TOKEN);
  await serve(makeApp(), async (base) => {
    assert.equal((await get(base, "/api/hub/v1/metrics" + RANGE, "wrong")).status, 401);
    // Same length as the real token, so this fails on content rather than size.
    const sameLength = "x".repeat(TOKEN.length);
    assert.equal((await get(base, "/api/hub/v1/metrics" + RANGE, sameLength)).status, 401);
  });
});

test("no token at all is refused", async () => {
  withToken(TOKEN);
  await serve(makeApp(), async (base) => {
    assert.equal((await get(base, "/api/hub/v1/metrics" + RANGE)).status, 401);
  });
});

test("the numbers are right", async () => {
  withToken(TOKEN);
  const calls = [];
  await serve(makeApp({ calls }), async (base) => {
    const resp = await get(base, "/api/hub/v1/metrics" + RANGE, TOKEN);
    assert.equal(resp.status, 200);
    const body = await resp.json();
    const got = Object.fromEntries(body.metrics.map((m) => [m.key, m.value]));

    // Cash 100.00 plus Check 250.50, and nothing else.
    assert.equal(got["giving.lgl_plate"], 35050);
    // E-Check 40.00 plus Cash App 10.00 plus Credit Card 500.25.
    assert.equal(got["giving.lgl_online"], 55025);

    for (const m of body.metrics) {
      assert.equal(m.unit, "cents");
      assert.ok(Number.isInteger(m.value), `${m.key} is not an integer`);
    }

    const signals = Object.fromEntries(body.freshness.signals.map((s) => [s.key, s.value]));
    assert.equal(signals.unclassified, 1);
    assert.equal(signals.unclassified_cents, 7500);
    assert.equal(signals.capped, 0);

    assert.equal(body.contract, 1);
    assert.equal(body.source, "lgl");
    assert.equal(body.period.from, FROM);
    assert.equal(body.period.to, TO);
    assert.equal(body.freshness.records_in_period, 6);
    // The newest Offertory gift seen, which is after the period on purpose.
    assert.equal(body.freshness.last_record_at, "2026-08-18");
    assert.ok(body.generated_at);

    // Filtered on received_date, asked of LGL on the gift-date axis.
    assert.deepEqual(calls, [`gift_date_from=${FROM}`]);
  });
});

test("a gift with no payment type is never counted as plate", async () => {
  const summary = summarizeOffertory(
    [{ fund_name: "Offertory", received_date: FROM, received_amount: 500 }], FROM, TO);
  assert.equal(summary.plateCents, 0);
  assert.equal(summary.onlineCents, 0);
  assert.equal(summary.unclassified, 1);
  assert.equal(summary.unclassifiedCents, 50000);
});

test("the payload carries nothing identifying", async () => {
  withToken(TOKEN);
  await serve(makeApp(), async (base) => {
    const raw = await (await get(base, "/api/hub/v1/metrics" + RANGE, TOKEN)).text();
    for (const leak of ["Testcase", "Donor", "example.invalid", "@", "Row",
                        "constituent", "90001", "address", "Building Fund"]) {
      assert.ok(!raw.includes(leak), `the exit leaked ${leak}`);
    }
  });
});

test("a bad date range is refused", async () => {
  withToken(TOKEN);
  await serve(makeApp(), async (base) => {
    const bad = [
      "",
      "?from=2026-08-10",
      "?from=nonsense&to=2026-08-16",
      "?from=2026-08-16&to=2026-08-10",
      "?from=2026-02-31&to=2026-03-02",
      "?from=2020-01-01&to=2026-08-16",
    ];
    for (const q of bad) {
      const resp = await get(base, "/api/hub/v1/metrics" + q, TOKEN);
      assert.equal(resp.status, 400, `expected 400 for ${q || "no params"}`);
      assert.ok((await resp.json()).error);
    }
  });
});

test("the exit is not a hole in the auth gate", async () => {
  // The exception is an exact path. server.js lets everything under /api past
  // the session gate, so a near miss must never be treated as the exit.
  withToken(TOKEN);
  await serve(makeApp(), async (base) => {
    for (const near of ["/api/hub/v1/metrics-debug", "/api/hub/v1/metricsx",
                        "/api/hub/v2/metrics", "/api/hub"]) {
      const resp = await get(base, near + RANGE, TOKEN);
      const body = await resp.text();
      assert.equal(resp.status, 404, `${near} answered ${resp.status}`);
      assert.ok(!body.includes("giving.lgl_plate"), `${near} answered with data`);
      assert.ok(!body.includes("contract"), `${near} answered with a payload`);
    }
    // And the exit itself still answers on its token.
    assert.equal((await get(base, "/api/hub/v1/metrics" + RANGE, TOKEN)).status, 200);
  });
});

test("a read that could not happen returns an error, never zeros", async () => {
  withToken(TOKEN);
  await serve(makeApp({ fail: "LGL API 500: upstream on fire" }), async (base) => {
    const resp = await get(base, "/api/hub/v1/metrics" + RANGE, TOKEN);
    assert.equal(resp.status, 502);
    const body = await resp.text();
    assert.ok(JSON.parse(body).error);
    assert.ok(!body.includes("giving.lgl_plate"));
    // The upstream text is logged, not handed onward.
    assert.ok(!body.includes("upstream on fire"));
  });
});

test("a read that may have been truncated is refused, not reported", async () => {
  withToken(TOKEN);
  const flood = Array.from({ length: PAGE_CAP_SUSPECT }, (unused, i) => ({
    id: i, fund_name: "Offertory", received_date: FROM, received_amount: 1,
    payment_type_name: "Cash",
  }));
  await serve(makeApp({ gifts: flood }), async (base) => {
    const resp = await get(base, "/api/hub/v1/metrics" + RANGE, TOKEN);
    assert.equal(resp.status, 502);
    assert.match((await resp.json()).error, /truncated/);
  });
});

test("no LGL key is a 503, and only after the caller is authorized", async () => {
  withToken(TOKEN);
  await serve(makeApp({ hasApiKey: false }), async (base) => {
    const resp = await get(base, "/api/hub/v1/metrics" + RANGE, TOKEN);
    assert.equal(resp.status, 503);
    // An unauthorized caller learns nothing about how this service is set up.
    assert.equal((await get(base, "/api/hub/v1/metrics" + RANGE, "wrong")).status, 401);
  });
});

test("the plate predicate keeps online types out of the basket", () => {
  for (const plate of ["Cash", "cash", "Check", "check", "Cash (counted)", "Personal Check"]) {
    assert.ok(isPlateType(plate), `${plate} should read as plate`);
  }
  for (const online of ["eCheck", "E-Check (ACH)", "Cash App", "Credit Card", "ACH", "", null]) {
    assert.ok(!isPlateType(online), `${online} should not read as plate`);
  }
});

test("payment type is read from either shape LGL uses", () => {
  assert.equal(paymentTypeOf({ payment_type_name: "Cash" }), "Cash");
  assert.equal(paymentTypeOf({ payment_type: { name: "Credit Card" } }), "Credit Card");
  assert.equal(paymentTypeOf({}), null);
});

test("money is whole cents", () => {
  assert.equal(toCents(100), 10000);
  assert.equal(toCents("$1,234.56"), 123456);
  assert.equal(toCents(0.1 + 0.2), 30);
  assert.equal(toCents(null), 0);
  assert.equal(toCents("not a number"), 0);
});
