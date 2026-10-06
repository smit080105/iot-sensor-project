import React from "react";
import { timeAgo } from "../utils/formatters";

export default function AlertsDrawer({
  isOpen,
  onClose,
  alertSummary,
  alertFilter,
  setAlertFilter,
  alerts,
  acknowledgeAlert,
  resolveAlert,
}) {
  if (!isOpen) return null;

  return (
    <div className="alerts-drawer-overlay" onClick={onClose}>
      <div className="alerts-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="alerts-drawer-header">
          <div className="alerts-drawer-title-group">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="alert-drawer-icon">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            <h2 className="alerts-drawer-title">Alerts & Incidents</h2>
            {alertSummary.active_total > 0 && (
              <span className="alerts-count-pill">{alertSummary.active_total} Active</span>
            )}
          </div>
          <button className="btn-close-drawer" onClick={onClose} title="Close Drawer">
            ✕
          </button>
        </div>

        <div className="alerts-drawer-tabs">
          <button
            className={`alerts-tab ${alertFilter === "ACTIVE" ? "active" : ""}`}
            onClick={() => setAlertFilter("ACTIVE")}
          >
            Active Alarms ({alertSummary.active_total})
          </button>
          <button
            className={`alerts-tab ${alertFilter === "ALL" ? "active" : ""}`}
            onClick={() => setAlertFilter("ALL")}
          >
            All Incident History
          </button>
        </div>

        <div className="alerts-list">
          {alerts.length === 0 ? (
            <div className="alerts-empty-state">
              <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
              <h3>All Systems Operational</h3>
              <p>No active anomalies or disconnected sensors detected.</p>
            </div>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className={`alert-card ${a.severity.toLowerCase()} ${a.status.toLowerCase()}`}
              >
                <div className="alert-card-header">
                  <span className={`alert-severity-tag ${a.severity.toLowerCase()}`}>
                    {a.severity}
                  </span>
                  <span className="alert-device-tag">{a.dongle_id || a.mac_address}</span>
                  <span className="alert-time">{timeAgo(a.created_at)}</span>
                </div>

                <p className="alert-message">{a.message}</p>

                {a.reading_value !== null && a.reading_value !== undefined && (
                  <div className="alert-metric-badge">
                    Reading: <strong>{a.reading_value} {a.unit || ""}</strong>
                  </div>
                )}

                <div className="alert-card-footer">
                  <span className={`alert-status-badge ${a.status.toLowerCase()}`}>
                    Status: {a.status}
                  </span>
                  <div className="alert-actions">
                    {a.status === "ACTIVE" && (
                      <button
                        className="btn-alert-action ack"
                        onClick={() => acknowledgeAlert(a.id)}
                        title="Acknowledge alert"
                      >
                        Acknowledge
                      </button>
                    )}
                    {a.status !== "RESOLVED" && (
                      <button
                        className="btn-alert-action resolve"
                        onClick={() => resolveAlert(a.id)}
                        title="Mark as resolved"
                      >
                        Resolve
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
