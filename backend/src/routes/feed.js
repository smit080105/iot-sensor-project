const express = require("express");
const pool = require("../db");

const router = express.Router();

// GET /api/feed — latest device_remo/<dongle_id>/feed payload per device
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dongle_id, mac_address, data, updated_at FROM device_feed ORDER BY dongle_id`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[feed] Failed to query device_feed:", err.message);
    res.status(500).json({ error: "Could not read device feed" });
  }
});

// GET /api/feed/:dongleId — single device's latest feed payload
router.get("/:dongleId", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT dongle_id, mac_address, data, updated_at FROM device_feed WHERE dongle_id = $1`,
      [req.params.dongleId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "No feed update received for this device yet" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[feed] Failed to query device_feed:", err.message);
    res.status(500).json({ error: "Could not read device feed" });
  }
});

module.exports = router;
