import { useState, useEffect, useRef, useCallback } from "react";

const HISTORY_CAP = 200;

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

/**
 * Custom hook managing WebSocket connection lifecycle and real-time telemetry dispatching
 */
export function useIoTWebSocket({ apiBase, authToken }) {
  const [wsStatus, setWsStatus] = useState("connecting");
  const [connErr, setConnErr] = useState(null);

  const [feed, setFeed] = useState([]);
  const [latest, setLatest] = useState([]);
  const [regLog, setRegLog] = useState([]);
  const [deviceStatuses, setDeviceStatuses] = useState({});
  const [deviceFeeds, setDeviceFeeds] = useState({});

  const [tempHistory, setTempHistory] = useState([]);
  const [humHistory, setHumHistory] = useState([]);

  const [alerts, setAlerts] = useState([]);
  const [alertSummary, setAlertSummary] = useState({
    active_total: 0,
    critical: 0,
    warning: 0,
    acknowledged: 0,
  });

  const appendHistory = useCallback((rows) => {
    const temps = rows.filter((r) => r.sensor_type === "temperature");
    const hums = rows.filter((r) => r.sensor_type === "humidity");
    if (temps.length) setTempHistory((prev) => [...prev, ...temps].slice(-HISTORY_CAP));
    if (hums.length) setHumHistory((prev) => [...prev, ...hums].slice(-HISTORY_CAP));
  }, []);

  const wsRef = useRef(null);

  useEffect(() => {
    if (!authToken) return;
    let reconnectTimer;
    let cancelled = false;

    function connect() {
      const wsUrl = `${apiBase.replace(/^http/, "ws")}/?token=${encodeURIComponent(authToken)}`;
      const ws = new WebSocket(wsUrl);
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

          if (msg.type === "device-status") {
            setDeviceStatuses((prev) => ({ ...prev, [msg.data.dongle_id]: msg.data }));
          }

          if (msg.type === "device-feed") {
            setDeviceFeeds((prev) => ({ ...prev, [msg.data.dongle_id]: msg.data }));
          }

          if (msg.type === "new-alert") {
            setAlerts((prev) => [msg.data, ...prev.filter((a) => a.id !== msg.data.id)]);
            setAlertSummary((prev) => ({
              ...prev,
              active_total: prev.active_total + 1,
              critical: msg.data.severity === "CRITICAL" ? prev.critical + 1 : prev.critical,
              warning: msg.data.severity === "WARNING" ? prev.warning + 1 : prev.warning,
            }));
          }

          if (msg.type === "alert-resolved") {
            setAlerts((prev) =>
              prev.map((a) =>
                a.id === msg.data.id
                  ? { ...a, status: "RESOLVED", resolved_at: msg.data.resolved_at }
                  : a
              )
            );
            setAlertSummary((prev) => ({
              ...prev,
              active_total: Math.max(0, prev.active_total - 1),
              critical:
                msg.data.severity === "CRITICAL"
                  ? Math.max(0, prev.critical - 1)
                  : prev.critical,
              warning:
                msg.data.severity === "WARNING"
                  ? Math.max(0, prev.warning - 1)
                  : prev.warning,
            }));
          }

          if (msg.type === "alert-acknowledged") {
            setAlerts((prev) =>
              prev.map((a) => (a.id === msg.data.id ? { ...a, status: "ACKNOWLEDGED" } : a))
            );
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
  }, [authToken, apiBase, appendHistory]);

  return {
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
  };
}
