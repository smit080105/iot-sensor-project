require("dotenv").config();

const http = require("http");
const express = require("express");
const cors = require("cors");
const pool = require("./db");
const startMqttSubscriber = require("./mqtt");
const { initWebSocket } = require("./ws");
const devicesRouter = require("./routes/devices");
const sensorsRouter = require("./routes/sensors");
const debugRouter = require("./routes/debug");

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => res.json({ status: "ok" }));
app.use("/api/devices", devicesRouter);
app.use("/api/sensors", sensorsRouter);
app.use("/api/debug", debugRouter);

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

  // Wrap the Express app in a plain HTTP server so the WebSocket server
  // can share the SAME port (4000) instead of needing a second one.
  const server = http.createServer(app);
  initWebSocket(server);

  // No devices are registered at startup. The devices table only ever
  // reflects the last CSV uploaded through POST /api/devices/upload —
  // that CSV is the registry the MQTT handshake reads from.
  startMqttSubscriber(); // DEVICE_reg/DEVICE_regok handshake + telemetry ingestion + ACKs + WS broadcast

  server.listen(PORT, () =>
    console.log(`[http] backend + websocket listening on port ${PORT}`)
  );
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
