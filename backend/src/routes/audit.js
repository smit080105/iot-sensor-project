const express = require("express");
const pool = require("../db");
const { requireAdmin } = require("../middleware/auth");

const router = express.Router();

// GET /api/audit - list audit logs (admin only)
router.get("/", requireAdmin, async (req, res) => {
  const { action, username, limit = 50 } = req.query;
  const conditions = [];
  const params = [];

  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }

  if (username) {
    params.push(`%${username}%`);
    conditions.push(`LOWER(username) LIKE LOWER($${params.length})`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(Number(limit) || 50, 200));
  const limitClause = `LIMIT $${params.length}`;

  try {
    const result = await pool.query(
      `SELECT id, user_id, username, action, resource_type, resource_id, ip_address, details, created_at
       FROM audit_logs
       ${whereClause}
       ORDER BY created_at DESC
       ${limitClause}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[audit] Failed to fetch audit records:", err.message);
    res.status(500).json({ error: "Could not fetch audit records" });
  }
});

// GET /api/audit/summary - 24-hour stats summary
router.get("/summary", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) AS total_events,
        COUNT(*) FILTER (WHERE action = 'USER_LOGIN' AND created_at > now() - interval '24 hours') AS logins_24h,
        COUNT(*) FILTER (WHERE action = 'USER_LOGIN_FAILED' AND created_at > now() - interval '24 hours') AS failed_logins_24h,
        COUNT(*) FILTER (WHERE action = 'CSV_UPLOAD_SYNC' AND created_at > now() - interval '24 hours') AS csv_syncs_24h
      FROM audit_logs;
    `);

    const row = result.rows[0];
    res.json({
      total_events: Number(row.total_events || 0),
      logins_24h: Number(row.logins_24h || 0),
      failed_logins_24h: Number(row.failed_logins_24h || 0),
      csv_syncs_24h: Number(row.csv_syncs_24h || 0),
    });
  } catch (err) {
    console.error("[audit] Failed to fetch audit summary:", err.message);
    res.status(500).json({ error: "Could not fetch audit summary" });
  }
});

module.exports = router;
