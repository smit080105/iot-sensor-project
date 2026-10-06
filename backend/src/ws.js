const { WebSocketServer } = require("ws");
const { URL } = require("url");
const { verifyToken } = require("./authUtil");

// Single shared WebSocket server instance, attached to the same HTTP
// server the Express app listens on (see index.js). mqtt.js imports
// `broadcast` from here to push live events to every connected dashboard
// the instant something happens, instead of the dashboard having to poll.
//
// Authenticated via JWT token query param: wss://host/?token=...

let wss = null;

function initWebSocket(server) {
  wss = new WebSocketServer({
    server,
    verifyClient: (info, done) => {
      let token = null;
      try {
        const url = new URL(info.req.url, "http://localhost");
        token = url.searchParams.get("token");
      } catch {
        token = null;
      }

      // Check JWT token first
      if (token && verifyToken(token)) {
        return done(true);
      }

      console.warn("[ws] Rejected connection attempt: missing or invalid session token");
      return done(false, 401, "Unauthorized");
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

  console.log("[ws] WebSocket server attached to HTTP server (session-token protected)");
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
