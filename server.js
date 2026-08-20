import express from "express";
import session from "express-session";
import crypto from "crypto";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as XLSX from "xlsx";
import {
  hubMetricsHandler,
  isPlateType,
  paymentTypeOf,
  OFFERTORY_FUND,
  PAGE_CAP_SUSPECT,
} from "./hub-exit.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

// ─── Configuration ───
const CLIENT_ID = process.env.CLIENT_ID || "0c53ab68-8e2c-4fc4-920c-bdd4d0db6663";
const TENANT_ID = process.env.TENANT_ID || "8ccf96b2-b7eb-470b-a715-ec1696d83ebd";
const CLIENT_SECRET = process.env.CLIENT_SECRET || "";
const REDIRECT_URI = process.env.REDIRECT_URI || "https://lgl.onrender.com/auth/callback";
const SESSION_SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString("hex");

const ALLOWED_USERS = (process.env.ALLOWED_DASHBOARD_USERS || [
  "eharnisch@stedward.org",
  "rcarroll@stedward.org",
  "sblankenship@stedward.org",
  "klewis@stedward.org",
  "fatherbulso@stedward.org"
].join(",")).split(",").map(e => e.trim().toLowerCase()).filter(Boolean);

const AUTH_ENABLED = !!CLIENT_SECRET;
const LGL_API_KEY = process.env.LGL_API_KEY || "";

