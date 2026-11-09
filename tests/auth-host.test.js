// Sign-in begun on lgl.onrender.com came back to lgldash.stedward.org without
// its state cookie and ended on "Invalid State" (2026-11-09). /auth/login now
// sends any other address to the callback's own one first.
//
// Run with: npm test

import test from "node:test";
import assert from "node:assert/strict";

import { signInHostRedirect } from "../auth-host.js";

const CALLBACK = "https://lgldash.stedward.org/auth/callback";

test("the Render address is sent to the parish address before sign-in starts", () => {
  assert.equal(signInHostRedirect("lgl.onrender.com", CALLBACK),
               "https://lgldash.stedward.org/auth/login?moved=1");
});

test("the parish address signs in where it stands", () => {
  assert.equal(signInHostRedirect("lgldash.stedward.org", CALLBACK), null);
  assert.equal(signInHostRedirect("LGLDash.StEdward.org", CALLBACK), null);
  assert.equal(signInHostRedirect("lgldash.stedward.org:443", CALLBACK), null);
});

test("the hop happens once, so a misread host cannot loop", () => {
  assert.equal(signInHostRedirect("somewhere.else", CALLBACK, "1"), null);
});

test("the target comes from the callback setting, whatever the host", () => {
  assert.equal(signInHostRedirect("lgldash.stedward.org", "https://lgl.onrender.com/auth/callback"),
               "https://lgl.onrender.com/auth/login?moved=1");
  assert.equal(signInHostRedirect("evil.example", CALLBACK),
               "https://lgldash.stedward.org/auth/login?moved=1");
});

test("no host or an unreadable callback leaves sign-in alone", () => {
  assert.equal(signInHostRedirect("", CALLBACK), null);
  assert.equal(signInHostRedirect(undefined, CALLBACK), null);
  assert.equal(signInHostRedirect("lgl.onrender.com", "not a url"), null);
});
