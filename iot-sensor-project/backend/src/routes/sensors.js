const express = require("express");
const pool = require("../db");

const router = express.Router();

// Latest N readings (default 50) — only ever contains data from authorized MACs
router.get("/", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 500);
  try {
    const result = await pool.query(
      `SELECT id, mac_address, sensor_id, sensor_type, value, unit, received_at
       FROM sensor_readings
       ORDER BY received_at DESC
       LIMIT $1`,
      [limit]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[sensors] Failed to query sensor_readings:", err.message);
    res.status(500).json({ error: "Could not read sensor data" });
  }
});

// Latest reading per sensor_id + sensor_type. A single dongle now reports
// several distinct sensor types (temperature, humidity, accel_x/y/z,
// gyro_x/y/z) all sharing the same sensor_id — keying DISTINCT ON by
// sensor_id alone (the old behavior) collapsed all of them down to
// whichever type happened to be inserted last, which is why only one
// live card was ever showing. Keying by (sensor_id, sensor_type) keeps
// the latest value of EACH type.
router.get("/latest", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (sensor_id, sensor_type) mac_address, sensor_id, sensor_type, value, unit, received_at
       FROM sensor_readings
       ORDER BY sensor_id, sensor_type, received_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[sensors] Failed to query latest readings:", err.message);
    res.status(500).json({ error: "Could not read sensor data" });
  }
});

module.exports = router;
