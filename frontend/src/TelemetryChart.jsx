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
      <div className="chart-controls">
        <label htmlFor="chart-mode" className="dim">VIEW</label>
        <select id="chart-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
          <option value="temperature">Temperature only</option>
          <option value="humidity">Humidity only</option>
          <option value="correlation">Temperature vs Humidity (correlation)</option>
        </select>
      </div>

      {empty && <p className="dim">not enough data yet to plot — waiting for readings</p>}

      {!empty && mode === "temperature" && (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={tempSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d34" />
            <XAxis dataKey="timeLabel" stroke="#6b7280" fontSize={11} minTickGap={30} />
            <YAxis stroke="#6b7280" fontSize={11} domain={["auto", "auto"]} unit="°C" />
            <Tooltip contentStyle={{ background: "#171a21", border: "1px solid #2a2d34" }} />
            <ReferenceLine
              y={HIGH_TEMP_THRESHOLD}
              stroke="#f87171"
              strokeDasharray="4 4"
              label={{ value: "28°C high limit", fill: "#f87171", fontSize: 11, position: "insideTopRight" }}
            />
            <Line type="monotone" dataKey="value" name="Temperature (°C)" stroke="#60a5fa" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}

      {!empty && mode === "humidity" && (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={humSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d34" />
            <XAxis dataKey="timeLabel" stroke="#6b7280" fontSize={11} minTickGap={30} />
            <YAxis stroke="#6b7280" fontSize={11} domain={["auto", "auto"]} unit="%" />
            <Tooltip contentStyle={{ background: "#171a21", border: "1px solid #2a2d34" }} />
            <Line type="monotone" dataKey="value" name="Humidity (%)" stroke="#34d399" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}

      {!empty && mode === "correlation" && (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={corrSeries}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2d34" />
            <XAxis dataKey="timeLabel" stroke="#6b7280" fontSize={11} minTickGap={30} />
            <YAxis yAxisId="left" stroke="#60a5fa" fontSize={11} domain={["auto", "auto"]} unit="°C" />
            <YAxis yAxisId="right" orientation="right" stroke="#34d399" fontSize={11} domain={["auto", "auto"]} unit="%" />
            <Tooltip contentStyle={{ background: "#171a21", border: "1px solid #2a2d34" }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine yAxisId="left" y={HIGH_TEMP_THRESHOLD} stroke="#f87171" strokeDasharray="4 4" />
            <Line yAxisId="left" type="monotone" dataKey="temperature" name="Temperature (°C)" stroke="#60a5fa" dot={false} strokeWidth={2} connectNulls />
            <Line yAxisId="right" type="monotone" dataKey="humidity" name="Humidity (%)" stroke="#34d399" dot={false} strokeWidth={2} connectNulls />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
