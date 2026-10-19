const express = require("express");
const mqttModule = require("../mqtt");

const router = express.Router();

// GET /api/debug/reg-log — recent registration outcomes. Pairing tokens and
// raw payloads are redacted before these events reach the dashboard.
router.get("/reg-log", (req, res) => {
  res.json(mqttModule.getRecentRegAttempts());
});

module.exports = router;