const LGL_OFFERTORY_URL = "https://stedward.littlegreenlight.com/rptlink/5957dd30-a1b2-402b-b30a-3bd21e02f604";
const LGL_ALL_FUNDS_URL = "https://stedward.littlegreenlight.com/rptlink/e7599438-bb83-4b84-b3ca-955a11f03004";
const AUTHORIZE_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/authorize`;
const TOKEN_URL = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;

// ─── Session ───
app.set("trust proxy", 1);
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
}));

// ─── Auth helpers ───
function isAuthenticated(req) {
  if (!AUTH_ENABLED) return true; // skip auth in dev if no secret configured
  return !!req.session.user;
}

function requireAuth(req, res, next) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: "Not authenticated" });
}

// ─── Auth routes ───

// Check auth status (called by frontend)
app.get("/auth/status", (req, res) => {
  if (!AUTH_ENABLED) {
    return res.json({ authenticated: true, user: { name: "Local Dev", email: "dev@local" } });
  }
  if (req.session.user) {
    return res.json({ authenticated: true, user: req.session.user });
  }
  res.json({ authenticated: false });
});

// Start Microsoft login
app.get("/auth/login", (req, res) => {
  if (!AUTH_ENABLED) return res.redirect("/");
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    redirect_uri: REDIRECT_URI,
    scope: "openid profile email User.Read",
    state: state,
    response_mode: "query"
  });
  res.redirect(`${AUTHORIZE_URL}?${params}`);
});

// OAuth callback
app.get("/auth/callback", async (req, res) => {
  if (!AUTH_ENABLED) return res.redirect("/");

  const { code, state, error: authError } = req.query;

  if (authError) {
    return res.status(400).send(`
      <h2>Authentication Error</h2>
      <p>${authError}: ${req.query.error_description || ""}</p>
      <a href="/">Go back</a>
    `);
  }

  // Verify state to prevent CSRF
  if (!state || state !== req.session.oauthState) {
    return res.status(403).send(`
      <h2>Invalid State</h2>
      <p>The authentication request could not be verified. Please try again.</p>
      <a href="/auth/login">Try again</a>
    `);
  }
  delete req.session.oauthState;

  try {
    // Exchange code for token
    const tokenResp = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code: code,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
        scope: "openid profile email User.Read"
      })
    });

    if (!tokenResp.ok) {
      const err = await tokenResp.text();
      console.error("Token exchange failed:", err);
      return res.status(500).send(`
        <h2>Authentication Failed</h2>
        <p>Could not complete sign-in. Please try again.</p>
        <a href="/auth/login">Try again</a>
      `);
    }

    const tokens = await tokenResp.json();

    // Get user info from Microsoft Graph
    const userResp = await fetch("https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName", {
      headers: { Authorization: `Bearer ${tokens.access_token}` }
    });

    if (!userResp.ok) {
      return res.status(500).send(`
        <h2>Could Not Verify Identity</h2>
        <p>Signed in but could not retrieve your email. Please try again.</p>
        <a href="/auth/login">Try again</a>
      `);
    }

    const userInfo = await userResp.json();
    const email = (userInfo.mail || userInfo.userPrincipalName || "").toLowerCase();

    // Check allow-list
    if (ALLOWED_USERS.length > 0 && !ALLOWED_USERS.includes(email)) {
      return res.status(403).send(`
        <!DOCTYPE html>
        <html><head><title>Access Denied</title></head>
        <body style="font-family: 'Trebuchet MS', sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; background: #EEF4F1; margin: 0;">
          <div style="text-align: center; max-width: 400px; padding: 40px;">
            <div style="width: 56px; height: 56px; border-radius: 50%; background: #00843D; display: flex; align-items: center; justify-content: center; margin: 0 auto 16px; color: #DAAA00; font-size: 26px; font-family: Georgia, serif; font-weight: 700;">&#10013;</div>
            <h2 style="color: #005921; font-family: Georgia, serif;">Access Denied</h2>
            <p style="color: #666; font-size: 16px;">The account <strong>${email}</strong> is not authorized to access this dashboard.</p>
            <p style="color: #999; font-size: 16px;">Contact your administrator if you need access.</p>
            <a href="/auth/login" style="display: inline-block; margin-top: 16px; padding: 10px 24px; background: #00843D; color: white; text-decoration: none; border-radius: 8px; font-weight: 700;">Try a Different Account</a>
          </div>
        </body></html>
      `);
    }

    // Store user in session
    req.session.user = {
      name: userInfo.displayName || email,
      email: email
    };

    res.redirect("/");
  } catch (err) {
    console.error("Auth callback error:", err);
    res.status(500).send(`
      <h2>Authentication Error</h2>
      <p>An unexpected error occurred. Please try again.</p>
      <a href="/auth/login">Try again</a>
    `);
  }
});

// Logout
app.get("/auth/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

// ─── Protected API ───

// Extract the first .csv entry from a ZIP archive buffer.
// LGL now delivers the large "FULL GIVING REPORT" (All Funds) export as a .zip
// wrapping a single .csv, which browser SheetJS can't read ("Unsupported ZIP file").
// A real .xlsx is also a zip, but its entries are OOXML parts (no .csv), so this
// returns null for xlsx and the caller forwards it unchanged.
// Reads sizes from the central directory so it is immune to streaming zips that
// defer sizes to a data descriptor.
function extractCsvFromZip(buf) {
  const b = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  if (b.length < 22 || b.readUInt32LE(0) !== 0x04034b50) return null; // not a zip

  // Find the End Of Central Directory record (scan back for PK\x05\x06)
  let eocd = -1;
  for (let i = b.length - 22; i >= 0 && i >= b.length - 22 - 65536; i--) {
    if (b.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd === -1) return null;

  let cd = b.readUInt32LE(eocd + 16);
  const entries = b.readUInt16LE(eocd + 10);
  for (let e = 0; e < entries; e++) {
    if (b.readUInt32LE(cd) !== 0x02014b50) return null; // bad central directory header
    const method = b.readUInt16LE(cd + 10);
    const compSize = b.readUInt32LE(cd + 20);
    const nameLen = b.readUInt16LE(cd + 28);
    const extraLen = b.readUInt16LE(cd + 30);
    const commentLen = b.readUInt16LE(cd + 32);
    const localOffset = b.readUInt32LE(cd + 42);
    const name = b.slice(cd + 46, cd + 46 + nameLen).toString("utf-8");

    if (name.toLowerCase().endsWith(".csv")) {
      if (b.readUInt32LE(localOffset) !== 0x04034b50) return null;
      const lNameLen = b.readUInt16LE(localOffset + 26);
      const lExtraLen = b.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + lNameLen + lExtraLen;
      const comp = b.slice(dataStart, dataStart + compSize);
      const out = method === 8 ? zlib.inflateRawSync(comp) : comp; // 8=deflate, 0=stored
      return out.toString("utf-8");
    }
    cd += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

// Helper to proxy an LGL permanent link
async function proxyLGL(url, res) {
  const resp = await fetch(url);
  if (!resp.ok) {
    return res.status(resp.status).json({ error: `LGL returned ${resp.status}` });
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  // Extract report date from Content-Disposition filename (e.g. "...Update 2026-03-15.xlsx")
  const cd = resp.headers.get("content-disposition") || "";
  const dateMatch = cd.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    res.set("X-Report-Date", dateMatch[1]);
  }
  // LGL now zips the large All Funds export. Unwrap to the inner CSV so the
  // browser parses plain text instead of choking on a non-xlsx zip.
  const csv = extractCsvFromZip(buf);
  if (csv !== null) {
    res.set("Content-Type", "text/csv; charset=utf-8");
    return res.send(csv);
  }
  // Otherwise forward as-is (real .xlsx, or a plain .csv)
  const ct = resp.headers.get("content-type") || "application/octet-stream";
  res.set("Content-Type", ct);
  res.send(buf);
}

// Offertory-only report
app.get("/api/lgl-data", requireAuth, async (req, res) => {
  try { await proxyLGL(LGL_OFFERTORY_URL, res); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// All-funds report
app.get("/api/lgl-all-funds", requireAuth, async (req, res) => {
  try { await proxyLGL(LGL_ALL_FUNDS_URL, res); }
  catch (err) { res.status(502).json({ error: err.message }); }
});

// ─── Hybrid API (permanent link + LGL API top-up) ───

const LGL_API_BASE = "https://api.littlegreenlight.com/api/v1";

// Parse XLSX or CSV buffer into array of row objects (mirrors client-side logic)
function parseSpreadsheetServer(buffer, contentType) {
  let wb;
  if (contentType && (contentType.includes("text/") || contentType.includes("csv"))) {
    const text = Buffer.from(buffer).toString("utf-8");
    wb = XLSX.read(text, { type: "string" });
  } else {
    wb = XLSX.read(Buffer.from(buffer), { type: "buffer" });
  }
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

// Detect date/amount/fund columns (mirrors client-side detectColumns)
function detectColumnsServer(headers) {
  const lower = headers.map(h => h.toLowerCase().trim());
  const datePatterns = ["gift date", "gift_date", "giftdate", "date", "deposit date", "deposit_date"];
  const amountPatterns = ["gift amount", "gift_amount", "giftamount", "amount", "gift amt", "total"];
  const fundPatterns = ["fund", "fund name", "fund_name"];
  function findCol(patterns) {
    for (const p of patterns) {
      const idx = lower.findIndex(h => h === p);
      if (idx !== -1) return headers[idx];
    }
    for (const p of patterns) {
      const idx = lower.findIndex(h => h.includes(p) && !h.includes("parent"));
      if (idx !== -1) return headers[idx];
    }
    return null;
  }
  return { dateCol: findCol(datePatterns), amountCol: findCol(amountPatterns), fundCol: findCol(fundPatterns) };
}

// Fetch gifts from LGL API since a given date, optionally filtered by fund.
// queryTerm is the LGL search term for one axis, e.g. "updated_from=2026-08-01".
async function fetchLGLApiGiftsAxis(queryTerm) {
  const gifts = [];
  let offset = 0;
  const limit = 100;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    params.append("q[]", queryTerm);
    params.append("limit", String(limit));
    params.append("offset", String(offset));

    const url = `${LGL_API_BASE}/gifts/search.json?${params}`;
    const resp = await fetch(url, {
      headers: { Authorization: `Bearer ${LGL_API_KEY}` },
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`LGL API ${resp.status}: ${body.slice(0, 200)}`);
    }
    const data = await resp.json();
    const items = data.items || [];
    gifts.push(...items);

    if (offset + items.length >= (data.total_items || 0)) break;
    offset += limit;
  }
  return gifts;
}

// NOTE (axis mismatch — audit finding #11): `updated_from` selects gifts by
// UPDATED-at date, but downstream consumers bucket by RECEIVED date. That
// misses advance-entered gifts (received after sinceDate, record untouched
// since before it). `gift_date_from` alone would instead miss back-dated
// gifts entered after the report (a Sunday plate batch typed in on Monday is
// caught by updated_from because entry touches the record, and its gift date
// still buckets to Sunday). v1 behavior (axis omitted / "updated") is
// unchanged. axis="union" — used by the v2 dashboard — queries BOTH axes and
// merges, so each axis covers the other's blind spot. The gift_date_from key
// could not be re-verified against LGL docs offline, so the union guards
// against both of its possible failure modes: a 400 (unknown key rejected) is
// swallowed, and an ignored-key full dump (huge result set) is discarded by
// the size sanity check. Either way the top-up can never end up worse than
// v1's updated_from baseline.
async function fetchLGLApiGifts(sinceDate, fundFilter, axis) {
  let gifts = await fetchLGLApiGiftsAxis(`updated_from=${sinceDate}`);

  if (axis === "union") {
    try {
      // Post-filter by received date: a working gift_date_from returns only
      // gifts on/after sinceDate, so this is a no-op in the healthy case; if
      // LGL ever ignores the key and dumps everything, the dump is stripped to
      // genuinely-recent gifts here (the count heuristic below is a backstop).
      const byGiftDate = (await fetchLGLApiGiftsAxis(`gift_date_from=${sinceDate}`))
        .filter(g => (g.received_date || "") >= sinceDate);
      const suspicious = byGiftDate.length > 500 && byGiftDate.length > 3 * Math.max(gifts.length, 25);
      if (suspicious) {
        console.warn(`[lgl-api] gift_date_from returned ${byGiftDate.length} items vs ${gifts.length} from updated_from — treating as ignored-key dump, discarding`);
      } else {
        const seen = new Set(gifts.map(g => `${g.id ?? `${g.received_date}|${g.received_amount}|${g.fund_name}`}`));
        for (const g of byGiftDate) {
          const key = `${g.id ?? `${g.received_date}|${g.received_amount}|${g.fund_name}`}`;
          if (!seen.has(key)) { gifts.push(g); seen.add(key); }
        }
      }
    } catch (err) {
      console.warn(`[lgl-api] gift_date_from axis failed (${err.message}) — continuing with updated_from only`);
    }
  }

  // Filter by fund client-side since LGL API doesn't support fund_name as a query param
  if (fundFilter) {
    const filterLower = fundFilter.toLowerCase();
    return gifts.filter(g => (g.fund_name || "").toLowerCase() === filterLower);
  }
  return gifts;
}

// Convert an LGL API gift object to a row matching the spreadsheet columns
function apiGiftToRow(gift, dateCol, amountCol, fundCol) {
  const row = {};
  row[dateCol] = gift.received_date || "";
  row[amountCol] = gift.received_amount || 0;
  row[fundCol] = gift.fund_name || "";
  return row;
}

// Normalize any date value to YYYY-MM-DD for consistent dedup
function normalizeDateForDedup(val) {
  if (!val) return "";
  // Excel serial number (e.g. 46093)
  const num = typeof val === "number" ? val : parseFloat(val);
  if (!isNaN(num) && num > 25000 && num < 60000) {
    const d = new Date(1899, 11, 30 + Math.round(num));
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  // Try parsing as date string
  const d = new Date(val);
  if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  return String(val).trim();
}

// Build a dedup key from a row
function deduplicateKey(row, dateCol, amountCol, fundCol) {
  const dateStr = normalizeDateForDedup(row[dateCol]);
  const amount = parseFloat(String(row[amountCol] || "0").replace(/[$,]/g, "")) || 0;
  const fund = String(row[fundCol] || "").trim().toLowerCase();
  return `${dateStr}|${amount.toFixed(2)}|${fund}`;
}

// 5-minute in-memory cache
const hybridCache = {};
const CACHE_TTL = 5 * 60 * 1000;

async function hybridFetch(permanentLinkUrl, fundFilter, res, axis) {
  // Check cache (axis-qualified so v1 and v2 responses never cross-serve)
  const cacheKey = `${fundFilter || "__all__"}|${axis || "updated"}`;
  const cached = hybridCache[cacheKey];
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log(`[hybrid] Serving cached response for ${cacheKey}`);
    return res.json(cached.data);
  }

  // 1. Fetch the permanent link
  console.log(`[hybrid] Fetching permanent link...`);
  const resp = await fetch(permanentLinkUrl);
  if (!resp.ok) throw new Error(`LGL permanent link returned ${resp.status}`);
  const buf = await resp.arrayBuffer();
  const ct = resp.headers.get("content-type") || "";

  // 2. Extract report date from Content-Disposition filename, fallback to 60 days ago
  const cd = resp.headers.get("content-disposition") || "";
  const dateMatch = cd.match(/(\d{4}-\d{2}-\d{2})/);
  const fallbackDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const reportDate = dateMatch ? dateMatch[1] : fallbackDate;

  // 3. Parse spreadsheet into rows
  const rows = parseSpreadsheetServer(buf, ct);
  console.log(`[hybrid] Permanent link: ${rows.length} rows, report date: ${reportDate}`);

  // 4. Detect columns
  const headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  const { dateCol, amountCol, fundCol } = detectColumnsServer(headers);

  let apiGiftsAdded = 0;

  // 5. If we have the API key, fetch recent gifts to top up the permanent link data
  if (LGL_API_KEY && dateCol && amountCol && fundCol) {
    try {
      const apiGifts = await fetchLGLApiGifts(reportDate, fundFilter, axis);
      console.log(`[hybrid] API returned ${apiGifts.length} gifts since ${reportDate}`);

      // Build dedup set from permanent link rows
      const seen = new Set();
      for (const row of rows) {
        seen.add(deduplicateKey(row, dateCol, amountCol, fundCol));
      }

      // Add new API gifts that aren't already in the permanent link
      for (const gift of apiGifts) {
        const newRow = apiGiftToRow(gift, dateCol, amountCol, fundCol);
        const key = deduplicateKey(newRow, dateCol, amountCol, fundCol);
        if (!seen.has(key)) {
          rows.push(newRow);
          seen.add(key);
          apiGiftsAdded++;
        }
      }
      console.log(`[hybrid] Added ${apiGiftsAdded} new gifts from API`);
    } catch (err) {
      console.warn("[hybrid] API top-up failed, returning permanent link data only:", err.message);
    }
  } else if (!LGL_API_KEY) {
    console.log("[hybrid] No LGL_API_KEY set, skipping API top-up");
  }

  const result = {
    rows,
    reportDate,
    refreshedAt: new Date().toISOString(),
    apiGiftsAdded,
  };

  // Cache the result
  hybridCache[cacheKey] = { time: Date.now(), data: result };

  res.json(result);
}

// Hybrid endpoints
app.get("/api/lgl-data-hybrid", requireAuth, async (req, res) => {
  const axis = req.query.axis === "union" ? "union" : undefined; // v1 sends nothing
  try { await hybridFetch(LGL_OFFERTORY_URL, OFFERTORY_FUND, res, axis); }
  catch (err) { console.error("Hybrid fetch error:", err); res.status(502).json({ error: err.message }); }
});

// Lightweight API-only endpoint: returns recent gifts as JSON rows.
// No XLSX parsing — safe for memory. Frontend merges these into its own parsed data.
app.get("/api/lgl-recent-gifts", requireAuth, async (req, res) => {
  const sinceDate = req.query.since; // e.g. "2026-03-27"
  if (!sinceDate || !/^\d{4}-\d{2}-\d{2}$/.test(sinceDate)) {
    return res.status(400).json({ error: "Missing or invalid 'since' param (YYYY-MM-DD)" });
  }
  if (!LGL_API_KEY) {
    return res.json({ gifts: [], message: "No LGL_API_KEY configured" });
  }

  const axis = req.query.axis === "union" ? "union" : undefined; // v1 sends nothing

  // Check cache
  const cacheKey = `recent_${sinceDate}|${axis || "updated"}`;
  const cached = hybridCache[cacheKey];
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log(`[recent] Serving cached response`);
    return res.json(cached.data);
  }

  try {
    const apiGifts = await fetchLGLApiGifts(sinceDate, undefined, axis);
    console.log(`[recent] API returned ${apiGifts.length} gifts since ${sinceDate}`);
    // Return minimal row data the frontend can merge
    const gifts = apiGifts.map(g => ({
      date: g.received_date || "",
      amount: g.received_amount || 0,
      fund: g.fund_name || "",
    }));
    const result = { gifts, refreshedAt: new Date().toISOString() };
    hybridCache[cacheKey] = { time: Date.now(), data: result };
    res.json(result);
  } catch (err) {
    console.error("[recent] API error:", err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Plate-status detector (v2 evidence-based completeness) ───
// Eric's export-imports are PLANNED for Mon/Thu but are manual and can slip,
// so the client must not trust the calendar alone. This asks LGL whether any
// gift in the newest ended Mon-Sun week carries a plate-money payment type
// (check/cash). plateLanded: true = the count is in; false = no plate gifts
// for that week yet; null = cannot tell (no key, API error, LGL returned no
// payment-type fields, or a suspected ignored-key dump) — on null the client
// falls back to the calendar rule, so this can never make things worse.
app.get("/api/lgl-plate-status", requireAuth, async (req, res) => {
  const fmtDay = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  // The client names the week it cares about (its newest ended Sunday) so a
  // server-timezone day shift can never make the two disagree; fall back to
  // computing it here if the param is absent.
  let endSunday;
  if (/^\d{4}-\d{2}-\d{2}$/.test(req.query.week || "")) {
    const [wy, wm, wd] = req.query.week.split("-").map(Number);
    endSunday = new Date(wy, wm - 1, wd);
  } else {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dow = today.getDay(); // 0 Sun
    const upcoming = dow === 0 ? today
      : new Date(today.getFullYear(), today.getMonth(), today.getDate() + (7 - dow));
    endSunday = upcoming.getTime() <= today.getTime() ? upcoming
      : new Date(upcoming.getFullYear(), upcoming.getMonth(), upcoming.getDate() - 7);
  }
  const weekStart = new Date(endSunday.getFullYear(), endSunday.getMonth(), endSunday.getDate() - 6);
  const weekKey = fmtDay(endSunday);

  if (!LGL_API_KEY) {
    return res.json({ week: weekKey, plateLanded: null, message: "No LGL_API_KEY configured" });
  }
  const cacheKey = `plate_${weekKey}`;
  const cached = hybridCache[cacheKey];
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return res.json(cached.data);
  }

  try {
    const raw = await fetchLGLApiGiftsAxis(`gift_date_from=${fmtDay(weekStart)}`);
    // If LGL ignored the key and dumped everything, the page cap may have
    // truncated the dump before this week's gifts — evidence unreliable.
    const capped = raw.length >= PAGE_CAP_SUSPECT;
    const items = raw.filter(g => {
      const d = g.received_date || "";
      return d >= fmtDay(weekStart) && d <= weekKey;
    });
    const typeOf = paymentTypeOf; // shared with the hub exit
    const types = [...new Set(items.map(typeOf).filter(Boolean))];
    const typed = items.filter(g => typeOf(g));
    // isPlateType is imported from hub-exit.js so the plate/online split has
    // exactly one definition. The PLT hub reads the same predicate.
    const plateLanded = capped || typed.length === 0
      ? null
      : typed.some(g => isPlateType(typeOf(g)));
    console.log(`[plate] week ${weekKey}: ${items.length} gifts in week, types=[${types.join(", ")}], capped=${capped}, plateLanded=${plateLanded}`);
    const result = { week: weekKey, plateLanded, giftCount: items.length, types, refreshedAt: new Date().toISOString() };
    hybridCache[cacheKey] = { time: Date.now(), data: result };
    res.json(result);
  } catch (err) {
    console.warn(`[plate] detector failed (${err.message}) — client falls back to calendar rule`);
    res.json({ week: weekKey, plateLanded: null, error: err.message });
  }
});

// ─── PLT hub exit: read-only aggregates on a machine token ───
// EXACT path, and deliberately NOT requireAuth. requireAuth is session based,
// and the auth gate below waves through anything whose path starts with "/api",
// so this route checks its own bearer token in constant time. Aggregates only:
// no donor name, no email, no gift id, no address. See hub-exit.js and
// docs/exit-contract.md in the st-edward-plt-dashboard repo.
app.get("/api/hub/v1/metrics", hubMetricsHandler({
  fetchGiftsAxis: fetchLGLApiGiftsAxis,
  hasApiKey: () => Boolean(LGL_API_KEY),
}));

// Anything else under /api/hub is refused right here. Without this it would fall
// through to the SPA catch-all at the bottom and answer 200 with the dashboard
// shell, which is not data but is also not a "no".
app.use("/api/hub", (req, res) => {
  res.status(404).json({ error: "no such endpoint" });
});

// ─── Auth gate: redirect unauthenticated users to login ───
if (AUTH_ENABLED) {
  app.use((req, res, next) => {
    // Allow auth routes, and static assets (js, css, svg, etc.)
    if (req.path.startsWith("/auth") || req.path.startsWith("/api")) return next();
    if (/\.(js|css|svg|png|ico|woff2?|ttf|map)$/.test(req.path)) return next();
    if (!req.session.user) return res.redirect("/auth/login");
    next();
  });
}

// ─── Staff guide: the internal doc as a live page, behind the same SSO ───
// (the auth gate above covers /docs; only /auth, /api, and asset extensions bypass it)
app.get("/docs", (req, res) => {
  res.sendFile(join(__dirname, "staff-guide.html"));
});

// ─── Static files & SPA ───
app.use(express.static(join(__dirname, "dist")));
app.get("/{*splat}", (req, res) => {
  res.sendFile(join(__dirname, "dist", "index.html"));
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Auth: ${AUTH_ENABLED ? "ENABLED" : "DISABLED (no CLIENT_SECRET)"}`);
  if (AUTH_ENABLED) {
    console.log(`Allowed users: ${ALLOWED_USERS.join(", ")}`);
  }
});
