const mqtt = require("mqtt");
const pool = require("./db");
const { getDeviceByMac, getMacByDongleId } = require("./deviceRegistry");
const { broadcast } = require("./ws");

const MQTT_URL = process.env.MQTT_URL || "mqtt://broker.emqx.io:1883";

// Shared secret her device includes in DEVICE_reg so we know the
// registration request is genuinely from her, not a stranger on the
// public broker. Must match exactly what she publishes.
const PAIRING_TOKEN = process.env.PAIRING_TOKEN || "Shalaka";

// Fixed topic names — MQTT topics are case-sensitive strings, so these
// must match her script's casing EXACTLY or messages vanish with no
// error on either side.
const REG_TOPIC = "DEVICE_reg";
const REGOK_TOPIC = "DEVICE_regok";

// Telemetry now lives under device_scd/<dongle_id>/telemetry, and every
// accepted/rejected reading gets an ACK published back on
// device_scd/<dongle_id>/ack so her script knows whether it landed.
const TELEMETRY_TOPIC_FILTER = "device_scd/+/telemetry";
const TELEMETRY_TOPIC_RE = /^device_scd\/([^/]+)\/telemetry$/;

// Every sensor field the backend knows how to store, and the unit each
// one is recorded with. Anything NOT matched here is silently ignored —
// this is exactly the list that was missing Ax/Ay/Az/Gx/Gy/Gz before,
// which is why accelerometer/gyroscope readings were always rejected
// with "no valid sensor fields in payload" even though they arrived fine.
//
// Multiple aliases are listed per field because we don't control her
// device's exact field naming/casing — if temperature/humidity ever go
// missing again, the first thing to check is whether her payload is
// using a spelling not listed here (log it via [mqtt] DEVICE telemetry
// raw payload below and add the missing alias).
const SENSOR_FIELD_ALIASES = [
  {
    aliases: [
      "temperature", "Temperature", "temp", "Temp", "TEMPERATURE",
      // Her AHT sensor publishes it under this exact key — this was the
      // missing alias causing temperature to be silently dropped while
      // humidity/accel/gyro from the same payload stored fine.
      "AHT_Temperature", "aht_temperature", "AHT_temperature", "AHTTemperature",
    ],
    type: "temperature",
    unit: "C",
  },
  {
    aliases: [
      "humidity", "Humidity", "humid", "Humid", "HUMIDITY", "RH", "rh",
      // Paired AHT humidity field, in case she names it to match AHT_Temperature.
      "AHT_Humidity", "aht_humidity", "AHT_humidity", "AHTHumidity",
    ],
    type: "humidity",
    unit: "%",
  },
  { aliases: ["Ax", "ax", "accel_x", "accelX"], type: "accel_x", unit: "g" },
  { aliases: ["Ay", "ay", "accel_y", "accelY"], type: "accel_y", unit: "g" },
  { aliases: ["Az", "az", "accel_z", "accelZ"], type: "accel_z", unit: "g" },
  { aliases: ["Gx", "gx", "gyro_x", "gyroX"], type: "gyro_x", unit: "deg/s" },
  { aliases: ["Gy", "gy", "gyro_y", "gyroY"], type: "gyro_y", unit: "deg/s" },
  { aliases: ["Gz", "gz", "gyro_z", "gyroZ"], type: "gyro_z", unit: "deg/s" },
];

function extractReadings(payload) {
  const readings = [];
  for (const field of SENSOR_FIELD_ALIASES) {
    for (const alias of field.aliases) {
      if (payload[alias] !== undefined && payload[alias] !== null) {
        readings.push({ type: field.type, value: payload[alias], unit: field.unit });
        break; // only take the first matching alias per field
      }
    }
  }
  return readings;
}

// In-memory log of the last N DEVICE_reg attempts, so you can SEE the
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
  const client = mqtt.connect(MQTT_URL, {
    clientId: "backend-" + Math.random().toString(16).slice(2, 8),
  });

  client.on("connect", () => {
    console.log(`[mqtt] connected to public broker ${MQTT_URL}`);
    client.subscribe(REG_TOPIC, (err) => {
      if (err) console.error(`[mqtt] subscribe error (${REG_TOPIC}):`, err.message);
      else console.log(`[mqtt] subscribed to ${REG_TOPIC}`);
    });
    client.subscribe(TELEMETRY_TOPIC_FILTER, (err) => {
      if (err) console.error(`[mqtt] subscribe error (${TELEMETRY_TOPIC_FILTER}):`, err.message);
      else console.log(`[mqtt] subscribed to ${TELEMETRY_TOPIC_FILTER}`);
    });
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

    const match = topic.match(TELEMETRY_TOPIC_RE);
    if (match) {
      return handleTelemetry(client, match[1], payload);
    }
  });

  client.on("error", (err) => {
    console.error("[mqtt] connection error:", err.message);
  });

  return client;
}

