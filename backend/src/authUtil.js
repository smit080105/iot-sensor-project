const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const pool = require("./db");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || Buffer.byteLength(JWT_SECRET) < 32) {
  throw new Error("JWT_SECRET must be configured with at least 32 bytes before the backend can start");
}

/**
 * Hash a plain text password using bcrypt
 */
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, 10);
}

/**
 * Compare a plain text password against a bcrypt hash
 */
async function comparePassword(plainPassword, passwordHash) {
  return bcrypt.compare(plainPassword, passwordHash);
}

/**
 * Generate a signed JWT token valid for 24 hours
 */
function generateToken(user) {
  const payload = {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role,
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: "24h" });
}

/**
 * Verify a JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return null;
  }
}

/**
 * Ensure the users table exists and seed default admin & viewer accounts if empty
 */
async function initUsersTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id            SERIAL PRIMARY KEY,
        username      VARCHAR(50) NOT NULL UNIQUE,
        email         VARCHAR(255) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role          VARCHAR(20) NOT NULL DEFAULT 'viewer',
        created_at    TIMESTAMPTZ DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
      CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);
    `);

    // Never create accounts with a shared, built-in password.
    const adminUsername = process.env.INITIAL_ADMIN_USERNAME;
    const adminEmail = process.env.INITIAL_ADMIN_EMAIL;
    const adminPassword = process.env.INITIAL_ADMIN_PASSWORD;
    const adminCheck = adminUsername && adminEmail
      ? await pool.query("SELECT id FROM users WHERE username = $1 OR email = $2", [adminUsername, adminEmail])
      : await pool.query("SELECT id FROM users WHERE role = 'admin'");
    if (adminCheck.rows.length === 0 && adminUsername && adminEmail && adminPassword) {
      const adminHash = await hashPassword(adminPassword);
      await pool.query(
        "INSERT INTO users (username, email, password_hash, role) VALUES ($1, $2, $3, $4)",
        [adminUsername, adminEmail, adminHash, "admin"]
      );
      console.log(`[auth] Seeded initial administrator account: ${adminEmail}`);
    } else if (adminCheck.rows.length === 0) {
      console.warn("[auth] No administrator exists. Set INITIAL_ADMIN_USERNAME, INITIAL_ADMIN_EMAIL, and INITIAL_ADMIN_PASSWORD to seed one.");
    }

    // Viewer accounts should be created through the managed user process,
    // rather than by shipping a shared default credential.
  } catch (err) {
    console.error("[auth] Failed to initialize users table:", err.message);
  }
}

module.exports = {
  hashPassword,
  comparePassword,
  generateToken,
  verifyToken,
  initUsersTable,
};
