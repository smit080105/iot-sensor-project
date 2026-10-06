const pool = require("./db");
const { broadcast } = require("./ws");

// Sensor threshold limits
const THRESHOLDS = {
  temperature: {
    critical: 35, // °C
    warning: 30,
    safeMax: 28,
  },
  voltage: {
    surgeMax: 250, // V
    sagMin: 190,
    safeMin: 200,
    safeMax: 245,
  },
  current: {
    critical: 15, // A
    warning: 10,
    safeMax: 8,
  },
};

// Create alerts table if not exists
async function initAlertsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS alerts (
        id            SERIAL PRIMARY KEY,
        dongle_id     VARCHAR(100) REFERENCES devices(dongle_id) ON DELETE CASCADE,
        mac_address   VARCHAR(17) REFERENCES devices(mac_address) ON DELETE CASCADE,
        alert_type    VARCHAR(50) NOT NULL,
        severity      VARCHAR(20) NOT NULL,
        message       TEXT NOT NULL,
        reading_value NUMERIC,
        unit          VARCHAR(20),
        status        VARCHAR(20) NOT NULL DEFAULT 'ACTIVE',
        created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
        resolved_at   TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status);
      CREATE INDEX IF NOT EXISTS idx_alerts_dongle_id ON alerts (dongle_id);
      CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC);
    `);
    console.log("[alerts] Alerts table initialized successfully");
  } catch (err) {
    console.error("[alerts] Failed to initialize alerts table:", err.message);
  }
}

/**
 * Check if an active/unresolved alert already exists for this device and alert type
 */
async function getActiveAlert(dongleId, alertType) {
  try {
    const res = await pool.query(
      `SELECT id, dongle_id, alert_type, severity, message, reading_value, unit, status, created_at
       FROM alerts
       WHERE dongle_id = $1 AND alert_type = $2 AND status IN ('ACTIVE', 'ACKNOWLEDGED')
       LIMIT 1`,
      [dongleId, alertType]
    );
    return res.rows[0] || null;
  } catch (err) {
    console.error(`[alerts] Error checking active alert for ${dongleId}:`, err.message);
    return null;
  }
}

/**
 * Trigger a new alert and broadcast live over WebSocket
 */
async function triggerAlert({ dongleId, mac, alertType, severity, message, value, unit }) {
  try {
    const existing = await getActiveAlert(dongleId, alertType);
    if (existing) {
      // Don't duplicate active alerts; optionally update reading value
      return existing;
    }

    const res = await pool.query(
      `INSERT INTO alerts (dongle_id, mac_address, alert_type, severity, message, reading_value, unit, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE')
       RETURNING id, dongle_id, mac_address, alert_type, severity, message, reading_value, unit, status, created_at`,
      [dongleId, mac, alertType, severity, message, value ?? null, unit ?? null]
    );

    const alert = res.rows[0];
    console.warn(`[alerts] Triggered ${severity} alert on ${dongleId}: ${message}`);

    // Broadcast to connected web dashboards instantly
    broadcast({ type: "new-alert", data: alert });
    return alert;
  } catch (err) {
    console.error(`[alerts] Failed to insert alert for ${dongleId}:`, err.message);
    return null;
  }
}

/**
 * Auto-resolve an alert when metric returns to safe bounds or device recovers
 */
async function resolveAlert(dongleId, alertType) {
  try {
    const res = await pool.query(
      `UPDATE alerts
       SET status = 'RESOLVED', resolved_at = now()
       WHERE dongle_id = $1 AND alert_type = $2 AND status IN ('ACTIVE', 'ACKNOWLEDGED')
       RETURNING id, dongle_id, mac_address, alert_type, severity, message, status, resolved_at`,
      [dongleId, alertType]
    );

    if (res.rows.length > 0) {
      const resolvedAlert = res.rows[0];
      console.log(`[alerts] Auto-resolved ${alertType} for ${dongleId}`);
      broadcast({ type: "alert-resolved", data: resolvedAlert });
      return resolvedAlert;
    }
  } catch (err) {
    console.error(`[alerts] Failed to resolve alert for ${dongleId}:`, err.message);
  }
  return null;
}

/**
 * Evaluate incoming sensor readings against safety limits
 */
async function evaluateReadingAlerts(dongleId, mac, readings) {
  for (const r of readings) {
    const val = Number(r.value);
    if (Number.isNaN(val)) continue;

    // 1. Temperature Anomaly Detection
    if (r.type === "temperature") {
      if (val >= THRESHOLDS.temperature.critical) {
        await triggerAlert({
          dongleId,
          mac,
          alertType: "HIGH_TEMPERATURE",
          severity: "CRITICAL",
          message: `Critical Overheating: Machine temperature reached ${val} ${r.unit} (exceeds safety limit of ${THRESHOLDS.temperature.critical} ${r.unit})`,
          value: val,
          unit: r.unit,
        });
      } else if (val >= THRESHOLDS.temperature.warning) {
        await triggerAlert({
          dongleId,
          mac,
          alertType: "HIGH_TEMPERATURE",
          severity: "WARNING",
          message: `Elevated Temperature Warning: Sensor reached ${val} ${r.unit} (exceeds warning threshold of ${THRESHOLDS.temperature.warning} ${r.unit})`,
          value: val,
          unit: r.unit,
        });
      } else if (val <= THRESHOLDS.temperature.safeMax) {
        await resolveAlert(dongleId, "HIGH_TEMPERATURE");
      }
    }

    // 2. Voltage Anomaly Detection (Surge / Sag)
    if (r.type === "voltage") {
      if (val > THRESHOLDS.voltage.surgeMax) {
        await triggerAlert({
          dongleId,
          mac,
          alertType: "VOLTAGE_SURGE",
          severity: "CRITICAL",
          message: `Voltage Surge Alarm: Bus voltage reached ${val} ${r.unit} (exceeds maximum of ${THRESHOLDS.voltage.surgeMax} ${r.unit})`,
          value: val,
          unit: r.unit,
        });
      } else if (val < THRESHOLDS.voltage.sagMin) {
        await triggerAlert({
          dongleId,
          mac,
          alertType: "VOLTAGE_SAG",
          severity: "WARNING",
          message: `Voltage Sag Detected: Line voltage dropped to ${val} ${r.unit} (below minimum threshold of ${THRESHOLDS.voltage.sagMin} ${r.unit})`,
          value: val,
          unit: r.unit,
        });
      } else if (val >= THRESHOLDS.voltage.safeMin && val <= THRESHOLDS.voltage.safeMax) {
        await resolveAlert(dongleId, "VOLTAGE_SURGE");
        await resolveAlert(dongleId, "VOLTAGE_SAG");
      }
    }

    // 3. Current Draw Anomaly Detection (Overcurrent)
    if (r.type === "current") {
      if (val > THRESHOLDS.current.critical) {
        await triggerAlert({
          dongleId,
          mac,
          alertType: "OVERCURRENT",
          severity: "CRITICAL",
          message: `Severe Overcurrent: Motor line drew ${val} ${r.unit} (exceeds critical ceiling of ${THRESHOLDS.current.critical} ${r.unit})`,
          value: val,
          unit: r.unit,
        });
      } else if (val > THRESHOLDS.current.warning) {
        await triggerAlert({
          dongleId,
          mac,
          alertType: "OVERCURRENT",
          severity: "WARNING",
          message: `High Current Warning: Current draw reached ${val} ${r.unit} (exceeds warning threshold of ${THRESHOLDS.current.warning} ${r.unit})`,
          value: val,
          unit: r.unit,
        });
      } else if (val <= THRESHOLDS.current.safeMax) {
        await resolveAlert(dongleId, "OVERCURRENT");
      }
    }
  }

  // If we received telemetry, any inactivity alert for this device is now resolved
  await resolveInactivityAlert(dongleId);
}

/**
 * Clear any active inactivity watchdog alerts when a message is received
 */
async function resolveInactivityAlert(dongleId) {
  return resolveAlert(dongleId, "INACTIVITY_TIMEOUT");
}

/**
 * Watchdog: check for devices that have not sent telemetry or heartbeats in > 5 minutes
 */
async function checkInactivityWatchdog() {
  try {
    const res = await pool.query(`
      SELECT 
        d.dongle_id, 
        d.mac_address,
        GREATEST(
          COALESCE(MAX(sr.received_at), '1970-01-01'::timestamptz),
          COALESCE(MAX(ds.updated_at), '1970-01-01'::timestamptz)
        ) AS last_signal
      FROM devices d
      LEFT JOIN sensor_readings sr ON d.mac_address = sr.mac_address
      LEFT JOIN device_status ds ON d.dongle_id = ds.dongle_id
      GROUP BY d.dongle_id, d.mac_address
    `);

    const now = Date.now();
    const TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

    for (const row of res.rows) {
      const lastSignalTime = new Date(row.last_signal).getTime();
      const diff = now - lastSignalTime;

      if (diff > TIMEOUT_MS) {
        const minsOffline = Math.floor(diff / 60000);
        await triggerAlert({
          dongleId: row.dongle_id,
          mac: row.mac_address,
          alertType: "INACTIVITY_TIMEOUT",
          severity: "CRITICAL",
          message: `Device Offline Alarm: Gateway ${row.dongle_id} (${row.mac_address}) has been silent for over ${minsOffline} minutes. Check power & network connection.`,
          value: minsOffline,
          unit: "min",
        });
      }
    }
  } catch (err) {
    console.error("[alerts] Inactivity watchdog error:", err.message);
  }
}

/**
 * Start periodic watchdog monitor (runs every 30 seconds)
 */
function startWatchdogMonitor(intervalMs = 30000) {
  console.log("[alerts] Starting watchdog inactivity monitor (every 30s)...");
  // Initial check after 10s
  setTimeout(checkInactivityWatchdog, 10000);
  return setInterval(checkInactivityWatchdog, intervalMs);
}

module.exports = {
  initAlertsTable,
  evaluateReadingAlerts,
  resolveInactivityAlert,
  triggerAlert,
  resolveAlert,
  startWatchdogMonitor,
  checkInactivityWatchdog,
};
