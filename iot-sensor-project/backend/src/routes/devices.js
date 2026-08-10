const express = require("express");
const multer = require("multer");
const pool = require("../db");
const { syncDevicesFromCsvText } = require("../csvSync");

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage() });

// GET /api/devices — full registry (from Postgres, kept in sync with the last uploaded CSV)
router.get("/", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT mac_address, serial_number, product_type, dongle_id, created_at FROM devices ORDER BY id"
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[devices] Failed to fetch devices:", err.message);
    res.status(500).json({ error: "Could not read device registry" });
  }
});

// POST /api/devices/upload — upload a devices.csv and sync the registry to it.
// This CSV IS the registry now: adds any row with a mac_address +
// dongle_id that isn't registered yet, removes any previously-registered
// device no longer in this CSV, and rejects any row missing either field.
router.post("/upload", upload.single("file"), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: "No CSV file uploaded (expected form field 'file')" });
  }

  try {
    const csvText = req.file.buffer.toString("utf-8");
    const summary = await syncDevicesFromCsvText(csvText);
    res.json({
      message: "CSV processed.",
      added: summary.added,
      removed: summary.removed,
      rejected: summary.rejected,
      total_registered: summary.total,
    });
  } catch (err) {
    console.error("[devices] CSV upload failed:", err.message);
    res.status(400).json({ error: `Could not process CSV: ${err.message}` });
  }
});

// GET /api/devices/:mac — single device lookup (kept last: it's a catch-all param route)
router.get("/:mac", async (req, res) => {
  const mac = req.params.mac.toUpperCase();
  try {
    const result = await pool.query(
      "SELECT mac_address, serial_number, product_type, dongle_id, created_at FROM devices WHERE mac_address = $1",
      [mac]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Device not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[devices] Failed to fetch device:", err.message);
    res.status(500).json({ error: "Could not read device" });
  }
});

module.exports = router;
