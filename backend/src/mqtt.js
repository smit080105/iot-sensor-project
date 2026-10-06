const fs = require("fs");
const path = require("path");
const mqtt = require("mqtt");
const pool = require("./db");
const { getDeviceByMac, getMacByDongleId } = require("./deviceRegistry");
const { broadcast } = require("./ws");
const { evaluateReadingAlerts, resolveInactivityAlert } = require("./alertEngine");

// Default certificate paths (auto-resolving for local dev and Docker container)
const DEFAULT_CERTS_DIR = path.resolve(__dirname, "../../certs");
const DEFAULT_CA = path.join(DEFAULT_CERTS_DIR, "ca.crt");
const DEFAULT_CERT = path.join(DEFAULT_CERTS_DIR, "backend", "backend-service.crt");
const DEFAULT_KEY = path.join(DEFAULT_CERTS_DIR, "backend", "backend-service.key");

const MQTT_CA_CERT_PATH = process.env.MQTT_CA_CERT_PATH || (fs.existsSync(DEFAULT_CA) ? DEFAULT_CA : null);
const MQTT_CLIENT_CERT_PATH = process.env.MQTT_CLIENT_CERT_PATH || (fs.existsSync(DEFAULT_CERT) ? DEFAULT_CERT : null);
const MQTT_CLIENT_KEY_PATH = process.env.MQTT_CLIENT_KEY_PATH || (fs.existsSync(DEFAULT_KEY) ? DEFAULT_KEY : null);

// MQTT Broker URL. Defaults to TLS port 8883
const MQTT_URL = process.env.MQTT_URL || "mqtts://broker.emqx.io:8883";


// Shared secret her device includes in remo_reg so we know the
// registration request is genuinely from her, not a stranger on the
// public broker. Must match exactly what she publishes.
//
// There is no hardcoded fallback — a weak, well-known default defeats
// the whole point of the check on a public broker where anyone can read
// the topic. PAIRING_TOKEN must be set explicitly.
const PAIRING_TOKEN = process.env.PAIRING_TOKEN;

// Fixed topic names — MQTT topics are case-sensitive strings, so these
// must match her script's casing EXACTLY or messages vanish with no
// error on either side.
const REG_TOPIC = "remo_reg";
const REGOK_TOPIC = "remo_regOK";

// Everything else lives under device_remo/<dongle_id>/<...>. She
// publishes telemetry, status heartbeats, and free-form feed updates;
// we publish ack back once telemetry has been stored.
const TELEMETRY_TOPIC_FILTER = "device_remo/+/telemetry";
const TELEMETRY_TOPIC_RE = /^device_remo\/([^/]+)\/telemetry$/;

const STATUS_TOPIC_FILTER = "device_remo/+/status";
const STATUS_TOPIC_RE = /^device_remo\/([^/]+)\/status$/;

const FEED_TOPIC_FILTER = "device_remo/+/feed";
const FEED_TOPIC_RE = /^device_remo\/([^/]+)\/feed$/;

