/**
 * Zero-Trust Edge IoT Device Simulator
 * Demonstrates:
 * 1. Uses a pre-provisioned device key and X.509 certificate
 * 2. Certificate CN is bound to the device ID
 * 3. Mutual TLS (mTLS) over TLS (local Compose host port 8888 by default)
 * 4. Narrowly authorized telemetry publishing (least privilege topic ACL)
 * 5. Optional unauthorized publish attempt; broker-side ACL denial must be
 *    confirmed in broker logs because MQTT may acknowledge dropped messages.
 */

const fs = require('fs');
const path = require('path');
const mqtt = require('mqtt');
const { execSync } = require('child_process');

const DONGLE_ID = process.env.DONGLE_ID || 'DNG001';
const MAC_ADDRESS = process.env.MAC_ADDRESS || '8C:BF:EA:1B:96:18';
const BROKER_URL = process.env.MQTT_URL || 'mqtts://localhost:8888';

const ROOT_DIR = path.resolve(__dirname, '..');
const CERTS_DIR = path.join(ROOT_DIR, 'certs');
const DEVICES_DIR = path.join(CERTS_DIR, 'devices');
const CA_CERT = path.join(CERTS_DIR, 'ca.crt');

const devKey = path.join(DEVICES_DIR, `${DONGLE_ID}.key`);
const devCrt = path.join(DEVICES_DIR, `${DONGLE_ID}.crt`);

console.log('===============================================================');
console.log(`[Device ${DONGLE_ID}] Starting Zero-Trust Device Simulator`);
console.log('===============================================================');

// Device identity must be provisioned separately. Never auto-generate device
// credentials on the backend host as a substitute for on-device key creation.
if (!fs.existsSync(devKey) || !fs.existsSync(devCrt) || !fs.existsSync(CA_CERT)) {
  console.error('[Device] Device certificate/key or broker CA is missing. Provision the key and CSR on the device, obtain a signed certificate, then install them here.');
  process.exit(1);
}

console.log(`[Device] Loading X.509 Client Certificate for identity: ${DONGLE_ID}`);
const ca = fs.readFileSync(CA_CERT);
const cert = fs.readFileSync(devCrt);
const key = fs.readFileSync(devKey);

const mqttOptions = {
  clientId: DONGLE_ID,
  clean: true,
  ca: [ca],
  cert: cert,
  key: key,
  rejectUnauthorized: true, // Fail closed if server certificate is invalid or untrusted
  reconnectPeriod: 5000,
};

console.log(`[Device] Connecting to broker at ${BROKER_URL} via Mutual TLS (mTLS)...`);
const client = mqtt.connect(BROKER_URL, mqttOptions);

let telemetrySent = false;

client.on('connect', () => {
  console.log(`\n[mTLS SUCCESS] Connected securely to broker as authenticated device: ${DONGLE_ID}`);

  // Subscribe only to this certificate's registration reply, commands, and ACKs.
  const registrationTopic = `device_remo/${DONGLE_ID}/register`;
  const registrationAckTopic = `device_remo/${DONGLE_ID}/register_ack`;
  const cmdTopic = `device_remo/${DONGLE_ID}/commands`;
  const ackTopic = `device_remo/${DONGLE_ID}/ack`;
  client.subscribe([registrationAckTopic, cmdTopic, ackTopic], (err) => {
    if (!err) {
      console.log(`[ACL Check] Subscribed to authorized device topics for ${DONGLE_ID}`);
      const token = process.env.PAIRING_TOKEN;
      if (!token) {
        console.error('[Device] Set PAIRING_TOKEN to the backend registration token before running this simulator.');
        return;
      }
      client.publish(registrationTopic, JSON.stringify({ mac_address: MAC_ADDRESS, token }), { qos: 1 });
      console.log(`[Registration] Request sent to ${registrationTopic}`);
    } else {
      console.error('[ACL Check] Device subscription failed:', err.message);
    }
  });

  // Telemetry is sent only after the backend confirms that the certificate
  // identity maps to this MAC address in the device registry.
});

function publishTelemetry() {
  if (telemetrySent) return;
  telemetrySent = true;
  const telemetryTopic = `device_remo/${DONGLE_ID}/telemetry`;
  const payload = {
    mid: "msg-" + Date.now(),
    dongle_id: DONGLE_ID,
    mac_address: MAC_ADDRESS,
    type: "machine_monitor_sensors",
    data: {
      Temperature: 24.85,
      Humidity: 62.4,
      Ambient_light: 154.0,
      Accel_x: 0.02,
      Accel_y: 0.98,
      Accel_z: 0.14
    }
  };

  console.log(`\n[Test 1] Publishing telemetry to AUTHORIZED topic: ${telemetryTopic}`);
  client.publish(telemetryTopic, JSON.stringify(payload), { qos: 1 }, (err) => {
    if (err) {
      console.error(`[Error] Failed to publish telemetry:`, err.message);
    } else {
      console.log(`[Success] Telemetry published successfully!`);
    }
  });

  // Probe an unauthorized topic. MQTT PUBACK does not prove that the
  // broker delivered the message; check broker logs for the ACL decision.
  const forbiddenTopic = `device_remo/DNG999_OTHER/telemetry`;
  console.log(`\n[Test 2: ACL Enforcement] Attempting to publish to FORBIDDEN topic: ${forbiddenTopic}`);
  client.publish(forbiddenTopic, JSON.stringify({ hacked: true }), { qos: 1 }, (err) => {
    if (err) {
      console.log(`[ACL PROBE] Publish request returned an error: ${err.message}`);
    } else {
      console.log('[ACL PROBE] Publish request acknowledged. This does not prove delivery or ACL enforcement; verify the broker log.');
    }
  });
}

client.on('message', (topic, message) => {
  console.log(`[Device received on ${topic}]: ${message.toString()}`);
  if (topic === `device_remo/${DONGLE_ID}/register_ack`) {
    try {
      const reply = JSON.parse(message.toString());
      if (reply.dongle_id !== DONGLE_ID || reply.mac_address !== MAC_ADDRESS) {
        console.error('[Registration] Backend response did not match this device identity.');
        return;
      }
      console.log('[Registration] Backend confirmed device identity.');
      publishTelemetry();
    } catch (error) {
      console.error('[Registration] Invalid backend response:', error.message);
    }
  }
});

client.on('connect', () => {
  // Exit cleanly after demonstration
  setTimeout(() => {
    console.log('\n[Device] Simulation cycle complete. Closing mTLS connection.');
    client.end();
    process.exit(0);
  }, 3000);
});

client.on('error', (err) => {
  console.error(`[mTLS Connection Error]:`, err.message);
});
