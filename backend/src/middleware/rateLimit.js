const rateLimit = require("express-rate-limit");

const skipInTest = () => process.env.NODE_ENV === "test";

// General limiter for all /api/* traffic (reads + writes). Generous
// enough for normal dashboard polling (the frontend polls every 10s),
// tight enough to blunt scripted abuse.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120, // ~2 req/sec sustained per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many requests — please slow down." },
});

// Stricter limiter specifically for the CSV upload / registry-mutation
// endpoint. This is the single most sensitive route in the app (it can
// add/remove devices and cascade-delete their history), so it gets its
// own tight budget independent of general API traffic.
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many upload attempts — please wait before retrying." },
});

// Strictest limiter for authentication, key exchange, or device pairing routes
// Max 5 attempts per 15 minutes to resist brute-force and credential stuffing.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Too many authentication/registration attempts. Locked for 15 minutes." },
});

// High-capacity limiter for health checks (uptime monitors, container orchestrators)
const healthLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipInTest,
  message: { error: "Healthcheck rate limit exceeded." },
});

module.exports = {
  generalLimiter,
  uploadLimiter,
  authLimiter,
  healthLimiter,
};
