import express from "express";
import session from "express-session";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import * as XLSX from "xlsx";

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

// Helper to proxy an LGL permanent link
async function proxyLGL(url, res) {
  const resp = await fetch(url);
  if (!resp.ok) {
    return res.status(resp.status).json({ error: `LGL returned ${resp.status}` });
  }
  const buf = await resp.arrayBuffer();
  // Forward the actual content type from LGL (could be xlsx or csv)
  const ct = resp.headers.get("content-type") || "application/octet-stream";
  res.set("Content-Type", ct);
  // Extract report date from Content-Disposition filename (e.g. "...Update 2026-03-15.xlsx")
  const cd = resp.headers.get("content-disposition") || "";
  const dateMatch = cd.match(/(\d{4}-\d{2}-\d{2})/);
  if (dateMatch) {
    res.set("X-Report-Date", dateMatch[1]);
  }
  res.send(Buffer.from(buf));
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

// Fetch gifts from LGL API since a given date, optionally filtered by fund
async function fetchLGLApiGifts(sinceDate, fundFilter) {
  const gifts = [];
  let offset = 0;
  const limit = 100;
  const maxPages = 50;

  for (let page = 0; page < maxPages; page++) {
    const params = new URLSearchParams();
    params.append("q[]", `updated_from=${sinceDate}`);
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

async function hybridFetch(permanentLinkUrl, fundFilter, res) {
  // Check cache
  const cacheKey = fundFilter || "__all__";
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
      const apiGifts = await fetchLGLApiGifts(reportDate, fundFilter);
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
  try { await hybridFetch(LGL_OFFERTORY_URL, "Offertory", res); }
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

  // Check cache
  const cacheKey = `recent_${sinceDate}`;
  const cached = hybridCache[cacheKey];
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    console.log(`[recent] Serving cached response`);
    return res.json(cached.data);
  }

  try {
    const apiGifts = await fetchLGLApiGifts(sinceDate);
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
