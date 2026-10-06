import React from "react";

export default function FilterBar({
  quickRange,
  setQuickRange,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
  onLoadData,
  onSetInterval,
}) {
  return (
    <div className="filter-bar">
      <div className="filter-group">
        <label className="filter-label">Quick Range</label>
        <select
          className="filter-select"
          value={quickRange}
          onChange={(e) => setQuickRange(e.target.value)}
        >
          <option>Last 24 hrs</option>
          <option>Last 7 days</option>
          <option>Last 30 days</option>
          <option>Custom range</option>
        </select>
      </div>

      <div className="filter-group">
        <label className="filter-label">Start Date</label>
        <div className="date-input-wrapper">
          <input
            type="date"
            className="filter-input"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <svg className="calendar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      </div>

      <div className="filter-group">
        <label className="filter-label">End Date</label>
        <div className="date-input-wrapper">
          <input
            type="date"
            className="filter-input"
            value={endDate}
            min={startDate}
            onChange={(e) => setEndDate(e.target.value)}
          />
          <svg className="calendar-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        </div>
      </div>

      <button className="btn-load-data" onClick={onLoadData}>
        Load Data
      </button>
      <button className="btn-set-interval" onClick={onSetInterval}>
        Set Interval
      </button>
    </div>
  );
}
