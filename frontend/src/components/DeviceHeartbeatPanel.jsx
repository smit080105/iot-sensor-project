import React from "react";
import { timeAgo } from "../utils/formatters";

const OFFLINE_AFTER_MS = 5 * 60 * 1000;

export default function DeviceHeartbeatPanel({ selectedDeviceStatus }) {
  const updatedAt = selectedDeviceStatus?.updated_at;
  const ageMs = updatedAt ? Date.now() - new Date(updatedAt).getTime() : Infinity;
  const isFresh = Number.isFinite(ageMs) && ageMs <= OFFLINE_AFTER_MS;
  const isOnline = isFresh && /^(online|connected|running|active)$/i.test(selectedDeviceStatus?.state || "");
  const reportedState = selectedDeviceStatus?.state;
  const connectionLabel = !updatedAt
    ? "No heartbeat"
    : !isFresh
      ? "Offline - heartbeat stale"
      : isOnline
        ? "Online"
        : reportedState
          ? `Recently seen (${reportedState})`
          : "Recently seen - state unknown";
  const connectionClass = isOnline ? "online" : isFresh ? "recent" : "offline";
  return (
    <div className="dashboard-card">
      <h2 className="card-title">Device Heartbeat</h2>
      <div className={`device-connection-state ${connectionClass}`} role="status">{connectionLabel}</div>
      <div className="card-content-list">
        <div className="info-row">
          <span className="info-label">State</span>
          <span className="info-val">
            {selectedDeviceStatus?.state || "No status received yet"}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Uptime</span>
          <span className="info-val">
            {selectedDeviceStatus?.uptime_sec != null
              ? `${selectedDeviceStatus.uptime_sec}s`
              : "--"}
          </span>
        </div>
        <div className="info-row">
          <span className="info-label">Last Heartbeat</span>
          <span className="info-val">
            {selectedDeviceStatus
              ? timeAgo(selectedDeviceStatus.updated_at)
              : "No heartbeat"}
          </span>
        </div>
      </div>
    </div>
  );
}
