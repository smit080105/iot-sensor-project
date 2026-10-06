const express = require("express");
const pool = require("../db");
const { comparePassword, generateToken } = require("../authUtil");
const { authLimiter } = require("../middleware/rateLimit");
const { authenticateToken } = require("../middleware/auth");
const { logAuditEvent, getClientIp } = require("../auditLogger");

const router = express.Router();

/**
 * POST /api/auth/login
 * Authenticates user credentials and issues a 24-hour signed JWT token.
 * Protected by authLimiter (max 5 requests per 15 minutes per IP).
 */
router.post("/login", authLimiter, async (req, res) => {
  const { identifier, username, email, password } = req.body;
  const loginId = (identifier || username || email || "").trim();
  const clientIp = getClientIp(req);

  if (!loginId || !password) {
    return res.status(400).json({ error: "Username/email and password are required." });
  }

  try {
    const result = await pool.query(
      "SELECT id, username, email, password_hash, role FROM users WHERE LOWER(email) = LOWER($1) OR LOWER(username) = LOWER($1)",
      [loginId]
    );

    if (result.rows.length === 0) {
      console.warn(`[auth] Failed login attempt for user: ${loginId} (user not found)`);
      logAuditEvent({
        username: loginId,
        action: "USER_LOGIN_FAILED",
        resourceType: "AUTH",
        ipAddress: clientIp,
        details: { reason: "User not found" },
      });
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    const user = result.rows[0];
    const passwordMatches = await comparePassword(password, user.password_hash);

    if (!passwordMatches) {
      console.warn(`[auth] Failed login attempt for user: ${loginId} (invalid password)`);
      logAuditEvent({
        userId: user.id,
        username: user.username,
        action: "USER_LOGIN_FAILED",
        resourceType: "AUTH",
        ipAddress: clientIp,
        details: { reason: "Invalid password" },
      });
      return res.status(401).json({ error: "Invalid username/email or password." });
    }

    const token = generateToken(user);
    console.log(`[auth] User logged in successfully: ${user.username} (${user.role})`);
    logAuditEvent({
      userId: user.id,
      username: user.username,
      action: "USER_LOGIN",
      resourceType: "AUTH",
      ipAddress: clientIp,
      details: { role: user.role },
    });

    return res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
      },
    });
  } catch (err) {
    console.error("[auth] Login database query error:", err.message);
    return res.status(500).json({ error: "Internal server error during authentication." });
  }
});

/**
 * GET /api/auth/me
 * Returns current authenticated user profile
 */
router.get("/me", authenticateToken, (req, res) => {
  res.json({
    user: req.user,
  });
});

/**
 * POST /api/auth/logout
 * Client-side logout acknowledgment
 */
router.post("/logout", (req, res) => {
  res.json({ message: "Logged out successfully." });
});

module.exports = router;
