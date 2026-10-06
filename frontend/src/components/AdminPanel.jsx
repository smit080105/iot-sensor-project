import React, { useRef } from "react";
import { formatAuditDetails } from "../utils/formatters";

export default function AdminPanel({
  csvFile,
  setCsvFile,
  uploading,
  uploadResult,
  uploadErr,
  uploadCsv,
  devices,
  regLog,
  auditLogs,
  auditSummary,
  auditLoading,
  auditFilterAction,
  setAuditFilterAction,
  loadAuditLogs,
}) {
  const fileInputRef = useRef(null);

  return (
    <>
      <header className="main-header">
        <h1 className="header-title">ADMIN SETTINGS</h1>
      </header>

      <div className="admin-grid-layout">
        {/* CSV Upload Card */}
        <div className="dashboard-card">
          <h2 className="card-title">Upload Devices CSV</h2>
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
            <button
              type="button"
              onClick={uploadCsv}
              className="upload-action-btn"
              disabled={uploading}
            >
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
          <h2 className="card-title">Registered Devices</h2>
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
                    <td colSpan={3} className="empty-text">No registered devices. Upload a CSV above.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Handshake Attempts Log */}
        <div className="dashboard-card">
          <h2 className="card-title">Connection Handshakes</h2>
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

        {/* Activity Log Card */}
        <div className="dashboard-card audit-trail-card">
          <div className="audit-card-header">
            <div className="audit-header-info">
              <div className="audit-title-row">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="audit-header-icon">
                  <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                </svg>
                <h2 className="card-title" style={{ margin: 0 }}>System Activity Log</h2>
              </div>
              <p className="audit-subtitle">
                Activity log tracking logins, device updates, and alert events.
              </p>
            </div>

            <div className="audit-controls">
              <select
                className="filter-select audit-filter"
                value={auditFilterAction}
                onChange={(e) => setAuditFilterAction(e.target.value)}
              >
                <option value="">All Actions</option>
                <option value="USER_LOGIN">User Logins</option>
                <option value="USER_LOGIN_FAILED">Failed Logins</option>
                <option value="USER_LOGOUT">User Logouts</option>
                <option value="CSV_UPLOAD_SYNC">Device Syncs</option>
                <option value="ALERT_ACKNOWLEDGED">Alert Acknowledged</option>
                <option value="ALERT_RESOLVED">Alert Resolved</option>
              </select>
              <button
                type="button"
                className="btn-refresh-audit"
                onClick={loadAuditLogs}
                disabled={auditLoading}
                title="Refresh Logs"
              >
                {auditLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>

          {/* Audit KPI Stats Bar */}
          {auditSummary && (
            <div className="audit-kpi-bar">
              <div className="audit-kpi-item">
                <span className="kpi-label">Total Events</span>
                <span className="kpi-val">{auditSummary.total_events}</span>
              </div>
              <div className="audit-kpi-item">
                <span className="kpi-label">Logins (24h)</span>
                <span className="kpi-val highlight-green">{auditSummary.logins_24h}</span>
              </div>
              <div className="audit-kpi-item">
                <span className="kpi-label">Failed Logins (24h)</span>
                <span className={`kpi-val ${auditSummary.failed_logins_24h > 0 ? "highlight-red" : ""}`}>
                  {auditSummary.failed_logins_24h}
                </span>
              </div>
              <div className="audit-kpi-item">
                <span className="kpi-label">Device Syncs (24h)</span>
                <span className="kpi-val highlight-blue">{auditSummary.csv_syncs_24h}</span>
              </div>
            </div>
          )}

          {/* Audit Log Records Table */}
          <div className="table-container audit-table-container">
            <table>
              <thead>
                <tr>
                  <th style={{ width: "160px" }}>Timestamp</th>
                  <th style={{ width: "180px" }}>Action</th>
                  <th style={{ width: "140px" }}>Actor</th>
                  <th style={{ width: "140px" }}>IP Address</th>
                  <th style={{ width: "160px" }}>Target</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="audit-time-cell">
                      {new Date(log.created_at).toLocaleString(undefined, {
                        year: "numeric",
                        month: "short",
                        day: "2-digit",
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </td>
                    <td>
                      <span className={`audit-badge ${log.action.toLowerCase().replace(/_/g, "-")}`}>
                        {log.action}
                      </span>
                    </td>
                    <td>
                      <span className="audit-actor">{log.username || "System"}</span>
                    </td>
                    <td className="audit-ip-cell">
                      <code>{log.ip_address || "internal"}</code>
                    </td>
                    <td>
                      <span className="audit-resource">
                        {log.resource_type ? `${log.resource_type}${log.resource_id ? `:${log.resource_id}` : ""}` : "--"}
                      </span>
                    </td>
                    <td className="audit-details-cell">
                      {formatAuditDetails(log.details)}
                    </td>
                  </tr>
                ))}
                {auditLogs.length === 0 && (
                  <tr>
                    <td colSpan={6} className="empty-text">
                      {auditLoading ? "Loading audit records..." : "No audit records matching filter criteria."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  );
}
