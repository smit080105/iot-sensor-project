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

export const HIGH_TEMP_THRESHOLD = 28; // °C

const COLOR_TEMP = "#ef4444"; // Coral/Red
const COLOR_HUMIDITY = "#0ea5e9"; // Cyan/Blue
const COLOR_BG_TOOLTIP = "#ffffff";
const COLOR_BORDER_TOOLTIP = "#cbd5e1";

function fmtTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// Pair temp and humidity points bucketed to nearest 5s
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

const CustomTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="custom-chart-tooltip" style={{
        backgroundColor: COLOR_BG_TOOLTIP,
        border: `1px solid ${COLOR_BORDER_TOOLTIP}`,
        padding: "8px 12px",
        borderRadius: "6px",
        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.05)"
      }}>
        <p className="tooltip-time" style={{ margin: "0 0 4px 0", fontSize: "0.75rem", color: "#64748b", fontWeight: "600" }}>
          Time: {label}
        </p>
        {payload.map((item, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: "6px", margin: "2px 0" }}>
            <span style={{
              width: "8px",
              height: "8px",
              borderRadius: "50%",
              backgroundColor: item.color || item.stroke
            }} />
            <span style={{ fontSize: "0.8rem", color: "#334155", fontWeight: "500" }}>
              {item.name}: <strong style={{ color: "#0f172a" }}>{Number(item.value).toFixed(1)}{item.unit || ""}</strong>
            </span>
          </div>
        ))}
      </div>
    );
  }
  return null;
};

export default function TelemetryChart({ temperature, humidity }) {
  const [mode, setMode] = useState("correlation"); // default to correlation / common view

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
        <h3 className="chart-title">Sensor Trend</h3>
        <div className="chart-controls">
          <select 
            id="chart-mode" 
            value={mode} 
            onChange={(e) => setMode(e.target.value)}
            className="chart-select"
          >
            <option value="temperature">Temperature Line Only</option>
            <option value="humidity">Humidity Line Only</option>
            <option value="correlation">Common (Correlation)</option>
          </select>
        </div>
      </div>

      <div className="chart-container-box">
        {empty ? (
          <div className="chart-empty-state">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="empty-icon">
              <path d="M3 3v18h18" />
              <path d="M18.7 8l-5.1 5.2-2.8-2.7L7 14.3" />
            </svg>
            <p>No data points available for the selected range.</p>
          </div>
        ) : (
          <div style={{ width: "100%", height: "100%" }}>
            {mode === "temperature" && (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={tempSeries} margin={{ top: 15, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="timeLabel" stroke="#94a3b8" fontSize={11} minTickGap={40} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="°C" tickLine={false} />
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
                  <Line type="monotone" dataKey="value" name="Temperature" unit="°C" stroke={COLOR_TEMP} dot={false} strokeWidth={2} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}

            {mode === "humidity" && (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={humSeries} margin={{ top: 15, right: 10, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="timeLabel" stroke="#94a3b8" fontSize={11} minTickGap={40} tickLine={false} />
                  <YAxis stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="%" tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="value" name="Humidity" unit="%" stroke={COLOR_HUMIDITY} dot={false} strokeWidth={2} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            )}

            {mode === "correlation" && (
              <ResponsiveContainer width="100%" height={320}>
                <LineChart data={corrSeries} margin={{ top: 15, right: -15, left: -20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="timeLabel" stroke="#94a3b8" fontSize={11} minTickGap={40} tickLine={false} />
                  <YAxis yAxisId="left" stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="°C" tickLine={false} />
                  <YAxis yAxisId="right" orientation="right" stroke="#94a3b8" fontSize={11} domain={["auto", "auto"]} unit="%" tickLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend verticalAlign="top" height={36} iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.8rem", color: "#475569" }} />
                  <ReferenceLine yAxisId="left" y={HIGH_TEMP_THRESHOLD} stroke="#f43f5e" strokeDasharray="4 4" strokeWidth={1.5} />
                  <Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperature" unit="°C" stroke={COLOR_TEMP} dot={false} strokeWidth={2} connectNulls />
                  <Line yAxisId="right" type="monotone" dataKey="humidity" name="Humidity" unit="%" stroke={COLOR_HUMIDITY} dot={false} strokeWidth={2} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