// Step 1 of the handshake: she publishes DEVICE_reg with her MAC + token.
// The CSV you've already uploaded is the source of truth — we look the
// MAC up in the `devices` table and, if it's there, echo that exact row
// back on DEVICE_regok.
async function handleDeviceReg(client, payload, raw) {
  const rawMac = payload.mac_address ?? payload.mac ?? payload.macAddress ?? payload.MAC ?? "";
  const mac = String(rawMac).toUpperCase();
  const token = payload.token;

  console.log(`[mqtt] DEVICE_reg received — raw payload: ${raw}`);

  if (!mac) {
    console.warn("[mqtt] DEVICE_reg message missing a MAC address field (expected mac_address) — ignored.");
    logRegAttempt({ topic: REG_TOPIC, raw, mac: null, token: token ?? null, result: "missing mac_address" });
    return;
  }
  if (token !== PAIRING_TOKEN) {
    console.warn(`[mqtt] DEVICE_reg REJECTED for ${mac} — invalid or missing token.`);
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
      `[mqtt] DEVICE_reg token OK for ${mac}, but it's not in the uploaded CSV yet — ` +
        `add a row for it (mac_address, serial_number, product_type, dongle_id) and upload the CSV first.`
    );
    logRegAttempt({ topic: REG_TOPIC, raw, mac, token, result: "not in CSV registry" });
    return;
  }

  const regOkPayload = {
    mac_address: device.mac_address,
    serial_number: device.serial_number,
    dongle_id: device.dongle_id,
    product_type: device.product_type,
  };
  client.publish(REGOK_TOPIC, JSON.stringify(regOkPayload));
  console.log(`[mqtt] Published ${REGOK_TOPIC} for ${mac}:`, regOkPayload);
  logRegAttempt({ topic: REG_TOPIC, raw, mac, token, result: "ok — DEVICE_regok sent", regOkPayload });
}

// Step 2: telemetry arrives on device_scd/<dongle_id>/telemetry. We look
// up which MAC that dongle_id belongs to, extract every field we
// recognize (temperature, humidity, Ax/Ay/Az, Gx/Gy/Gz), store each as a
// row, ALWAYS publish an ACK back so her script knows the outcome, and
// broadcast the new readings to any connected dashboard over WebSocket.
async function handleTelemetry(client, dongleId, payload) {
  const messageId = payload.message_id ?? null;
  const mac = await getMacByDongleId(dongleId);

  if (!mac) {
    console.warn(`[mqtt] Telemetry REJECTED — unknown dongle_id: ${dongleId} (not in uploaded CSV). Data not stored.`);
    publishAck(client, dongleId, messageId, false, "dongle_id not registered");
    return;
  }

  // Log the raw payload every time — the fastest way to SEE exactly
  // what field names/casing her device is actually sending, in case a
  // sensor type goes missing again in the future.
  console.log(`[mqtt] Telemetry raw payload from dongle ${dongleId}:`, payload);

  const readings = extractReadings(payload);

  if (readings.length === 0) {
    console.warn(`[mqtt] Telemetry from ${mac} had no recognized sensor fields — ignored.`, payload);
    publishAck(client, dongleId, messageId, false, "no valid sensor fields in payload");
    return;
  }

  try {
    const storedRows = [];
    for (const r of readings) {
      const result = await pool.query(
        `INSERT INTO sensor_readings (mac_address, sensor_id, sensor_type, value, unit)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, mac_address, sensor_id, sensor_type, value, unit, received_at`,
        [mac, dongleId, r.type, r.value, r.unit]
      );
      storedRows.push(result.rows[0]);
    }

    console.log(
      `[mqtt] Stored telemetry from ${mac} (dongle ${dongleId}): ` +
        readings.map((r) => `${r.type}=${r.value}${r.unit}`).join(", ")
    );

    publishAck(client, dongleId, messageId, true);

    // Push straight to any connected dashboard — this is what makes the
    // UI update instantly instead of waiting on the next poll cycle.
    broadcast({ type: "raw-feed", data: storedRows });
  } catch (err) {
    console.error("[mqtt] Failed to store telemetry:", err.message);
    publishAck(client, dongleId, messageId, false, "internal storage error");
  }
}

function publishAck(client, dongleId, messageId, received, details) {
  const ackTopic = `device_scd/${dongleId}/ack`;
  const ackPayload = {
    dongle_id: dongleId,
    message_id: messageId,
    received,
    timestamp: new Date().toISOString(),
    ...(details ? { details } : {}),
  };
  client.publish(ackTopic, JSON.stringify(ackPayload));
  console.log(`[mqtt] ACK published on ${ackTopic}:`, ackPayload);
}

module.exports = startMqttSubscriber;
module.exports.getRecentRegAttempts = getRecentRegAttempts;
