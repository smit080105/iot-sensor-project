const express = require("express");
const mqttModule = require("../mqtt");

const router = express.Router();

// GET /api/debug/reg-log — last ~30 DEVICE_reg attempts the backend has
// seen, with the raw payload, parsed mac/token, and outcome. This is the
// easiest way to SEE what she's actually publishing, right from the
// dashboard, instead of scrolling `docker logs backend`.
router.get("/reg-log", (req, res) => {
  res.json(mqttModule.getRecentRegAttempts());
});

module.exports = router;