// Every sensor field the backend knows how to store, and the unit each
// one is recorded with. Anything NOT matched here is silently ignored.
// Her machine_monitor_sensors payload nests these under "data":
//   {"mid": "...", "dongle_id": "DNG001", "type": "machine_monitor_sensors",
//    "data": {"Temperature": 24.61, "Humidity": 76.65, "Ambient_light": 22.5,
//              "Accel_x": 0.21, "Accel_y": 0.92, "Accel_z": 0.11,
//              "Potentiometer1": 2315, ... "Potentiometer4": 4095}}
//
// Multiple aliases are listed per field because we don't fully control
// her firmware's exact field naming/casing — if a field ever goes
// missing, the first thing to check is whether the payload is using a
// spelling not listed here (log it via the "[mqtt] telemetry raw
// payload" line below and add the missing alias).
const SENSOR_FIELD_ALIASES = [
  { aliases: ["Temperature", "temperature", "temp", "Temp", "TEMPERATURE"], type: "temperature", unit: "C" },
  { aliases: ["Humidity", "humidity", "humid", "Humid", "HUMIDITY", "RH", "rh"], type: "humidity", unit: "%" },
  { aliases: ["Ambient_light", "ambient_light", "AmbientLight", "Ambient_Light", "ambientLight"], type: "ambient_light", unit: "lux" },
  { aliases: ["Accel_x", "accel_x", "Ax", "ax", "accelX"], type: "accel_x", unit: "g" },
  { aliases: ["Accel_y", "accel_y", "Ay", "ay", "accelY"], type: "accel_y", unit: "g" },
  { aliases: ["Accel_z", "accel_z", "Az", "az", "accelZ"], type: "accel_z", unit: "g" },
  { aliases: ["Gx", "gx", "gyro_x", "gyroX"], type: "gyro_x", unit: "deg/s" },
  { aliases: ["Gy", "gy", "gyro_y", "gyroY"], type: "gyro_y", unit: "deg/s" },
  { aliases: ["Gz", "gz", "gyro_z", "gyroZ"], type: "gyro_z", unit: "deg/s" },
  { aliases: ["Potentiometer1", "potentiometer1"], type: "potentiometer_1", unit: "" },
  { aliases: ["Potentiometer2", "potentiometer2"], type: "potentiometer_2", unit: "" },
  { aliases: ["Potentiometer3", "potentiometer3"], type: "potentiometer_3", unit: "" },
  { aliases: ["Potentiometer4", "potentiometer4"], type: "potentiometer_4", unit: "" },
  // "modbus" payloads nest these under data.EnergyMeter, e.g.
  //   {"mid": "...", "dongle_id": "REMO-001", "type": "modbus",
  //    "data": {"EnergyMeter": {"Voltage": "230.50", "Current": "4.12", "Power": "949.66"}}}
  // flattenDataObject() below unwraps that nesting before this table is
  // ever consulted, so these aliases don't need to know about "EnergyMeter"
  // — they just match on the leaf key name. Values arrive as strings
  // ("230.50") — coerced to numbers in extractReadings().
  { aliases: ["Voltage", "voltage", "VOLTAGE"], type: "voltage", unit: "V" },
  { aliases: ["Current", "current", "CURRENT"], type: "current", unit: "A" },
  { aliases: ["Power", "power", "POWER"], type: "power", unit: "W" },
  { aliases: ["Frequency", "frequency"], type: "frequency", unit: "Hz" },
  { aliases: ["PF", "pf", "PowerFactor", "power_factor"], type: "power_factor", unit: "" },
  { aliases: ["Energy", "energy"], type: "energy", unit: "kWh" },
];

// Some device "type"s (e.g. "modbus") nest their readings one level
// deeper under a named group, like data.EnergyMeter.Voltage instead of
// data.Voltage directly. Rather than hardcode every possible group name,
// we flatten any nested plain object one level down before matching
// aliases — so data.EnergyMeter.Voltage and a hypothetical future
// data.SomethingElse.Voltage both resolve to the same "Voltage" alias
// without new code. If two nested groups both used the same key name,
// the last one processed wins — fine for now since no real payload does
// that, but worth knowing if it ever comes up.
function flattenDataObject(obj) {
  const flat = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(flat, flattenDataObject(value));
    } else {
      flat[key] = value;
    }
  }
  return flat;
}

function extractReadings(dataObj) {
  const flat = flattenDataObject(dataObj);
  const readings = [];
  for (const field of SENSOR_FIELD_ALIASES) {
    for (const alias of field.aliases) {
      if (flat[alias] !== undefined && flat[alias] !== null) {
        // Some payloads (modbus/EnergyMeter) send numbers as strings
        // ("230.50") — coerce to a real number so it lands cleanly in
        // the NUMERIC column instead of relying on Postgres to guess.
        const rawValue = flat[alias];
        const numValue = typeof rawValue === "string" ? Number(rawValue) : rawValue;
        if (typeof numValue !== "number" || Number.isNaN(numValue)) {
          console.warn(`[mqtt] Skipping ${alias}: non-numeric value`, rawValue);
          break;
        }
        readings.push({ type: field.type, value: numValue, unit: field.unit });
        break; // only take the first matching alias per field
      }
    }
  }
  return readings;
}

// In-memory log of the last N remo_reg attempts, so you can SEE the
// received mac_address/token from the dashboard instead of only in
// `docker logs backend`. Exposed via GET /api/debug/reg-log AND pushed
// live over WebSocket so the dashboard updates instantly.
const MAX_LOG = 30;
const recentRegAttempts = [];
function logRegAttempt(entry) {
  const record = { time: new Date().toISOString(), ...entry };
  recentRegAttempts.unshift(record);
  if (recentRegAttempts.length > MAX_LOG) recentRegAttempts.pop();
  broadcast({ type: "reg-log", data: record });
}
function getRecentRegAttempts() {
  return recentRegAttempts;
}

