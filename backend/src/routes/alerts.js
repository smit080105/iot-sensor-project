const express = require("express");
const pool = require("../db");
const { broadcast } = require("../ws");
const { logAuditEvent, getClientIp } = require("../auditLogger");

const router = express.Router();

// Historical alert events for one device and an inclusive date or rolling range.
router.get("/history", async (req, res) => {
  const { dongle_id: dongleId, start, end } = req.query;
  const isDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!dongleId || !isDate(start) || !isDate(end) || start > end) {
    return res.status(400).json({ error: "A device ID and valid start/end dates are required." });
  }

  const range = ["Last 24 hrs", "Last 7 days", "Last 30 days"].includes(req.query.range)
    ? req.query.range
    : "Custom range";
  try {
    const result = await pool.query(
      `SELECT id, dongle_id, mac_address, alert_type, severity, message, reading_value, unit, status, created_at, resolved_at
       FROM alerts
       WHERE dongle_id = $1
         AND created_at >= CASE $4
           WHEN 'Last 24 hrs' THEN now() - INTERVAL '24 hours'
           WHEN 'Last 7 days' THEN now() - INTERVAL '7 days'
           WHEN 'Last 30 days' THEN now() - INTERVAL '30 days'
           ELSE $2::date::timestamptz
         END
         AND created_at <= CASE $4
           WHEN 'Last 24 hrs' THEN now()
           WHEN 'Last 7 days' THEN now()
           WHEN 'Last 30 days' THEN now()
           ELSE ($3::date + INTERVAL '1 day')
         END
       ORDER BY created_at DESC
       LIMIT 500`,
      [dongleId, start, end, range]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[alerts] Failed to fetch device alert history:", err.message);
    res.status(500).json({ error: "Could not fetch device activity" });
  }
});

/**
 * GET /api/alerts
 * Retrieve alert events with optional filtering by status or dongle_id
 */
router.get("/", async (req, res) => {
  const { status, dongle_id, limit = 50 } = req.query;
  const conditions = [];
  const params = [];

  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  if (dongle_id) {
    params.push(dongle_id);
    conditions.push(`dongle_id = $${params.length}`);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(Math.min(Number(limit) || 50, 200));
  const limitClause = `LIMIT $${params.length}`;

  try {
    const result = await pool.query(
      `SELECT id, dongle_id, mac_address, alert_type, severity, message, reading_value, unit, status, created_at, resolved_at
       FROM alerts
       ${whereClause}
       ORDER BY 
         CASE WHEN status = 'ACTIVE' THEN 1 WHEN status = 'ACKNOWLEDGED' THEN 2 ELSE 3 END,
         created_at DESC
       ${limitClause}`,
      params
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[alerts] Failed to fetch alerts:", err.message);
    res.status(500).json({ error: "Could not fetch alert history" });
  }
});

/**
 * GET /api/alerts/summary
 * Active alert counts for badges and indicators
 */
router.get("/summary", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'ACTIVE') AS active_total,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND severity = 'CRITICAL') AS critical,
        COUNT(*) FILTER (WHERE status = 'ACTIVE' AND severity = 'WARNING') AS warning,
        COUNT(*) FILTER (WHERE status = 'ACKNOWLEDGED') AS acknowledged
      FROM alerts;
    `);

    const row = result.rows[0];
    res.json({
      active_total: Number(row.active_total || 0),
      critical: Number(row.critical || 0),
      warning: Number(row.warning || 0),
      acknowledged: Number(row.acknowledged || 0),
    });
  } catch (err) {
    console.error("[alerts] Failed to fetch alert summary:", err.message);
    res.status(500).json({ error: "Could not fetch alert summary" });
  }
});

/**
 * POST /api/alerts/:id/acknowledge
 * Mark an active alert as acknowledged by an operator
 */
router.post("/:id/acknowledge", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE alerts
       SET status = 'ACKNOWLEDGED'
       WHERE id = $1 AND status = 'ACTIVE'
       RETURNING id, dongle_id, mac_address, alert_type, severity, message, status, created_at`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Alert not found or already acknowledged/resolved." });
    }

    const updated = result.rows[0];
    console.log(`[alerts] Alert #${id} acknowledged by operator`);
    logAuditEvent({
      userId: req.user?.id || null,
      username: req.user?.username || "operator",
      action: "ALERT_ACKNOWLEDGED",
      resourceType: "ALERT",
      resourceId: String(id),
      ipAddress: getClientIp(req),
      details: { dongle_id: updated.dongle_id, alert_type: updated.alert_type, severity: updated.severity },
    });
    broadcast({ type: "alert-acknowledged", data: updated });
    res.json({ message: "Alert acknowledged.", alert: updated });
  } catch (err) {
    console.error(`[alerts] Failed to acknowledge alert #${id}:`, err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

/**
 * POST /api/alerts/:id/resolve
 * Manually resolve an alert
 */
router.post("/:id/resolve", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      `UPDATE alerts
       SET status = 'RESOLVED', resolved_at = now()
       WHERE id = $1 AND status != 'RESOLVED'
       RETURNING id, dongle_id, mac_address, alert_type, severity, message, status, resolved_at`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Alert not found or already resolved." });
    }

    const updated = result.rows[0];
    console.log(`[alerts] Alert #${id} manually resolved by operator`);
    logAuditEvent({
      userId: req.user?.id || null,
      username: req.user?.username || "operator",
      action: "ALERT_RESOLVED",
      resourceType: "ALERT",
      resourceId: String(id),
      ipAddress: getClientIp(req),
      details: { dongle_id: updated.dongle_id, alert_type: updated.alert_type, severity: updated.severity },
    });
    broadcast({ type: "alert-resolved", data: updated });
    res.json({ message: "Alert resolved.", alert: updated });
  } catch (err) {
    console.error(`[alerts] Failed to resolve alert #${id}:`, err.message);
    res.status(500).json({ error: "Internal server error." });
  }
});

module.exports = router;
