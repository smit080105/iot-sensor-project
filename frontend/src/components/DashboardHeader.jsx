import React from "react";

export default function DashboardHeader({
  selectedDevice,
  setSelectedDevice,
  alertSummary,
  setIsAlertDrawerOpen,
  linkDown,
}) {
  return (
    <header className="main-header">
      <div className="header-title-row">
        <button className="back-btn" onClick={() => setSelectedDevice(null)} title="Back to Overview">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <h1 className="header-title">
          {selectedDevice
            ? (selectedDevice.dongle_id || selectedDevice.product_type).toUpperCase()
            : "DASHBOARD"}
        </h1>
      </div>

      <div className="header-status">
        {/* Alert Notification Bell Button */}
        <button
          className={`btn-alert-bell ${
            alertSummary.critical > 0
              ? "critical-alarm"
              : alertSummary.active_total > 0
              ? "warning-alarm"
              : ""
          }`}
          onClick={() => setIsAlertDrawerOpen(true)}
          title="Open Incident & Alert Center"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          </svg>
          {alertSummary.active_total > 0 && (
            <span
              className={`alert-badge-count ${
                alertSummary.critical > 0 ? "critical" : "warning"
              }`}
            >
              {alertSummary.active_total}
            </span>
          )}
        </button>

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
  );
}
