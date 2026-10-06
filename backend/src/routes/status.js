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
