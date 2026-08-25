import React, { useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from "recharts";

export const HIGH_TEMP_THRESHOLD = 28; // °C — matches the alert banner in App.jsx

const COLOR_TEMP = "#ef4444"; // Vivid Red/Coral
const COLOR_HUMIDITY = "#06b6d4"; // Cyan/Ocean Blue
const COLOR_BG_TOOLTIP = "#0f172a";
const COLOR_BORDER_TOOLTIP = "#334155";

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Combine separate temperature/humidity point arrays into one series for
// the correlation view. Readings for the same telemetry message are
// inserted as separate rows a few milliseconds apart, so we bucket
// timestamps to the nearest 5 seconds to pair a temperature point with
// the humidity point that arrived alongside it.
function buildCorrelationSeries(temperature, humidity) {
  const bucket = (iso) => Math.floor(new Date(iso).getTime() / 5000) * 5000;
  const map = new Map();

  for (const p of temperature) {
    const key = bucket(p.received_at);
    const entry = map.get(key) || { time: key };
    entry.temperature = p.value;
    map.set(key, entry);
  }
  for (const p of humidity) {
    const key = bucket(p.received_at);
    const entry = map.get(key) || { time: key };
    entry.humidity = p.value;
    map.set(key, entry);
  }

  return Array.from(map.values())
    .sort((a, b) => a.time - b.time)
    .map((e) => ({ ...e, timeLabel: fmtTime(new Date(e.time).toISOString()) }));
}

// Custom tooltip renderer for a cleaner, professional dark-mode design
const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-chart-tooltip" style={{
        backgroundColor: COLOR_BG_TOOLTIP,
        border: `1px solid ${COLOR_BORDER_TOOLTIP}`,
        padding: "10px 14px",
        borderRadius: "8px",
        boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.3)"
      }}>
        <p className="tooltip-time" style={{ margin: "0 0 6px 0", fontSize: "0.75rem", color: "#94a3b8", fontWeight: "600" }}>
          Time: {label}
        </p>
        {payload.map((item, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "8px", margin: "4px 0" }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: item.color || item.stroke
            }} />
            <span style={{ fontSize: "0.85rem", color: "#f1f5f9", fontWeight: "500" }}>
              {item.name}: <strong style={{ color: "#ffffff" }}>{Number(item.value).toFixed(1)}{item.unit || ""}</strong>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function TelemetryChart({ temperature, humidity }) {
  const [mode, setMode] = useState("temperature"); // temperature | humidity | correlation

  const tempSeries = useMemo(
    () => temperature.map((p) => ({ timeLabel: fmtTime(p.received_at), value: Number(p.value) })),
    [temperature]
  );
  const humSeries = useMemo(
    () => humidity.map((p) => ({ timeLabel: fmtTime(p.received_at), value: Number(p.value) })),
    [humidity]
  );
  const corrSeries = useMemo(() => buildCorrelationSeries(temperature, humidity), [temperature, humidity]);

  const empty =
    (mode === "temperature" && tempSeries.length === 0) ||
    (mode === "humidity" && humSeries.length === 0) ||
    (mode === "correlation" && corrSeries.length === 0);

  return (
    <div className="chart-block">
      <div className="chart-header">
        <div className="chart-title-group">
          <h3 className="chart-title">
            {mode === "temperature" && "Temperature Analysis Trend"}
            {mode === "humidity" && "Humidity Analysis Trend"}
            {mode === "correlation" && "Environmental Correlation Analysis"}
          </h3>
          <p className="chart-subtitle">
            {mode === "temperature" && "Real-time temperature telemetry monitored across active registered nodes"}
            {mode === "humidity" && "Real-time relative humidity metrics monitored across active registered nodes"}
            {mode === "correlation" && "Comparative dual-axis trend mapping temperature against humidity"}
          </p>
        </div>
        <div className="chart-controls">
          <label htmlFor="chart-mode" className="chart-label">Telemetry Metrics View</label>
          <select 
            id="chart-mode" 
            value={mode} 
            onChange={(e) => setMode(e.target.value)}
            className="chart-select"
          >
            <option value="temperature">1. Temperature Line Only</option>
            <option value="humidity">2. Humidity Line Only</option>
            <option value="correlation">3. Temperature & Humidity Correlation</option>
          </select>
        </div>
      </div>

      <div className="chart-container-box">
        {empty && (
          <div className="chart-empty-state">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="empty-icon">
              <path d="M3 3v18h18" />
              <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
            </svg>
            <p>Awaiting incoming sensor telemetry payload data...</p>
          </div>
        )}

        {!empty && mode === "temperature" && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={tempSeries} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="timeLabel" stroke="#94a3b8" fontSize={11} minTickGap={40} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="°C" tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine
                y={HIGH_TEMP_THRESHOLD}
                stroke="#f43f5e"
                strokeDasharray="4 4"
                strokeWidth={1.5}
                label={{ 
                  value: `High Limit (${HIGH_TEMP_THRESHOLD}°C)`, 
                  fill: "#f43f5e", 
                  fontSize: 10, 
                  position: "insideBottomRight",
                  fontWeight: "600",
                  offset: 10
                }}
              />
              <Line type="monotone" dataKey="value" name="Temperature" unit="°C" stroke={COLOR_TEMP} dot={false} strokeWidth={2.5} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {!empty && mode === "humidity" && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={humSeries} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="timeLabel" stroke="#94a3b8" fontSize={11} minTickGap={40} tickLine={false} axisLine={false} />
              <YAxis stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="%" tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="value" name="Humidity" unit="%" stroke={COLOR_HUMIDITY} dot={false} strokeWidth={2.5} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        )}

        {!empty && mode === "correlation" && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={corrSeries} margin={{ top: 10, right: 5, left: -10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" opacity={0.3} />
              <XAxis dataKey="timeLabel" stroke="#94a3b8" fontSize={11} minTickGap={40} tickLine={false} axisLine={false} />
              <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="°C" tickLine={false} axisLine={false} />
              <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="%" tickLine={false} axisLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.8rem", color: "#cbd5e1" }} />
              <ReferenceLine yAxisId="left" y={HIGH_TEMP_THRESHOLD} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth={1.5} />
              <Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperature" unit="°C" stroke={COLOR_TEMP} dot={false} strokeWidth={2.5} connectNulls />
              <Line yAxisId="right" type="monotone" dataKey="humidity" name="Humidity" unit="%" stroke={COLOR_HUMIDITY} dot={false} strokeWidth={2.5} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
