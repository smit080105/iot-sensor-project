const pool = require("./db");

// Helper to extract client IP address
function getClientIp(req) {
  if (!req) return "127.0.0.1";
  const forwarded = req.headers && (req.headers["x-forwarded-for"] || req.headers["X-Forwarded-For"]);
  if (forwarded) {
    const ips = String(forwarded).split(",");
    return ips[0].trim();
  }
  const rawIp = (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || "127.0.0.1";
  return rawIp.replace(/^.*:/, "");
}

// Save audit log entry
async function logAuditEvent({
  userId = null,
  username = "anonymous",
  action,
  resourceType,
  resourceId = null,
  ipAddress = "127.0.0.1",
  details = {},
}) {
  try {
    const res = await pool.query(
      `INSERT INTO audit_logs (user_id, username, action, resource_type, resource_id, ip_address, details, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now())
       RETURNING id, username, action, resource_type, resource_id, ip_address, details, created_at`,
      [userId, username, action, resourceType, resourceId, ipAddress, JSON.stringify(details)]
    );

    console.log(`[audit] ${action} by ${username} from ${ipAddress} on ${resourceType}:${resourceId || "global"}`);
    return res.rows[0];
  } catch (err) {
    console.error("[audit] Failed to write audit event:", err.message);
    return null;
  }
}

// Create audit_logs table if not exists
async function initAuditTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id            SERIAL PRIMARY KEY,
        user_id       INTEGER REFERENCES users(id) ON DELETE SET NULL,
        username      VARCHAR(100),
        action        VARCHAR(50) NOT NULL,
        resource_type VARCHAR(50) NOT NULL,
        resource_id   VARCHAR(100),
        ip_address    VARCHAR(45),
        details       JSONB,
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
    `);
    console.log("[audit] Audit logs table initialized successfully");
  } catch (err) {
    console.error("[audit] Failed to initialize audit logs table:", err.message);
  }
}

module.exports = {
  logAuditEvent,
  getClientIp,
  initAuditTable,
};
