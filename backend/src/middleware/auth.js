const crypto = require("crypto");
const { verifyToken } = require("../authUtil");

const API_KEY = process.env.API_KEY || "";

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function isValidApiKey(candidate) {
  if (!API_KEY || !candidate) return false;
  return timingSafeEqual(candidate, API_KEY);
}

/**
 * Universal Authentication Middleware
 * Validates either:
 * 1. Modern JWT session: Authorization: Bearer <token>
 * 2. Legacy / Service Account header: x-api-key: <API_KEY>
 */
function authenticateToken(req, res, next) {
  const authHeader = req.header("authorization") || req.header("Authorization");
  let token = null;

  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  // 1. Verify JWT Token if provided
  if (token) {
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
      return next();
    }
    console.warn(`[auth] Rejected request to ${req.method} ${req.originalUrl} — invalid/expired JWT token`);
    return res.status(401).json({ error: "Session expired or invalid token. Please log in again." });
  }

  // 2. Fallback to API Key authentication
  const providedApiKey = req.header("x-api-key");
  if (providedApiKey && isValidApiKey(providedApiKey)) {
    req.user = { id: 0, username: "api-service", role: "admin" };
    return next();
  }

  console.warn(`[auth] Unauthorized access attempt to ${req.method} ${req.originalUrl}`);
  return res.status(401).json({ error: "Unauthorized: Missing authentication token or valid API key." });
}

/**
 * Role-Based Access Control (RBAC) Guard
 * Ensures authenticated user has the required role (e.g. 'admin')
 */
function requireRole(role) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized: Please log in." });
    }
    if (req.user.role !== role) {
      console.warn(`[rbac] Access denied for user ${req.user.username} (${req.user.role}) — requires ${role}`);
      return res.status(403).json({ error: `Forbidden: This action requires '${role}' privileges.` });
    }
    next();
  };
}

// Shorthand for Admin-only routes (CSV upload, registry modifications)
const requireAdmin = requireRole("admin");

// Backward-compatible alias
const requireApiKey = authenticateToken;

module.exports = {
  authenticateToken,
  requireRole,
  requireAdmin,
  requireApiKey,
  isValidApiKey,
  timingSafeEqual,
};
