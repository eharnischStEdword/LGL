import express from "express";
import session from "express-session";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

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
  // Forward Last-Modified so the frontend knows when LGL generated the report
  const lm = resp.headers.get("last-modified");
  if (lm) res.set("Last-Modified", lm);
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
