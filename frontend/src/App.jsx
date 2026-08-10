import React, { useEffect, useState, useCallback, useRef } from "react";
import TelemetryChart, { HIGH_TEMP_THRESHOLD } from "./TelemetryChart";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
// Same host/port as the HTTP API — the backend attaches the WebSocket
// server to the SAME server (see backend/src/index.js + ws.js), just
// swap the protocol from http(s) to ws(s).
const WS_BASE = API_BASE.replace(/^http/, "ws");

const HISTORY_CAP = 200; // max points kept per chart series

function useInterval(callback, delayMs) {
  useEffect(() => {
    callback();
    const id = setInterval(callback, delayMs);
    return () => clearInterval(id);
  }, [callback, delayMs]);
}

function timeAgo(iso) {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

export default function App() {
  const [devices, setDevices] = useState([]);
  const [devicesErr, setDevicesErr] = useState(null);
  const [regLog, setRegLog] = useState([]);
  const [latest, setLatest] = useState([]);
  const [feed, setFeed] = useState([]);
  const [connErr, setConnErr] = useState(null);
  const [wsStatus, setWsStatus] = useState("connecting"); // connecting | connected | disconnected

  // Chart history — separate running series per sensor type so the
  // Temperature/Humidity/Correlation views have real trend data to plot,
  // independent of the small 25-row "raw feed" table.
  const [tempHistory, setTempHistory] = useState([]);
  const [humHistory, setHumHistory] = useState([]);

  const [csvFile, setCsvFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadErr, setUploadErr] = useState(null);

  const loadDevices = useCallback(() => {
    fetch(`${API_BASE}/api/devices`)
      .then((r) => r.json())
      .then((data) => {
        setDevices(data);
        setDevicesErr(null);
      })
      .catch((e) => setDevicesErr(e.message));
  }, []);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  async function uploadCsv(e) {
    e.preventDefault();
    if (!csvFile) return;

    setUploading(true);
    setUploadResult(null);
    setUploadErr(null);

    try {
      const formData = new FormData();
      formData.append("file", csvFile);

      const res = await fetch(`${API_BASE}/api/devices/upload`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadErr(data.error || `Upload failed (${res.status})`);
      } else {
        setUploadResult(data);
        loadDevices(); // refresh the dashboard with the new device set
      }
    } catch (err) {
      setUploadErr(err.message);
    } finally {
      setUploading(false);
    }
  }

  // Merge a batch of freshly-received readings into the "latest per
  // sensor" list, keyed by sensor_id + sensor_type so accelerometer /
  // gyroscope axes (accel_x, gyro_z, etc.) each get their own card
  // instead of overwriting temperature/humidity.
  function mergeLatest(prev, rows) {
    const copy = [...prev];
    for (const r of rows) {
      const key = `${r.sensor_id}::${r.sensor_type}`;
      const idx = copy.findIndex((s) => `${s.sensor_id}::${s.sensor_type}` === key);
      if (idx >= 0) copy[idx] = r;
      else copy.push(r);
    }
    return copy;
  }

  function appendHistory(rows) {
    const temps = rows.filter((r) => r.sensor_type === "temperature");
    const hums = rows.filter((r) => r.sensor_type === "humidity");
    if (temps.length) setTempHistory((prev) => [...prev, ...temps].slice(-HISTORY_CAP));
    if (hums.length) setHumHistory((prev) => [...prev, ...hums].slice(-HISTORY_CAP));
  }

  // --- WebSocket: live push updates ---------------------------------
  // The backend broadcasts { type: "raw-feed", data: [...] } the instant
  // new telemetry is stored, and { type: "reg-log", data: {...} } the
  // instant a DEVICE_reg attempt is logged. This is what makes the UI
  // update instantly instead of waiting for the next poll.
  const wsRef = useRef(null);
  useEffect(() => {
    let reconnectTimer;
    let cancelled = false;

    function connect() {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[ws] connected to backend");
        setWsStatus("connected");
        setConnErr(null);
      };

      ws.onmessage = (evt) => {
        try {
          const msg = JSON.parse(evt.data);

          if (msg.type === "raw-feed") {
            const rows = Array.isArray(msg.data) ? msg.data : [msg.data];
            setFeed((prev) => [...rows, ...prev].slice(0, 50));
            setLatest((prev) => mergeLatest(prev, rows));
            appendHistory(rows);
          }

          if (msg.type === "reg-log") {
            setRegLog((prev) => [msg.data, ...prev].slice(0, 30));
          }
        } catch (e) {
          console.warn("[ws] could not parse message", e);
        }
      };

      ws.onclose = () => {
        if (cancelled) return;
        console.log("[ws] disconnected — retrying in 3s");
        setWsStatus("disconnected");
        reconnectTimer = setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      cancelled = true;
      clearTimeout(reconnectTimer);
      if (wsRef.current) {
        wsRef.current.onclose = null; // don't trigger a reconnect on unmount
        wsRef.current.close();
      }
    };
  }, []);

  // --- HTTP polling: fallback / initial load -------------------------
  // Runs every 10s as a safety net in case the WebSocket connection is
  // down, and to seed/refresh the chart history and tables on first load.
  const pollSensors = useCallback(() => {
    Promise.all([
      fetch(`${API_BASE}/api/sensors/latest`).then((r) => r.json()),
      fetch(`${API_BASE}/api/sensors?limit=25`).then((r) => r.json()),
      fetch(`${API_BASE}/api/sensors?limit=200`).then((r) => r.json()),
      fetch(`${API_BASE}/api/debug/reg-log`).then((r) => r.json()),
    ])
      .then(([latestRows, feedRows, historyRows, regLogRows]) => {
        setLatest(Array.isArray(latestRows) ? latestRows : []);
        setFeed(Array.isArray(feedRows) ? feedRows : []);

        const hist = Array.isArray(historyRows) ? [...historyRows].reverse() : []; // API is DESC, chart wants ascending
        setTempHistory(hist.filter((r) => r.sensor_type === "temperature").slice(-HISTORY_CAP));
        setHumHistory(hist.filter((r) => r.sensor_type === "humidity").slice(-HISTORY_CAP));

        setRegLog(Array.isArray(regLogRows) ? regLogRows : []);
        setConnErr(null);
      })
      .catch((e) => setConnErr(e.message));
  }, []);

  useInterval(pollSensors, 10000);

  const linkDown = connErr || wsStatus === "disconnected";

  // High-temperature alert: fires whenever ANY currently-latest
  // temperature reading exceeds the 28°C threshold shown on the chart.
  const hotSensors = latest.filter((s) => s.sensor_type === "temperature" && Number(s.value) > HIGH_TEMP_THRESHOLD);

  return (
    <div className="console">
      <header className="topbar">
        <div className="brand">MAC-AUTHORIZED SENSOR CONSOLE</div>
        <div className={`status ${linkDown ? "status--down" : "status--up"}`}>
          {linkDown ? "LINK DOWN" : `LINK OK (ws: ${wsStatus})`}
        </div>
      </header>

      {hotSensors.length > 0 && (
        <div className="alert-banner">
          ⚠ HIGH TEMPERATURE — {hotSensors.length} sensor{hotSensors.length > 1 ? "s" : ""} above {HIGH_TEMP_THRESHOLD}°C:{" "}
          {hotSensors.map((s) => `${s.sensor_id} (${s.value}°C)`).join(", ")}
        </div>
      )}

      <section className="panel">
        <h2>DEVICE_reg ATTEMPTS <span className="dim">// live log of every incoming registration message — see the raw mac_address/token here</span></h2>
        <table>
          <thead>
            <tr>
              <th>TIME</th>
              <th>MAC ADDRESS</th>
              <th>TOKEN</th>
              <th>RESULT</th>
            </tr>
          </thead>
          <tbody>
            {regLog.map((r, i) => (
              <tr key={i}>
                <td>{new Date(r.time).toLocaleTimeString()}</td>
                <td>{r.mac || <span className="dim">—</span>}</td>
                <td>{r.token || <span className="dim">—</span>}</td>
                <td className={r.result?.startsWith("ok") ? "ok" : "err"}>{r.result}</td>
              </tr>
            ))}
            {regLog.length === 0 && (
              <tr><td colSpan={4} className="dim">no DEVICE_reg messages received yet</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>UPLOAD DEVICES CSV <span className="dim">// this CSV is the registry — rows need mac_address and dongle_id</span></h2>
        <form onSubmit={uploadCsv} className="mac-form">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
          />
          <button type="submit" disabled={!csvFile || uploading}>
            {uploading ? "Uploading…" : "Upload & Sync"}
          </button>
        </form>
        {uploadErr && <p className="err">{uploadErr}</p>}
        {uploadResult && (
          <p className="ok">
            Added: {uploadResult.added.length} &middot; Removed: {uploadResult.removed.length}
            {uploadResult.rejected.length > 0 && (
              <> &middot; Rejected (missing mac/dongle_id): {uploadResult.rejected.length}</>
            )}
            {" "}&middot; Now registered: {uploadResult.total_registered}
          </p>
        )}
      </section>

      <section className="panel">
        <h2>REGISTERED DEVICES <span className="dim">// {devices.length} registered from the last uploaded CSV</span></h2>
        {devicesErr && <p className="err">Could not load device registry: {devicesErr}</p>}
        <table>
          <thead>
            <tr>
              <th>MAC ADDRESS</th>
              <th>SERIAL NUMBER</th>
              <th>PRODUCT TYPE</th>
              <th>DONGLE ID</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((d, i) => (
              <tr key={i}>
                <td>{d.mac_address}</td>
                <td>{d.serial_number}</td>
                <td>{d.product_type}</td>
                <td>{d.dongle_id}</td>
              </tr>
            ))}
            {devices.length === 0 && !devicesErr && (
              <tr><td colSpan={4} className="dim">no devices registered — upload a CSV with mac_address and dongle_id above</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <section className="panel">
        <h2>TEMPERATURE & HUMIDITY TRENDS <span className="dim">// switch view below — red dashed line marks the {HIGH_TEMP_THRESHOLD}°C high limit</span></h2>
        <TelemetryChart temperature={tempHistory} humidity={humHistory} />
      </section>

      <section className="panel">
        <h2>LIVE SENSORS <span className="dim">// temperature, humidity, accelerometer (Ax/Ay/Az) and gyroscope (Gx/Gy/Gz) — every reading stays here, not just the newest one</span></h2>
        <div className="cards">
          {latest
            .slice()
            .sort((a, b) => a.sensor_type.localeCompare(b.sensor_type))
            .map((s) => (
              <div
                className={`card ${s.sensor_type === "temperature" && Number(s.value) > HIGH_TEMP_THRESHOLD ? "card--hot" : ""}`}
                key={`${s.sensor_id}::${s.sensor_type}`}
              >
                <div className="card-id">{s.sensor_id}</div>
                <div className="card-mac">{s.mac_address}</div>
                <div className="card-value">
                  {s.value}
                  <span className="unit">{s.unit}</span>
                </div>
                <div className="card-meta">
                  {s.sensor_type} &middot; {timeAgo(s.received_at)}
                </div>
              </div>
            ))}
          {latest.length === 0 && (
            <p className="dim">no readings yet — upload a CSV to register devices, then wait for telemetry</p>
          )}
        </div>
      </section>

      <section className="panel">
        <h2>RAW FEED <span className="dim">// last 25 readings, updated live over WebSocket</span></h2>
        <table>
          <thead>
            <tr>
              <th>TIME</th>
              <th>MAC ADDRESS</th>
              <th>SENSOR ID</th>
              <th>TYPE</th>
              <th>VALUE</th>
            </tr>
          </thead>
          <tbody>
            {feed.map((r, i) => (
              <tr key={r.id ?? `${r.sensor_id}-${r.sensor_type}-${r.received_at}-${i}`}>
                <td>{new Date(r.received_at).toLocaleTimeString()}</td>
                <td>{r.mac_address}</td>
                <td>{r.sensor_id}</td>
                <td>{r.sensor_type}</td>
                <td>{r.value}{r.unit}</td>
              </tr>
            ))}
            {feed.length === 0 && (
              <tr><td colSpan={5} className="dim">no data</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
