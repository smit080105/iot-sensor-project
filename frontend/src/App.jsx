import React, { useEffect, useState, useCallback, useRef } from "react";
import TelemetryChart, { HIGH_TEMP_THRESHOLD } from "./TelemetryChart";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const WS_BASE = API_BASE.replace(/^http/, "ws");
const HISTORY_CAP = 200;

function useInterval(callback, delayMs) {
  useEffect(() => {
    callback();
    const id = setInterval(callback, delayMs);
    return () => clearInterval(id);
  }, [callback, delayMs]);
}

function timeAgo(iso) {
  if (!iso) return "No heartbeat";
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
  const [wsStatus, setWsStatus] = useState("connecting");

  const [tempHistory, setTempHistory] = useState([]);
  const [humHistory, setHumHistory] = useState([]);

  // Sidebar / Navigation states
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [devicesExpanded, setDevicesExpanded] = useState(true);
  const [viewMode, setViewMode] = useState("dashboard"); // dashboard | admin

  // Date filters
  const [startDate, setStartDate] = useState("24/08/2026");
  const [endDate, setEndDate] = useState("25/08/2026");
  const [quickRange, setQuickRange] = useState("Last 24 hrs");

  // Admin / CSV Upload states
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

  // Set default selected device when loaded
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      setSelectedDevice(devices[0]);
    }
  }, [devices, selectedDevice]);

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
        setCsvFile(null);
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

  // Filter latest readings for the currently selected device's MAC address
  const activeMac = selectedDevice?.mac_address || "";
  const deviceReadings = latest.filter((s) => s.mac_address === activeMac);
  
  const getMetricVal = (type) => {
    const r = deviceReadings.find((s) => s.sensor_type === type);
    return r ? `${r.value} ${r.unit}` : "--";
  };

  const selectedDeviceLastActive = deviceReadings.length
    ? new Date(Math.max(...deviceReadings.map((r) => new Date(r.received_at).getTime()))).toISOString()
    : null;

  // Filter trends to selected device for visual charts
  const selectedTempTrend = tempHistory.filter((r) => r.mac_address === activeMac);
  const selectedHumTrend = humHistory.filter((r) => r.mac_address === activeMac);

  return (
    <div className="remonet-layout">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="brand-logo">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <span className="brand-name">ReMoNet</span>
        </div>

        <nav className="sidebar-nav">
          <button 
            className={`nav-item ${viewMode === "dashboard" && !selectedDevice ? "active" : ""}`}
            onClick={() => { setViewMode("dashboard"); setSelectedDevice(devices[0] || null); }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
            Home
          </button>

          <div className="nav-group">
            <button 
              className="nav-item group-header"
              onClick={() => setDevicesExpanded(!devicesExpanded)}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
              Devices
              <svg 
                className={`chevron ${devicesExpanded ? "rotated" : ""}`} 
                width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </button>

            {devicesExpanded && (
              <div className="nav-sub-list">
                {devices.map((d) => {
                  const isActive = viewMode === "dashboard" && selectedDevice?.mac_address === d.mac_address;
                  return (
                    <button
                      key={d.mac_address}
                      className={`nav-sub-item ${isActive ? "active" : ""}`}
                      onClick={() => {
                        setSelectedDevice(d);
                        setViewMode("dashboard");
                      }}
                    >
                      <span className="dot" />
                      {d.dongle_id || d.product_type || "Energy Meter"}
                    </button>
                  );
                })}
                {devices.length === 0 && (
                  <span className="nav-sub-empty">No registered devices</span>
                )}
              </div>
            )}
          </div>

          <button 
            className={`nav-item ${viewMode === "admin" ? "active" : ""}`}
            onClick={() => setViewMode("admin")}
            style={{ marginTop: "1rem" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            + New / Modify
          </button>

          <button 
            className={`nav-item ${viewMode === "admin" ? "active" : ""}`}
            onClick={() => setViewMode("admin")}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            Admin
          </button>
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="main-content">
        {viewMode === "dashboard" ? (
          <>
            {/* Dashboard Mode */}
            <header className="main-header">
              <div className="header-title-row">
                <button className="back-btn" onClick={() => setSelectedDevice(null)}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <line x1="19" y1="12" x2="5" y2="12" />
                    <polyline points="12 19 5 12 12 5" />
                  </svg>
                </button>
                <h1 className="header-title">
                  {selectedDevice ? (selectedDevice.dongle_id || selectedDevice.product_type).toUpperCase() : "DASHBOARD"}
                </h1>
              </div>

              <div className="header-status">
                <div className={`status-badge-indicator ${linkDown ? "offline" : "online"}`}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="status-icon">
                    {linkDown ? (
                      <path d="M1 1l22 22M16.72 11.06A10.94 10.94 0 0 1 19 12.5M5 12.5a10.94 10.94 0 0 1 5.83-2.84M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
                    ) : (
                      <path d="M5 12.5a10.87 10.87 0 0 1 14 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
                    )}
                  </svg>
                  {linkDown ? "Offline" : "Online"}
                </div>
              </div>
            </header>

            {/* Filter Bar */}
            <div className="filter-bar">
              <div className="filter-group">
                <label className="filter-label">Quick Range</label>
                <select 
                  className="filter-select" 
                  value={quickRange}
                  onChange={(e) => setQuickRange(e.target.value)}
                >
                  <option>Last 24 hrs</option>
                  <option>Last 7 days</option>
                  <option>Last 30 days</option>
                </select>
              </div>

              <div className="filter-group">
                <label className="filter-label">Start Date</label>
                <div className="date-input-wrapper">
                  <input 
                    type="text" 
                    className="filter-input" 
                    value={startDate} 
                    onChange={(e) => setStartDate(e.target.value)}
                  />
                  <svg className="calendar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
              </div>

              <div className="filter-group">
                <label className="filter-label">End Date</label>
                <div className="date-input-wrapper">
                  <input 
                    type="text" 
                    className="filter-input" 
                    value={endDate} 
                    onChange={(e) => setEndDate(e.target.value)}
                  />
                  <svg className="calendar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                </div>
              </div>

              <button className="btn-load-data">Load Data</button>
              <button className="btn-set-interval">Set Interval</button>
            </div>

            {/* Content Dashboard Grid */}
            {selectedDevice ? (
              <div className="dashboard-grid-layout">
                {/* Left Column: Device Info & Metrics */}
                <div className="column-left">
                  {/* Device Info Panel */}
                  <div className="dashboard-card">
                    <h2 className="card-title">Device Information</h2>
                    <div className="card-content-list">
                      <div className="info-row">
                        <span className="info-label">Serial Number</span>
                        <span className="info-val">{selectedDevice.serial_number}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Product Type</span>
                        <span className="info-val">{selectedDevice.product_type}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Last Updated</span>
                        <span className="info-val">{selectedDeviceLastActive ? timeAgo(selectedDeviceLastActive) : "No heartbeat"}</span>
                      </div>
                    </div>
                  </div>

                  {/* Sensor Metrics Panel */}
                  <div className="dashboard-card">
                    <div className="metrics-header-row">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="metrics-header-icon">
                        <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                        <line x1="7" y1="2" x2="7" y2="22" />
                        <line x1="17" y1="2" x2="17" y2="22" />
                        <line x1="2" y1="12" x2="22" y2="12" />
                      </svg>
                      <h2 className="card-title">Energy Metrics</h2>
                    </div>

                    <div className="card-content-list dotted-separators">
                      <div className="info-row">
                        <span className="info-label">Temperature</span>
                        <span className="info-val">{getMetricVal("temperature")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Humidity</span>
                        <span className="info-val">{getMetricVal("humidity")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Accelerometer X</span>
                        <span className="info-val">{getMetricVal("accelerometer_x")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Accelerometer Y</span>
                        <span className="info-val">{getMetricVal("accelerometer_y")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Accelerometer Z</span>
                        <span className="info-val">{getMetricVal("accelerometer_z")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Gyroscope X</span>
                        <span className="info-val">{getMetricVal("gyroscope_x")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Gyroscope Y</span>
                        <span className="info-val">{getMetricVal("gyroscope_y")}</span>
                      </div>
                      <div className="info-row">
                        <span className="info-label">Gyroscope Z</span>
                        <span className="info-val">{getMetricVal("gyroscope_z")}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Right Column: Sensor Trend Graph */}
                <div className="column-right">
                  <div className="dashboard-card chart-card">
                    <TelemetryChart temperature={selectedTempTrend} humidity={selectedHumTrend} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-selection-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                </line>
                <p>Select a device from the sidebar to display real-time sensor metrics and analysis trend lines.</p>
              </div>
            )}

            {/* Footer Bar */}
            <footer className="main-footer-nav">
              <span className="footer-status">Showing Page 1 (Last {tempHistory.length + humHistory.length} points)</span>
              <div className="footer-pagination">
                <button className="btn-pagination" disabled>Previous</button>
                <button className="btn-pagination" disabled>Next</button>
              </div>
            </footer>
          </>
        ) : (
          <>
            {/* Administration / CSV Upload Mode */}
            <header className="main-header">
              <h1 className="header-title">ADMINISTRATIVE GATEWAY</h1>
            </header>

            <div className="admin-grid-layout">
              {/* CSV Upload Profile Card */}
              <div className="dashboard-card">
                <h2 className="card-title">Sync Device Registry</h2>
                <div className="upload-zone" onClick={() => fileInputRef.current?.click()}>
                  <svg className="upload-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  <p className="upload-text">Click to choose a CSV device configuration profile or drag it here</p>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="file-input-hidden"
                    onChange={(e) => setCsvFile(e.target.files?.[0] || null)}
                  />
                  {csvFile && (
                    <div className="selected-file-banner" onClick={(e) => e.stopPropagation()}>
                      <span>{csvFile.name} ({(csvFile.size / 1024).toFixed(1)} KB)</span>
                      <button className="file-remove-btn" onClick={() => setCsvFile(null)}>×</button>
                    </div>
                  )}
                </div>

                {csvFile && (
                  <button type="button" onClick={uploadCsv} className="upload-action-btn" disabled={uploading}>
                    {uploading ? "Applying..." : "Sync Devices List"}
                  </button>
                )}

                {uploadErr && <p className="err-text">{uploadErr}</p>}
                {uploadResult && (
                  <p className="ok-text">
                    Synced: {uploadResult.added.length} added, {uploadResult.removed.length} removed, {uploadResult.total_registered} total registered.
                  </p>
                )}
              </div>

              {/* Registered Devices List */}
              <div className="dashboard-card">
                <h2 className="card-title">Active Gateway Registry</h2>
                <div className="table-container">
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
                          <td>{d.mac_address}</td>
                          <td>{d.serial_number}</td>
                          <td>{d.product_type}</td>
                        </tr>
                      ))}
                      {devices.length === 0 && (
                        <tr>
                          <td colSpan={3} className="empty-text">No registered devices. Upload registry profile above.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Handshake Attempts Log */}
              <div className="dashboard-card">
                <h2 className="card-title">Network Access Handshakes</h2>
                <div className="table-container">
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
                          <td>{new Date(r.time).toLocaleTimeString()}</td>
                          <td>{r.mac}</td>
                          <td className={r.result?.startsWith("ok") ? "ok-text" : "err-text"}>{r.result}</td>
                        </tr>
                      ))}
                      {regLog.length === 0 && (
                        <tr>
                          <td colSpan={3} className="empty-text">No handshakes registered yet.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Real-time Streams WebSocket Feed */}
              <div className="dashboard-card">
                <h2 className="card-title">Live Signal Streams</h2>
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Sensor ID</th>
                        <th>Metric</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {feed.map((r, i) => (
                        <tr key={r.id ?? `${r.sensor_id}-${r.sensor_type}-${r.received_at}-${i}`}>
                          <td>{new Date(r.received_at).toLocaleTimeString()}</td>
                          <td>{r.sensor_id}</td>
                          <td>{r.sensor_type}</td>
                          <td>{r.value}{r.unit}</td>
                        </tr>
                      ))}
                      {feed.length === 0 && (
                        <tr>
                          <td colSpan={4} className="empty-text">No incoming telemetry logs.</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
