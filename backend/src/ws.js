const { WebSocketServer } = require("ws");

// Single shared WebSocket server instance, attached to the same HTTP
// server the Express app listens on (see index.js). mqtt.js imports
// `broadcast` from here to push live events to every connected dashboard
// the instant something happens, instead of the dashboard having to poll.

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({ server });

  wss.on("connection", (socket) => {
    console.log(`[ws] client connected (${wss.clients.size} total)`);
    socket.on("close", () => {
      console.log(`[ws] client disconnected (${wss.clients.size} total)`);
    });
    socket.on("error", (err) => {
      console.warn("[ws] client socket error:", err.message);
    });
  });

  console.log("[ws] WebSocket server attached to HTTP server");
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