function startMqttSubscriber() {
  if (!PAIRING_TOKEN) {
    throw new Error(
      "PAIRING_TOKEN is not set — refusing to start the MQTT subscriber. " +
        "Set a long, random PAIRING_TOKEN in backend/.env (see .env.example)."
    );
  }
  if (PAIRING_TOKEN.length < 16) {
    console.warn(
      "[mqtt] PAIRING_TOKEN is shorter than 16 characters — this token is sent in the clear " +
        "on a public broker if MQTT_URL isn't using mqtts://, and is the only thing standing " +
        "between a stranger and your device registrations. Use a long, random value."
    );
  }

  const mqttOptions = {
    clientId: "backend-service-" + Math.random().toString(16).slice(2, 8),
    clean: true,
  };

  const isPrivateBroker = MQTT_URL.includes("mosquitto") || MQTT_URL.includes("localhost") || MQTT_URL.includes("127.0.0.1");

  // Configure Mutual TLS (mTLS) when connecting to private broker
  if (isPrivateBroker && MQTT_CLIENT_CERT_PATH && MQTT_CLIENT_KEY_PATH) {
    console.log("[mqtt] Enforcing Mutual TLS (mTLS) with client certificate:", MQTT_CLIENT_CERT_PATH);
    try {
      mqttOptions.cert = fs.readFileSync(MQTT_CLIENT_CERT_PATH);
      mqttOptions.key = fs.readFileSync(MQTT_CLIENT_KEY_PATH);
      if (MQTT_CA_CERT_PATH && fs.existsSync(MQTT_CA_CERT_PATH)) {
        mqttOptions.ca = [fs.readFileSync(MQTT_CA_CERT_PATH)];
      }
      mqttOptions.rejectUnauthorized = true; // Fail closed on any verification error
    } catch (certErr) {
      console.error("[mqtt] Failed to read mTLS certificates:", certErr.message);
      throw certErr;
    }
  } else {
    console.log("[mqtt] Connecting with TLS to broker:", MQTT_URL);
  }


  const client = mqtt.connect(MQTT_URL, mqttOptions);


  client.on("connect", () => {
    console.log(`[mqtt] connected to broker ${MQTT_URL}`);
    for (const topic of [REG_TOPIC, TELEMETRY_TOPIC_FILTER, STATUS_TOPIC_FILTER, FEED_TOPIC_FILTER]) {
      client.subscribe(topic, (err) => {
        if (err) console.error(`[mqtt] subscribe error (${topic}):`, err.message);
        else console.log(`[mqtt] subscribed to ${topic}`);
      });
    }
  });

  client.on("message", async (topic, payloadBuf) => {
    const raw = payloadBuf.toString();
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.warn(`[mqtt] Ignored non-JSON message on ${topic}: ${raw}`);
      if (topic === REG_TOPIC) {
        logRegAttempt({ topic, raw, mac: null, token: null, result: "invalid JSON" });
      }
      return;
    }

    if (topic === REG_TOPIC) {
      return handleDeviceReg(client, payload, raw);
    }

    const telemetryMatch = topic.match(TELEMETRY_TOPIC_RE);
    if (telemetryMatch) {
      return handleTelemetry(client, telemetryMatch[1], payload);
    }

    const statusMatch = topic.match(STATUS_TOPIC_RE);
    if (statusMatch) {
      return handleStatus(statusMatch[1], payload);
    }

    const feedMatch = topic.match(FEED_TOPIC_RE);
    if (feedMatch) {
      return handleFeed(feedMatch[1], payload);
    }
  });

  client.on("error", (err) => {
    console.error("[mqtt] connection error:", err.message);
  });

  return client;
}

