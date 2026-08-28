const { WebSocketServer } = require("ws");
const { URL } = require("url");
const { isValidApiKey } = require("./middleware/auth");

// Single shared WebSocket server instance, attached to the same HTTP
// server the Express app listens on (see index.js). mqtt.js imports
// `broadcast` from here to push live events to every connected dashboard
// the instant something happens, instead of the dashboard having to poll.
//
// This stream carries the same sensitive data as the REST API (device
// MACs, reg-log attempts, live telemetry), so it needs the same API-key
// gate. Browsers can't set custom headers on a WebSocket handshake, so
// the key travels as a query parameter instead: wss://host/?apiKey=...
// (the frontend appends it automatically — see src/App.jsx).

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({
    server,
    verifyClient: (info, done) => {
      let apiKey;
      try {
        const url = new URL(info.req.url, "http://localhost");
        apiKey = url.searchParams.get("apiKey");
      } catch {
        apiKey = null;
      }

      if (!isValidApiKey(apiKey)) {
        console.warn("[ws] Rejected connection attempt — missing/invalid apiKey query param");
        return done(false, 401, "Unauthorized");
      }
      done(true);
    },
  });

  wss.on("connection", (socket) => {
    console.log(`[ws] client connected (${wss.clients.size} total)`);
    socket.on("close", () => {
      console.log(`[ws] client disconnected (${wss.clients.size} total)`);
    });
    socket.on("error", (err) => {
      console.warn("[ws] client socket error:", err.message);
    });
  });

  console.log("[ws] WebSocket server attached to HTTP server (API-key protected)");
}

// Send a JSON payload to every currently-connected dashboard client.
// Safe to call even if no clients are connected, or before init.
function broadcast(payload) {
  if (!wss) return;
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === 1 /* OPEN */) {
      client.send(data);
    }
  }
}

module.exports = { initWebSocket, broadcast };
