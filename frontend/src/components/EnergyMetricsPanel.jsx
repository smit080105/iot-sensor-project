import React from "react";
import { timeAgo } from "../utils/formatters";

const STALE_AFTER_MS = 5 * 60 * 1000;

export default function EnergyMetricsPanel({ deviceReadings = [] }) {
  const getMetricVal = (type) => {
    const r = deviceReadings.find((s) => s.sensor_type === type);
    if (!r) return { value: "--", freshness: "unavailable", title: "No reading received" };
    const ageMs = r.received_at ? Date.now() - new Date(r.received_at).getTime() : Infinity;
    const stale = !Number.isFinite(ageMs) || ageMs > STALE_AFTER_MS;
    return {
      value: `${r.value} ${r.unit || ""}`.trim(),
      freshness: stale ? "stale" : "current",
      title: r.received_at ? `Updated ${timeAgo(r.received_at)}` : "Reading time unavailable",
    };
  };

  const metric = (type) => {
    const reading = getMetricVal(type);
    return (
      <span className={`info-val metric-value ${reading.freshness}`} title={reading.title}>
        {reading.value}
        {reading.freshness === "stale" && <small className="stale-label">stale</small>}
      </span>
    );
  };

  return (
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
          {metric("temperature")}
        </div>
        <div className="info-row">
          <span className="info-label">Humidity</span>
          {metric("humidity")}
        </div>
        <div className="info-row">
          <span className="info-label">Ambient Light</span>
          {metric("ambient_light")}
        </div>
        <div className="info-row">
          <span className="info-label">Accelerometer X</span>
          {metric("accel_x")}
        </div>
        <div className="info-row">
          <span className="info-label">Accelerometer Y</span>
          {metric("accel_y")}
        </div>
        <div className="info-row">
          <span className="info-label">Accelerometer Z</span>
          {metric("accel_z")}
        </div>
        <div className="info-row">
          <span className="info-label">Potentiometer 1</span>
          {metric("potentiometer_1")}
        </div>
        <div className="info-row">
          <span className="info-label">Potentiometer 2</span>
          {metric("potentiometer_2")}
        </div>
        <div className="info-row">
          <span className="info-label">Potentiometer 3</span>
          {metric("potentiometer_3")}
        </div>
        <div className="info-row">
          <span className="info-label">Potentiometer 4</span>
          {metric("potentiometer_4")}
        </div>
        <div className="info-row">
          <span className="info-label">Voltage</span>
          {metric("voltage")}
        </div>
        <div className="info-row">
          <span className="info-label">Current</span>
          {metric("current")}
        </div>
        <div className="info-row">
          <span className="info-label">Power</span>
          {metric("power")}
        </div>
        <div className="info-row">
          <span className="info-label">Frequency</span>
          {metric("frequency")}
        </div>
        <div className="info-row">
          <span className="info-label">PF</span>
          {metric("power_factor")}
        </div>
        <div className="info-row">
          <span className="info-label">Energy</span>
          {metric("energy")}
        </div>
      </div>
    </div>
  );
}
