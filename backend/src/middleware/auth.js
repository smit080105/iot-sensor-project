const crypto = require("crypto");

// All /api routes (except /api/health) require this header:
//   x-api-key: <API_KEY>
//
// Constant-time comparison is used so response timing can't be used to
// guess the key one byte at a time (a real, if minor, side-channel with
// naive === comparisons on secrets).
//
// Fails closed: if API_KEY isn't configured at all, every request is
// rejected with a 500 rather than silently allowing everyone through.
// This is deliberate — a missing secret should break loudly in every
// environment (including local dev), not just in production.

const API_KEY = process.env.API_KEY || "";

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    // Still run a comparison of equal-length buffers so the function
    // takes similar time whether or not lengths matched, then return
    // false — avoids leaking key length via early-return timing.
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function requireApiKey(req, res, next) {
  if (!API_KEY) {
    console.error(
      "[auth] API_KEY is not set — refusing all API requests. Set API_KEY in backend/.env (see .env.example)."
    );
    return res.status(500).json({ error: "Server misconfiguration: API key not set" });
  }

  const provided = req.header("x-api-key");
  if (!provided || !timingSafeEqual(provided, API_KEY)) {
    console.warn(`[auth] Rejected request to ${req.method} ${req.originalUrl} — missing/invalid x-api-key`);
    return res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
  }

  next();
}

// Used by the WebSocket upgrade handler, where there's no header to read
// (browsers can't set custom headers on the WebSocket handshake), so the
// key travels as a query parameter instead: wss://host/?apiKey=...
function isValidApiKey(candidate) {
  if (!API_KEY || !candidate) return false;
  return timingSafeEqual(candidate, API_KEY);
}

module.exports = { requireApiKey, isValidApiKey };
