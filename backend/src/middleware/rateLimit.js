const rateLimit = require("express-rate-limit");

// General limiter for all /api/* traffic (reads + writes). Generous
// enough for normal dashboard polling (the frontend polls every 10s),
// tight enough to blunt scripted abuse.
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  limit: 120, // ~2 req/sec sustained per IP
  standardHeaders: true,
  legacyHeaders: false,
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
  message: { error: "Too many upload attempts — please wait before retrying." },
});

module.exports = { generalLimiter, uploadLimiter };
