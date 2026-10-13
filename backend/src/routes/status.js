const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET /api/status — latest device_remo/<dongle_id>/status per device
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dongle_id, mac_address, state, uptime_sec, updated_at FROM device_status ORDER BY dongle_id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[status] Failed to query device_status:", err.message);
    res.status(500).json({ error: "Could not read device status" });
  }
});

// GET /api/status/:dongleId/history — recorded state changes and watchdog events
router.get("/:dongleId/history", async (req, res) => {
  const { start, end } = req.query;
  const isDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!isDate(start) || !isDate(end) || start > end) {
    return res.status(400).json({ error: "Valid start and end dates are required." });
  }

  const range = ["Last 24 hrs", "Last 7 days", "Last 30 days"].includes(req.query.range)
    ? req.query.range
    : "Custom range";
  try {
    const result = await pool.query(
      `SELECT id, dongle_id, mac_address, event_type, previous_state, state, uptime_sec, recorded_at
       FROM device_status_events
       WHERE dongle_id = $1
         AND recorded_at >= CASE $4
           WHEN 'Last 24 hrs' THEN now() - INTERVAL '24 hours'
           WHEN 'Last 7 days' THEN now() - INTERVAL '7 days'
           WHEN 'Last 30 days' THEN now() - INTERVAL '30 days'
           ELSE $2::date::timestamptz
         END
         AND recorded_at <= CASE $4
           WHEN 'Last 24 hrs' THEN now()
           WHEN 'Last 7 days' THEN now()
           WHEN 'Last 30 days' THEN now()
           ELSE ($3::date + INTERVAL '1 day')
         END
       ORDER BY recorded_at DESC
       LIMIT 500`,
      [req.params.dongleId, start, end, range]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[status] Failed to query device status history:", err.message);
    res.status(500).json({ error: "Could not read device status history" });
  }
});

// GET /api/status/:dongleId — single device's latest status
router.get("/:dongleId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dongle_id, mac_address, state, uptime_sec, updated_at FROM device_status WHERE dongle_id = $1`,
      [req.params.dongleId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No status received for this device yet" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[status] Failed to query device_status:", err.message);
    res.status(500).json({ error: "Could not read device status" });
  }
});

module.exports = router;