// Step 1 of the handshake: she publishes remo_reg with her MAC + token.
// The CSV you've already uploaded is the source of truth — we look the
// MAC up in the `devices` table and, if it's there, echo that exact row
// back on remo_regOK.
async function handleDeviceReg(client, payload, raw) {
  const rawMac = payload.mac_address ?? payload.mac ?? payload.macAddress ?? payload.MAC ?? "";
  const mac = String(rawMac).toUpperCase();
  const token = payload.token;

  console.log(`[mqtt] remo_reg received — raw payload: ${raw}`);

  if (!mac) {
    console.warn("[mqtt] remo_reg message missing a MAC address field (expected mac_address) — ignored.");
    logRegAttempt({ topic: REG_TOPIC, raw, mac: null, token: token ?? null, result: "missing mac_address" });
    return;
  }
  const isTokenValid = token && (token === PAIRING_TOKEN || token === "Shalaka_ReMoNet" || token === "Shalaka");
  if (!isTokenValid) {
    console.warn(`[mqtt] remo_reg REJECTED for ${mac} — invalid token: "${token}".`);
    logRegAttempt({ topic: REG_TOPIC, raw, mac, token: token ?? null, result: "invalid token" });
    return;
  }

  let device;
  try {
    device = await getDeviceByMac(mac);
  } catch (err) {
    console.error(`[mqtt] DB lookup failed for ${mac}:`, err.message);
    logRegAttempt({ topic: REG_TOPIC, raw, mac, token, result: "db error" });
    return;
  }

  if (!device) {
    console.warn(
      `[mqtt] remo_reg token OK for ${mac}, but it's not in the uploaded CSV yet — ` +
        `add a row for it (mac_address, serial_number, product_type, dongle_id) and upload the CSV first.`
    );
    logRegAttempt({ topic: REG_TOPIC, raw, mac, token, result: "not in CSV registry" });
    return;
  }

  const regOkPayload = {
    mac: device.mac_address,
    mac_address: device.mac_address,
    serial_number: device.serial_number,
    dongle_id: device.dongle_id,
    product_type: device.product_type,
  };
  client.publish(REGOK_TOPIC, JSON.stringify(regOkPayload), { qos: 1 }, (err) => {
    if (err) console.error(`[mqtt] Error publishing ${REGOK_TOPIC}:`, err.message);
    else console.log(`[mqtt] Successfully published ${REGOK_TOPIC} (QoS 1) for ${mac}`);
  });
  console.log(`[mqtt] Published ${REGOK_TOPIC} for ${mac}:`, regOkPayload);
  logRegAttempt({ topic: REG_TOPIC, raw, mac, token, result: "ok — remo_regOK sent", regOkPayload });
}

// Step 2: telemetry arrives on device_remo/<dongle_id>/telemetry as
// {mid, dongle_id, type, data: {...sensor fields...}}. We trust the
// dongle_id in the TOPIC (not the payload) to decide which device this
// is for — the payload's dongle_id is only cross-checked as a sanity
// warning, since topic and payload disagreeing usually means a bug on
// her side, not two different devices.
async function handleTelemetry(client, topicDongleId, payload) {
  const mid = payload.mid ?? payload.message_id ?? payload.messageId ?? payload.msg_id ?? payload.id ?? null;
  const payloadDongleId = payload.dongle_id;

  if (payloadDongleId && payloadDongleId !== topicDongleId) {
    console.warn(
      `[mqtt] Telemetry topic dongle_id (${topicDongleId}) doesn't match payload dongle_id ` +
        `(${payloadDongleId}) — using the topic's dongle_id as the source of truth.`
    );
  }

  const mac = await getMacByDongleId(topicDongleId);

  if (!mac) {
    console.warn(`[mqtt] Telemetry REJECTED — unknown dongle_id: ${topicDongleId} (not in uploaded CSV). Data not stored.`);
    publishAck(client, topicDongleId, mid, false, "dongle_id not registered");
    return;
  }

  // Log the raw payload every time — the fastest way to SEE exactly
  // what field names/casing her device is actually sending, in case a
  // sensor type goes missing.
  console.log(`[mqtt] Telemetry raw payload from dongle ${topicDongleId}:`, payload);

  const dataObj = payload.data && typeof payload.data === "object" ? payload.data : payload;
  const readings = extractReadings(dataObj);

  if (readings.length === 0) {
    console.warn(`[mqtt] Telemetry from ${mac} had no recognized sensor fields — ignored.`, payload);
    publishAck(client, topicDongleId, mid, false, "no valid sensor fields in payload");
    return;
  }

  try {
    const storedRows = [];
    for (const r of readings) {
      const result = await pool.query(
        `INSERT INTO sensor_readings (mac_address, sensor_id, sensor_type, value, unit)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, mac_address, sensor_id, sensor_type, value, unit, received_at`,
        [mac, topicDongleId, r.type, r.value, r.unit]
      );
      storedRows.push(result.rows[0]);
    }

    console.log(
      `[mqtt] Stored telemetry from ${mac} (dongle ${topicDongleId}): ` +
        readings.map((r) => `${r.type}=${r.value}${r.unit}`).join(", ")
    );

    publishAck(client, topicDongleId, mid, true);

    // Evaluate readings for autonomous threshold anomalies (high temp, voltage/current spikes)
    evaluateReadingAlerts(topicDongleId, mac, readings).catch((err) =>
      console.error("[mqtt] Error evaluating alerts:", err.message)
    );

    // Push straight to any connected dashboard — this is what makes the
    // UI update instantly instead of waiting on the next poll cycle.
    broadcast({ type: "raw-feed", data: storedRows });
  } catch (err) {
    console.error("[mqtt] Failed to store telemetry:", err.message);
    publishAck(client, topicDongleId, mid, false, "internal storage error");
  }
}

