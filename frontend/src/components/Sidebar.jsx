import React from "react";

export default function Sidebar({
  devices,
  selectedDevice,
  setSelectedDevice,
  viewMode,
  setViewMode,
  devicesExpanded,
  setDevicesExpanded,
  currentUser,
  handleLogout,
}) {
  return (
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
          onClick={() => {
            setViewMode("dashboard");
            setSelectedDevice(devices[0] || null);
          }}
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
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>

          {devicesExpanded && (
            <div className="nav-sub-list">
              {devices.map((d) => {
                const isActive =
                  viewMode === "dashboard" && selectedDevice?.mac_address === d.mac_address;
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

        {/* Admin features only rendered for Admin role */}
        {currentUser?.role === "admin" && (
          <button
            className={`nav-item ${viewMode === "admin" ? "active" : ""}`}
            onClick={() => setViewMode("admin")}
            style={{ marginTop: "1rem" }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="nav-icon">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Device Registry
          </button>
        )}
      </nav>

      {/* User Session Profile & Sign Out */}
      <div className="sidebar-user-card">
        <div className="sidebar-user-avatar">
          {currentUser?.username ? currentUser.username.charAt(0).toUpperCase() : "U"}
        </div>
        <div className="sidebar-user-info">
          <span className="sidebar-user-name" title={currentUser?.email || currentUser?.username}>
            {currentUser?.username || "User"}
          </span>
          <span className={`sidebar-user-badge ${currentUser?.role || "viewer"}`}>
            {currentUser?.role || "viewer"}
          </span>
        </div>
        <button className="sidebar-btn-logout" onClick={handleLogout} title="Sign Out">
          Sign Out
        </button>
      </div>
    </aside>
  );
}
