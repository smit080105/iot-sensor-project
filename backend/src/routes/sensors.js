const express = require("express");
const pool = require("../db");

const router = express.Router();

// Historical readings for a device and inclusive calendar date range.
router.get("/history", async (req, res) => {
  const { start, end, mac_address: macAddress } = req.query;
  const isDate = (value) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return false;
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  };
  if (!isDate(start) || !isDate(end) || start > end || !macAddress) {
    return res.status(400).json({ error: "A device MAC and valid start/end dates are required." });
  }

  try {
    const range = ["Last 24 hrs", "Last 7 days", "Last 30 days"].includes(req.query.range) ? req.query.range : "Custom range";
    const result = await pool.query(
      `WITH filtered AS (
         SELECT mac_address, sensor_id, sensor_type, value, unit, received_at,
           CASE $4
             WHEN 'Last 24 hrs' THEN 60
             WHEN 'Last 7 days' THEN 300
             WHEN 'Last 30 days' THEN 3600
             ELSE CASE
               WHEN ($3::date - $2::date) >= 7 THEN 3600
               WHEN ($3::date - $2::date) >= 1 THEN 300
               ELSE 60
             END
           END AS bucket_seconds
         FROM sensor_readings
         WHERE mac_address = $1
         AND received_at >= CASE $4
           WHEN 'Last 24 hrs' THEN now() - INTERVAL '24 hours'
           WHEN 'Last 7 days' THEN now() - INTERVAL '7 days'
           WHEN 'Last 30 days' THEN now() - INTERVAL '30 days'
           ELSE $2::date::timestamptz
         END
         AND received_at <= CASE $4
           WHEN 'Last 24 hrs' THEN now()
           WHEN 'Last 7 days' THEN now()
           WHEN 'Last 30 days' THEN now()
           ELSE ($3::date + INTERVAL '1 day')
         END
         AND sensor_type IN ('temperature', 'humidity')
       )
       SELECT mac_address, sensor_id, sensor_type, AVG(value) AS value, unit,
         to_timestamp(floor(extract(epoch FROM received_at) / bucket_seconds) * bucket_seconds) AS received_at
       FROM filtered
       GROUP BY mac_address, sensor_id, sensor_type, unit, bucket_seconds,
         floor(extract(epoch FROM received_at) / bucket_seconds)
       ORDER BY received_at ASC
       LIMIT 20000`,
      [macAddress, start, end, range]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[sensors] Failed to query sensor history:", err.message);
    res.status(500).json({ error: "Could not read sensor history" });
  }
});

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