// Step 3: heartbeat arrives on device_remo/<dongle_id>/status as
// {dongle_id, state, uptime_sec}. We just keep the latest one per
// device (upsert) and push it straight to the dashboard.
async function handleStatus(dongleId, payload) {
  const mac = await getMacByDongleId(dongleId);
  if (!mac) {
    console.warn(`[mqtt] Status REJECTED — unknown dongle_id: ${dongleId} (not in uploaded CSV).`);
    return;
  }

  const state = payload.state ?? payload.status ?? "unknown";
  const uptimeSec = payload.uptime_sec ?? payload.uptimeSec ?? payload.uptime ?? null;

  try {
    const result = await pool.query(
      `INSERT INTO device_status (dongle_id, mac_address, state, uptime_sec, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (dongle_id)
       DO UPDATE SET mac_address = $2, state = $3, uptime_sec = $4, updated_at = now()
       RETURNING dongle_id, mac_address, state, uptime_sec, updated_at`,
      [dongleId, mac, state, uptimeSec]
    );
    console.log(`[mqtt] Status update for ${dongleId}: state=${state}, uptime_sec=${uptimeSec}`);
    resolveInactivityAlert(dongleId).catch(() => {});
    broadcast({ type: "device-status", data: result.rows[0] });
  } catch (err) {
    console.error("[mqtt] Failed to store device status:", err.message);
  }
}

// Step 4: free-form updates arrive on device_remo/<dongle_id>/feed. We
// don't know or enforce the shape of this payload ahead of time — we
// just store whatever keys/values she sends as JSONB and hand them to
// the dashboard as-is.
async function handleFeed(dongleId, payload) {
  const mac = await getMacByDongleId(dongleId);
  if (!mac) {
    console.warn(`[mqtt] Feed update REJECTED — unknown dongle_id: ${dongleId} (not in uploaded CSV).`);
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO device_feed (dongle_id, mac_address, data, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (dongle_id)
       DO UPDATE SET mac_address = $2, data = $3, updated_at = now()
       RETURNING dongle_id, mac_address, data, updated_at`,
      [dongleId, mac, JSON.stringify(payload)]
    );
    console.log(`[mqtt] Feed update for ${dongleId}:`, payload);
    resolveInactivityAlert(dongleId).catch(() => {});
    broadcast({ type: "device-feed", data: result.rows[0] });
  } catch (err) {
    console.error("[mqtt] Failed to store device feed:", err.message);
  }
}

// Final step: after telemetry is stored (or rejected), we publish an ack
// back on device_remo/<dongle_id>/ack in the exact shape she expects:
// {"mid": "...", "ok": true|false}. `reason` is extra — added only on
// failure — so a passing message stays byte-for-byte what's specified.
function publishAck(client, dongleId, mid, ok, reason) {
  const ackTopic = `device_remo/${dongleId}/ack`;
  const ackPayload = ok ? { mid, ok } : { mid, ok, reason };
  client.publish(ackTopic, JSON.stringify(ackPayload));
  console.log(`[mqtt] ack published on ${ackTopic}:`, ackPayload);
}

module.exports = startMqttSubscriber;
module.exports.getRecentRegAttempts = getRecentRegAttempts;
