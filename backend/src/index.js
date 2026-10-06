require("dotenv").config();

const http = require("http");
const app = require("./app");
const pool = require("./db");
const startMqttSubscriber = require("./mqtt");
const { initWebSocket } = require("./ws");
const { initUsersTable } = require("./authUtil");
const { initAlertsTable, startWatchdogMonitor } = require("./alertEngine");
const { initAuditTable } = require("./auditLogger");

const PORT = process.env.PORT || 4000;

async function waitForDb(retries = 20, delayMs = 3000) {
  for (let i = 0; i < retries; i++) {
    try {
      await pool.query("SELECT 1");
      console.log("[db] connected");
      return;
    } catch (err) {
      console.log(`[db] not ready yet (attempt ${i + 1}/${retries}), retrying...`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw new Error("Could not connect to Postgres after retries");
}

async function main() {
  await waitForDb();
  await initUsersTable();
  await initAlertsTable();
  await initAuditTable();
  startWatchdogMonitor();

  // Wrap the Express app in a plain HTTP server so the WebSocket server
  // can share the SAME port (4000) instead of needing a second one.
  const server = http.createServer(app);
  initWebSocket(server);

  // No devices are registered at startup. The devices table only ever
  // reflects the last CSV uploaded through POST /api/devices/upload —
  // that CSV is the registry the MQTT handshake reads from.
  startMqttSubscriber(); // remo_reg/remo_regOK handshake + telemetry/status/feed ingestion + ACKs + WS broadcast

  server.listen(PORT, () =>
    console.log(`[http] backend + websocket listening on port ${PORT}`)
  );
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
