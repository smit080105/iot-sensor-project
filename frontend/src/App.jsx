import React, { useEffect, useState, useCallback, useRef } from "react";
import TelemetryChart, { HIGH_TEMP_THRESHOLD } from "./TelemetryChart";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
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

  const [tempHistory, setTempHistory] = useState([]);
  const [humHistory, setHumHistory] = useState([]);

  const [csvFile, setCsvFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadErr, setUploadErr] = useState(null);

  const fileInputRef = useRef(null);

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
    if (e) e.preventDefault();
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
        setCsvFile(null); // clear after successful upload
        if (fileInputRef.current) fileInputRef.current.value = "";
        loadDevices();
      }
    } catch (err) {
      setUploadErr(err.message);
    } finally {
      setUploading(false);
    }
  }

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
  const wsRef = useRef(null);
  useEffect(() => {
    let reconnectTimer;
    let cancelled = false;

    function connect() {
      const ws = new WebSocket(WS_BASE);
      wsRef.current = ws;

      ws.onopen = () => {
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
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, []);

  // --- HTTP polling: fallback / initial load -------------------------
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

        const hist = Array.isArray(historyRows) ? [...historyRows].reverse() : [];
        setTempHistory(hist.filter((r) => r.sensor_type === "temperature").slice(-HISTORY_CAP));
        setHumHistory(hist.filter((r) => r.sensor_type === "humidity").slice(-HISTORY_CAP));

        setRegLog(Array.isArray(regLogRows) ? regLogRows : []);
        setConnErr(null);
      })
      .catch((e) => setConnErr(e.message));
  }, []);

  useInterval(pollSensors, 10000);

  const linkDown = connErr || wsStatus === "disconnected";
  const hotSensors = latest.filter((s) => s.sensor_type === "temperature" && Number(s.value) > HIGH_TEMP_THRESHOLD);

  // Statistics Calculations
  const activeNodesCount = new Set(latest.map((s) => s.sensor_id)).size;
  
  const tempReadings = latest.filter((s) => s.sensor_type === "temperature");
  const avgTemp = tempReadings.length
    ? (tempReadings.reduce((sum, s) => sum + Number(s.value), 0) / tempReadings.length).toFixed(1)
    : "N/A";

  const humReadings = latest.filter((s) => s.sensor_type === "humidity");
  const avgHum = humReadings.length
    ? (humReadings.reduce((sum, s) => sum + Number(s.value), 0) / humReadings.length).toFixed(1)
    : "N/A";

  return (
    <div className="console">
      {/* Top Navbar */}
      <header className="topbar">
        <div className="brand-wrapper">
          <svg className="brand-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2" />
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2" />
            <line x1="6" y1="6" x2="6.01" y2="6" />
            <line x1="6" y1="18" x2="6.01" y2="18" />
          </svg>
          <div className="brand">AERO<span>METRY</span> GATEWAY</div>
        </div>
        <div className={`status-badge ${linkDown ? "status--down" : "status--up"}`}>
          <span style={{
            width: "8px",
            height: "8px",
            borderRadius: "50%",
            backgroundColor: linkDown ? "#ef4444" : "#10b981",
            display: "inline-block",
            marginRight: "6px"
          }} />
          {linkDown ? "Disconnected" : `Live (${wsStatus})`}
        </div>
      </header>

      {/* Alert Banner */}
      {hotSensors.length > 0 && (
        <div className="alert-banner">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          <div className="alert-banner-content">
            <strong>Critical Alert:</strong> Temperature threshold exceeded ({HIGH_TEMP_THRESHOLD}°C) on {hotSensors.length} active node{hotSensors.length > 1 ? "s" : ""}:{" "}
            {hotSensors.map((s) => `${s.sensor_id} (${s.value}°C)`).join(", ")}
          </div>
        </div>
      )}

      {/* KPI Stats Row */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon-wrapper">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
              <line x1="7" y1="2" x2="7" y2="22" />
              <line x1="17" y1="2" x2="17" y2="22" />
              <line x1="2" y1="12" x2="22" y2="12" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Registered Devices</span>
            <span className="stat-value">{devices.length}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper success">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Active Sensors</span>
            <span className="stat-value">{activeNodesCount}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper warning">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Avg Temperature</span>
            <span className="stat-value">{avgTemp !== "N/A" ? `${avgTemp}°C` : "N/A"}</span>
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-icon-wrapper danger">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
          </div>
          <div className="stat-info">
            <span className="stat-label">Avg Humidity</span>
            <span className="stat-value">{avgHum !== "N/A" ? `${avgHum}%` : "N/A"}</span>
          </div>
        </div>
      </div>

      {/* Main Grid */}
      <div className="dashboard-grid">
        {/* Left Column: Chart and Live telemetry cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* Telemetry Charts Panel */}
          <section className="panel">
            <TelemetryChart temperature={tempHistory} humidity={humHistory} />
          </section>

          {/* Live Sensors Grid */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <h2>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                    <rect x="2" y="2" width="20" height="20" rx="2" ry="2" />
                    <path d="M12 18h.01" />
                    <path d="M17 12h.01" />
                    <path d="M7 12h.01" />
                    <path d="M12 6h.01" />
                  </svg>
                  Active Sensor Readings
                </h2>
                <p className="panel-subtitle">Real-time status and metric payloads broadcasted by connected nodes</p>
              </div>
            </div>
            
            <div className="cards">
              {latest
                .slice()
                .sort((a, b) => a.sensor_type.localeCompare(b.sensor_type))
                .map((s) => {
                  const isHot = s.sensor_type === "temperature" && Number(s.value) > HIGH_TEMP_THRESHOLD;
                  return (
                    <div
                      className={`card ${isHot ? "card--hot" : ""}`}
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
                  );
                })}
              {latest.length === 0 && (
                <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "2rem 0" }} className="dim">
                  Awaiting sensor connections. Sync the CSV registry to allow authorized nodes.
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Right Column: Upload, Registration Logs, Registered List, Raw Feed */}
        <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
          {/* CSV File Upload Registry */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <h2>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                    <polyline points="17 8 12 3 7 8" />
                    <line x1="12" y1="3" x2="12" y2="15" />
                  </svg>
                  Sync Device Registry
                </h2>
                <p className="panel-subtitle">Upload authorized node configuration profiles (CSV format)</p>
              </div>
            </div>

            <div 
              className="upload-zone" 
              onClick={() => fileInputRef.current?.click()}
            >
              <svg className="upload-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="12" y1="18" x2="12" y2="12" />
                <line x1="9" y1="15" x2="15" y2="15" />
              </svg>
              <div className="upload-text">
                <strong>Click to choose file</strong> or drag & drop authorized device registry list
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                className="file-input-hidden"
                onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
              />
              
              {csvFile && (
                <div className="selected-file-banner" onClick={(e) => e.stopPropagation()}>
                  <div className="file-details">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    <span>{csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)</span>
                  </div>
                  <button className="file-remove-btn" onClick={() => setCsvFile(null)}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              )}
            </div>

            {csvFile && (
              <button 
                type="button" 
                onClick={uploadCsv} 
                className="upload-action-btn"
                disabled={uploading}
              >
                {uploading ? "Synchronizing..." : "Upload & Apply Registry"}
              </button>
            )}

            {uploadErr && <div className="err" style={{ fontSize: "0.8rem", fontWeight: "500" }}>{uploadErr}</div>}
            {uploadResult && (
              <div className="ok" style={{ fontSize: "0.8rem", fontWeight: "500" }}>
                Success: Sync complete ({uploadResult.added.length} added, {uploadResult.removed.length} removed, {uploadResult.total_registered} total registered nodes).
              </div>
            )}
          </section>

          {/* Registration Attempt Logs */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <h2>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                    <path d="M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  Network Access Attempts
                </h2>
                <p className="panel-subtitle">Audited authentication logs for sensor handshake handshakes</p>
              </div>
            </div>

            <div className="table-container" style={{ maxHeight: "200px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>MAC Address</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {regLog.map((r, i) => (
                    <tr key={i}>
                      <td style={{ whiteSpace: "nowrap" }}>{new Date(r.time).toLocaleTimeString()}</td>
                      <td style={{ fontFamily: "monospace" }}>{r.mac || <span className="dim">—</span>}</td>
                      <td className={r.result?.startsWith("ok") ? "ok" : "err"} style={{ fontWeight: "600" }}>{r.result}</td>
                    </tr>
                  ))}
                  {regLog.length === 0 && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: "center" }} className="dim">No authentication attempts recorded.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Registered Devices Registry */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <h2>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                  </svg>
                  Authorized Registry List
                </h2>
                <p className="panel-subtitle">Verified hardware profiles allowed on this gateway</p>
              </div>
            </div>

            {devicesErr && <div className="err" style={{ fontSize: "0.8rem" }}>Failed to fetch active registry: {devicesErr}</div>}
            
            <div className="table-container" style={{ maxHeight: "200px" }}>
              <table>
                <thead>
                  <tr>
                    <th>MAC Address</th>
                    <th>Serial Number</th>
                    <th>Product Type</th>
                  </tr>
                </thead>
                <tbody>
                  {devices.map((d, i) => (
                    <tr key={i}>
                      <td style={{ fontFamily: "monospace" }}>{d.mac_address}</td>
                      <td>{d.serial_number}</td>
                      <td>{d.product_type}</td>
                    </tr>
                  ))}
                  {devices.length === 0 && !devicesErr && (
                    <tr>
                      <td colSpan={3} style={{ textAlign: "center" }} className="dim">Registry empty. Upload configuration profile.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Raw Feed WebSocket Logs */}
          <section className="panel">
            <div className="panel-header">
              <div className="panel-title-group">
                <h2>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "4px" }}>
                    <path d="M21 12a9 9 0 0 1-9 9m9-9a9 9 0 0 0-9-9m9 9H3m9 9a9 9 0 0 1-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9" />
                  </svg>
                  Live Signal Streams
                </h2>
                <p className="panel-subtitle">Incoming stream payloads received over active WebSockets</p>
              </div>
            </div>

            <div className="table-container" style={{ maxHeight: "250px" }}>
              <table>
                <thead>
                  <tr>
                    <th>Timestamp</th>
                    <th>Sensor</th>
                    <th>Type</th>
                    <th>Val</th>
                  </tr>
                </thead>
                <tbody>
                  {feed.map((r, i) => (
                    <tr key={r.id ?? `${r.sensor_id}-${r.sensor_type}-${r.received_at}-${i}`}>
                      <td>{new Date(r.received_at).toLocaleTimeString()}</td>
                      <td>{r.sensor_id}</td>
                      <td style={{ textTransform: "capitalize" }}>{r.sensor_type}</td>
                      <td style={{ fontWeight: "600" }}>{r.value}{r.unit}</td>
                    </tr>
                  ))}
                  {feed.length === 0 && (
                    <tr>
                      <td colSpan={4} style={{ textAlign: "center" }} className="dim">No telemetry stream connected.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
