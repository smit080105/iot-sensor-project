import React from "react";
import { timeAgo } from "../utils/formatters";

export default function DeviceInfoPanel({ selectedDevice, selectedDeviceLastActive }) {
  if (!selectedDevice) return null;

  return (
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
          <span className="info-val">
            {selectedDeviceLastActive ? timeAgo(selectedDeviceLastActive) : "No heartbeat"}
          </span>
        </div>
      </div>
    </div>
  );
}
