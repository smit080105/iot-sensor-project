import React from "react";

export default function LiveFeedPanel({ selectedDeviceFeed }) {
  if (!selectedDeviceFeed) return null;

  return (
    <div className="dashboard-card">
      <h2 className="card-title">Live Feed</h2>
      <div className="card-content-list dotted-separators">
        {Object.entries(selectedDeviceFeed.data || {}).map(([key, value]) => (
          <div className="info-row" key={key}>
            <span className="info-label">{key}</span>
            <span className="info-val">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
