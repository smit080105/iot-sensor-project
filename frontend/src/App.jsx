import React, { useEffect, useState, useCallback, useRef } from "react";
import TelemetryChart from "./TelemetryChart";
import Login from "./Login";
import Sidebar from "./components/Sidebar";
import DashboardHeader from "./components/DashboardHeader";
import FilterBar from "./components/FilterBar";
import DeviceInfoPanel from "./components/DeviceInfoPanel";
import EnergyMetricsPanel from "./components/EnergyMetricsPanel";
import DeviceHeartbeatPanel from "./components/DeviceHeartbeatPanel";
import DeviceActivityTimeline from "./components/DeviceActivityTimeline";
import LiveFeedPanel from "./components/LiveFeedPanel";
import AdminPanel from "./components/AdminPanel";
import AlertsDrawer from "./components/AlertsDrawer";
import { useIoTWebSocket } from "./hooks/useIoTWebSocket";
import { useInterval } from "./hooks/useInterval";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
function localDateInputValue(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeDates(range, now = new Date()) {
  const end = localDateInputValue(now);
  const startDate = new Date(now);
  startDate.setHours(0, 0, 0, 0);
  startDate.setDate(startDate.getDate() - (range === "Last 7 days" ? 6 : range === "Last 30 days" ? 29 : 0));
  return { start: localDateInputValue(startDate), end };
}

export default function App() {
  // Authentication & session state
  const [authToken, setAuthToken] = useState(() => localStorage.getItem("remonet_token") || null);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const saved = localStorage.getItem("remonet_user");
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Device registry & UI navigation
  const [devices, setDevices] = useState([]);
  const [devicesErr, setDevicesErr] = useState(null);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [devicesExpanded, setDevicesExpanded] = useState(true);
  const [viewMode, setViewMode] = useState("dashboard"); // 'dashboard' | 'admin'

  // Date filters
  const [initialRange] = useState(() => rangeDates("Last 24 hrs"));
  const [startDate, setStartDate] = useState(initialRange.start);
  const [endDate, setEndDate] = useState(initialRange.end);
  const [quickRange, setQuickRange] = useState("Last 24 hrs");
  const [chartTemperature, setChartTemperature] = useState([]);
  const [chartHumidity, setChartHumidity] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState(null);
  const historyRequestId = useRef(0);
  const [activityAlerts, setActivityAlerts] = useState([]);
  const [activityLoading, setActivityLoading] = useState(false);
  const [activityError, setActivityError] = useState(null);
  const activityRequestId = useRef(0);

  // Alerts & Incident drawer
  const [isAlertDrawerOpen, setIsAlertDrawerOpen] = useState(false);
  const [alertFilter, setAlertFilter] = useState("ACTIVE");

  // CSV upload state
  const [csvFile, setCsvFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);
  const [uploadErr, setUploadErr] = useState(null);

  // Audit logs state
  const [auditLogs, setAuditLogs] = useState([]);
  const [auditSummary, setAuditSummary] = useState(null);
  const [auditLoading, setAuditLoading] = useState(false);
  const [auditFilterAction, setAuditFilterAction] = useState("");

  // WebSocket real-time subscription
  const {
    wsStatus,
    connErr,
    setConnErr,
    feed,
    setFeed,
    latest,
    setLatest,
    regLog,
    setRegLog,
    deviceStatuses,
    setDeviceStatuses,
    deviceFeeds,
    setDeviceFeeds,
    tempHistory,
    setTempHistory,
    humHistory,
    setHumHistory,
    alerts,
    setAlerts,
    alertSummary,
    setAlertSummary,
  } = useIoTWebSocket({ apiBase: API_BASE, authToken });

  const getAuthHeaders = useCallback(() => {
    const headers = {};
    if (authToken) headers["Authorization"] = `Bearer ${authToken}`;
    return headers;
  }, [authToken]);

  const handleLogin = useCallback((token, user) => {
    setAuthToken(token);
    setCurrentUser(user);
    localStorage.setItem("remonet_token", token);
    localStorage.setItem("remonet_user", JSON.stringify(user));
  }, []);

  const handleLogout = useCallback(() => {
    setAuthToken(null);
    setCurrentUser(null);
    localStorage.removeItem("remonet_token");
    localStorage.removeItem("remonet_user");
    setViewMode("dashboard");
  }, []);

  const loadDevices = useCallback(() => {
    if (!authToken) return;
    fetch(`${API_BASE}/api/devices`, { headers: getAuthHeaders() })
      .then((r) => {
        if (r.status === 401) {
          handleLogout();
          throw new Error("Session expired");
        }
        return r.json();
      })
      .then((data) => {
        if (Array.isArray(data)) {
          setDevices(data);
          setDevicesErr(null);
        }
      })
      .catch((e) => setDevicesErr(e.message));
  }, [authToken, getAuthHeaders, handleLogout]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  // Set default selected device on load
  useEffect(() => {
    if (devices.length > 0 && !selectedDevice) {
      setSelectedDevice(devices[0]);
    }
  }, [devices, selectedDevice]);

  const loadAuditLogs = useCallback(() => {
    if (!authToken || currentUser?.role !== "admin") return;
    setAuditLoading(true);
    const query = auditFilterAction
      ? `?action=${encodeURIComponent(auditFilterAction)}&limit=100`
      : `?limit=100`;

    Promise.all([
      fetch(`${API_BASE}/api/audit${query}`, { headers: getAuthHeaders() }).then((r) => {
        if (r.status === 401) handleLogout();
        return r.json();
      }),
      fetch(`${API_BASE}/api/audit/summary`, { headers: getAuthHeaders() }).then((r) => r.json()),
    ])
      .then(([logs, summary]) => {
        if (Array.isArray(logs)) setAuditLogs(logs);
        if (summary && !summary.error) setAuditSummary(summary);
      })
      .catch((e) => console.warn("Failed to load audit records:", e))
      .finally(() => setAuditLoading(false));
  }, [authToken, currentUser, auditFilterAction, getAuthHeaders, handleLogout]);

  useEffect(() => {
    if (viewMode === "admin" && currentUser?.role === "admin") {
      loadAuditLogs();
    }
  }, [viewMode, currentUser, loadAuditLogs]);

  const pollSensors = useCallback(() => {
    if (!authToken) return;
    const h = getAuthHeaders();
    Promise.all([
      fetch(`${API_BASE}/api/sensors/latest`, { headers: h }).then((r) => {
        if (r.status === 401) handleLogout();
        return r.json();
      }),
      fetch(`${API_BASE}/api/sensors?limit=25`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/api/debug/reg-log`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/api/status`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/api/feed`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/api/alerts?status=${alertFilter === "ALL" ? "" : "ACTIVE"}`, { headers: h }).then((r) => r.json()),
      fetch(`${API_BASE}/api/alerts/summary`, { headers: h }).then((r) => r.json()),
    ])
      .then(([latestRows, feedRows, regLogRows, statusRows, deviceFeedRows, alertsData, summaryData]) => {
        setLatest(Array.isArray(latestRows) ? latestRows : []);
        setFeed(Array.isArray(feedRows) ? feedRows : []);

        setRegLog(Array.isArray(regLogRows) ? regLogRows : []);

        if (Array.isArray(statusRows)) {
          setDeviceStatuses(Object.fromEntries(statusRows.map((s) => [s.dongle_id, s])));
        }
        if (Array.isArray(deviceFeedRows)) {
          setDeviceFeeds(Object.fromEntries(deviceFeedRows.map((f) => [f.dongle_id, f])));
        }

        if (Array.isArray(alertsData)) setAlerts(alertsData);
        if (summaryData && typeof summaryData.active_total === "number") setAlertSummary(summaryData);

        setConnErr(null);
      })
      .catch((e) => setConnErr(e.message));
  }, [authToken, alertFilter, getAuthHeaders, handleLogout, setLatest, setFeed, setTempHistory, setHumHistory, setRegLog, setDeviceStatuses, setDeviceFeeds, setAlerts, setAlertSummary, setConnErr]);

  const loadChartHistory = useCallback(async () => {
    if (!authToken || !selectedDevice?.mac_address) return;
    const requestId = ++historyRequestId.current;
    if (!startDate || !endDate || startDate > endDate) {
      setHistoryError("Choose a valid date range. The start date must not be after the end date.");
      setHistoryLoading(false);
      return;
    }
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const query = new URLSearchParams({ start: startDate, end: endDate, mac_address: selectedDevice.mac_address, range: quickRange });
      const response = await fetch(`${API_BASE}/api/sensors/history?${query}`, { headers: getAuthHeaders() });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || `Could not load history (${response.status})`);
      if (requestId !== historyRequestId.current) return;
      const sortedRows = Array.isArray(rows) ? rows : [];
      setChartTemperature(sortedRows.filter((r) => r.sensor_type === "temperature"));
      setChartHumidity(sortedRows.filter((r) => r.sensor_type === "humidity"));
    } catch (error) {
      if (requestId !== historyRequestId.current) return;
      setChartTemperature([]);
      setChartHumidity([]);
      setHistoryError(error.message || "Could not load sensor history.");
    } finally {
      if (requestId === historyRequestId.current) setHistoryLoading(false);
    }
  }, [authToken, selectedDevice, startDate, endDate, quickRange, getAuthHeaders]);

  useEffect(() => {
    if (selectedDevice) loadChartHistory();
  }, [selectedDevice, loadChartHistory]);

  const loadDeviceActivity = useCallback(async () => {
    if (!authToken || !selectedDevice?.dongle_id) return;
    const requestId = ++activityRequestId.current;
    if (!startDate || !endDate || startDate > endDate) {
      setActivityError("Choose a valid date range.");
      setActivityLoading(false);
      return;
    }
    setActivityLoading(true);
    setActivityError(null);
    try {
      const query = new URLSearchParams({
        dongle_id: selectedDevice.dongle_id,
        start: startDate,
        end: endDate,
        range: quickRange,
      });
      const response = await fetch(`${API_BASE}/api/alerts/history?${query}`, { headers: getAuthHeaders() });
      const rows = await response.json();
      if (!response.ok) throw new Error(rows.error || `Could not load alerts (${response.status})`);
      if (requestId === activityRequestId.current) setActivityAlerts(Array.isArray(rows) ? rows : []);
    } catch (error) {
      if (requestId !== activityRequestId.current) return;
      setActivityAlerts([]);
      setActivityError(error.message || "Could not load alert history.");
    } finally {
      if (requestId === activityRequestId.current) setActivityLoading(false);
    }
  }, [authToken, selectedDevice, startDate, endDate, quickRange, getAuthHeaders]);

  useEffect(() => {
    if (selectedDevice) loadDeviceActivity();
  }, [selectedDevice, loadDeviceActivity]);

  useInterval(pollSensors, 10000);

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
        headers: getAuthHeaders(),
        body: formData,
      });
      const data = await res.json();

      if (!res.ok) {
        setUploadErr(data.error || `Upload failed (${res.status})`);
      } else {
        setUploadResult(data);
        setCsvFile(null);
        loadDevices();
        loadAuditLogs();
      }
    } catch (err) {
      setUploadErr(err.message);
    } finally {
      setUploading(false);
    }
  }

  const acknowledgeAlert = async (id) => {
    try {
      await fetch(`${API_BASE}/api/alerts/${id}/acknowledge`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      pollSensors();
      if (currentUser?.role === "admin") loadAuditLogs();
    } catch (err) {
      console.error("Failed to acknowledge alert:", err);
    }
  };

  const resolveAlert = async (id) => {
    try {
      await fetch(`${API_BASE}/api/alerts/${id}/resolve`, {
        method: "POST",
        headers: getAuthHeaders(),
      });
      pollSensors();
      if (currentUser?.role === "admin") loadAuditLogs();
    } catch (err) {
      console.error("Failed to resolve alert:", err);
    }
  };

  if (!authToken) {
    return <Login apiBase={API_BASE} onLogin={handleLogin} />;
  }

  const linkDown = connErr || wsStatus === "disconnected";
  const activeMac = selectedDevice?.mac_address || "";
  const deviceReadings = latest.filter((s) => s.mac_address === activeMac);
  const selectedDeviceStatus = selectedDevice ? deviceStatuses[selectedDevice.dongle_id] : null;
  const selectedDeviceFeed = selectedDevice ? deviceFeeds[selectedDevice.dongle_id] : null;

  const selectedDeviceLastActive = deviceReadings.length
    ? new Date(Math.max(...deviceReadings.map((r) => new Date(r.received_at).getTime()))).toISOString()
    : null;

  const selectedTempTrend = chartTemperature.filter((r) => r.mac_address === activeMac);
  const selectedHumTrend = chartHumidity.filter((r) => r.mac_address === activeMac);

  return (
    <div className="remonet-layout">
      {/* Sidebar Navigation */}
      <Sidebar
        devices={devices}
        selectedDevice={selectedDevice}
        setSelectedDevice={setSelectedDevice}
        viewMode={viewMode}
        setViewMode={setViewMode}
        devicesExpanded={devicesExpanded}
        setDevicesExpanded={setDevicesExpanded}
        currentUser={currentUser}
        handleLogout={handleLogout}
      />

      {/* Main Content Area */}
      <main className="main-content">
        {viewMode === "dashboard" ? (
          <>
            <DashboardHeader
              selectedDevice={selectedDevice}
              setSelectedDevice={setSelectedDevice}
              alertSummary={alertSummary}
              setIsAlertDrawerOpen={setIsAlertDrawerOpen}
              linkDown={linkDown}
            />

            <FilterBar
              quickRange={quickRange}
              setQuickRange={(range) => {
                setQuickRange(range);
                const dates = rangeDates(range);
                setStartDate(dates.start);
                setEndDate(dates.end);
              }}
              startDate={startDate}
              setStartDate={(date) => { setStartDate(date); setQuickRange("Custom range"); }}
              endDate={endDate}
              setEndDate={(date) => { setEndDate(date); setQuickRange("Custom range"); }}
              onLoadData={() => {
                loadChartHistory();
                loadDeviceActivity();
                pollSensors();
              }}
              onSetInterval={() => {}}
            />

            {selectedDevice ? (
              <div className="dashboard-grid-layout">
                {/* Left Column: Device Info, Metrics, Heartbeat & Feed */}
                <div className="column-left">
                  <DeviceInfoPanel
                    selectedDevice={selectedDevice}
                    selectedDeviceLastActive={selectedDeviceLastActive}
                  />

                  <EnergyMetricsPanel deviceReadings={deviceReadings} />

                  <DeviceHeartbeatPanel selectedDeviceStatus={selectedDeviceStatus} />

                  <LiveFeedPanel selectedDeviceFeed={selectedDeviceFeed} />
                </div>

                {/* Right Column: Trend Graph */}
                <div className="column-right">
                  <div className="dashboard-card chart-card">
                    <TelemetryChart
                      temperature={selectedTempTrend}
                      humidity={selectedHumTrend}
                      loading={historyLoading}
                      error={historyError}
                    />
                  </div>
                  <DeviceActivityTimeline
                    temperature={selectedTempTrend}
                    humidity={selectedHumTrend}
                    alerts={activityAlerts}
                    range={quickRange}
                    startDate={startDate}
                    endDate={endDate}
                    loading={activityLoading}
                    error={activityError}
                  />
                </div>
              </div>
            ) : (
              <div className="empty-selection-placeholder">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                  <line x1="7" y1="2" x2="7" y2="22" />
                </svg>
                <p>Select a device from the sidebar to display real-time sensor metrics and analysis trend lines.</p>
              </div>
            )}

            {/* Footer Bar */}
            <footer className="main-footer-nav">
              <span className="footer-status">
                Showing Page 1 (Last {tempHistory.length + humHistory.length} points)
              </span>
              <div className="footer-pagination">
                <button className="btn-pagination" disabled>Previous</button>
                <button className="btn-pagination" disabled>Next</button>
              </div>
            </footer>
          </>
        ) : (
          <AdminPanel
            csvFile={csvFile}
            setCsvFile={setCsvFile}
            uploading={uploading}
            uploadResult={uploadResult}
            uploadErr={uploadErr}
            uploadCsv={uploadCsv}
            devices={devices}
            regLog={regLog}
            auditLogs={auditLogs}
            auditSummary={auditSummary}
            auditLoading={auditLoading}
            auditFilterAction={auditFilterAction}
            setAuditFilterAction={setAuditFilterAction}
            loadAuditLogs={loadAuditLogs}
          />
        )}
      </main>

      {/* Slide-over Incident & Alerts Center Drawer */}
      <AlertsDrawer
        isOpen={isAlertDrawerOpen}
        onClose={() => setIsAlertDrawerOpen(false)}
        alertSummary={alertSummary}
        alertFilter={alertFilter}
        setAlertFilter={setAlertFilter}
        alerts={alerts}
        acknowledgeAlert={acknowledgeAlert}
        resolveAlert={resolveAlert}
      />
    </div>
  );
}
