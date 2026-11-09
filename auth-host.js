// Sign-in has to begin on the address Microsoft sends the user back to. The
// state that proves the round trip lives in a session cookie, and a cookie set
// on lgl.onrender.com is never sent to lgldash.stedward.org, so a sign-in begun
// on one and returned to the other ended on "Invalid State".

// Where /auth/login should send this request first, or null to carry on here.
// The target comes from the configured callback, never from the request.
// `moved` is set on the hop itself, so a host this server misreads costs one
// extra redirect rather than a loop on the address that works.
export function signInHostRedirect(requestHost, redirectUri, moved) {
  if (moved) return null;
  let callback;
  try { callback = new URL(redirectUri); } catch { return null; }
  const host = String(requestHost || "").trim().toLowerCase().replace(/:\d+$/, "");
  if (!host || host === callback.hostname.toLowerCase()) return null;
  return `${callback.origin}/auth/login?moved=1`;
}
