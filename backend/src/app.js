const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const { authenticateToken } = require("./middleware/auth");
const { generalLimiter, healthLimiter } = require("./middleware/rateLimit");
const authRouter = require("./routes/auth");
const devicesRouter = require("./routes/devices");
const sensorsRouter = require("./routes/sensors");
const debugRouter = require("./routes/debug");
const statusRouter = require("./routes/status");
const feedRouter = require("./routes/feed");
const alertsRouter = require("./routes/alerts");
const auditRouter = require("./routes/audit");

const app = express();

// Security headers (CSP, X-Content-Type-Options, HSTS when behind TLS, etc.)
app.use(helmet());

// Only the configured frontend origin may call this API from a browser.
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;
if (!ALLOWED_ORIGIN && process.env.NODE_ENV !== "test") {
  console.warn(
    "[cors] ALLOWED_ORIGIN is not set — cross-origin browser requests will be blocked. " +
      "Set ALLOWED_ORIGIN in backend/.env if the frontend runs on a different origin."
  );
}
app.use(
  cors({
    origin: ALLOWED_ORIGIN || false,
    methods: ["GET", "POST", "PATCH"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization", "authorization"],
  })
);

app.use(express.json({ limit: "1mb" }));

// General throttling for /api requests (disabled in test environment to avoid 429 flaky tests)
if (process.env.NODE_ENV !== "test") {
  app.use("/api", generalLimiter);
}

// Health check stays public and unauthenticated
app.get("/api/health", healthLimiter, (req, res) => res.json({ status: "ok" }));

// Public Authentication endpoints (Login is rate-limited via authLimiter)
app.use("/api/auth", authRouter);

// Everything else under /api requires a valid JWT session or API key.
app.use("/api", authenticateToken);

app.use("/api/devices", devicesRouter);
app.use("/api/sensors", sensorsRouter);
app.use("/api/debug", debugRouter);
app.use("/api/status", statusRouter);
app.use("/api/feed", feedRouter);
app.use("/api/alerts", alertsRouter);
app.use("/api/audit", auditRouter);

module.exports = app;
