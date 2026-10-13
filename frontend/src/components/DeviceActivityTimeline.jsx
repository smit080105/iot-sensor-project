import React, { useMemo } from "react";

function formatDateTime(value) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(milliseconds) {
  const minutes = Math.round(milliseconds / 60000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (hours < 48) return remainingMinutes ? `${hours} hr ${remainingMinutes} min` : `${hours} hr`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours ? `${days} d ${remainingHours} hr` : `${days} d`;
}

function gapThreshold(range, startDate, endDate) {
  if (range === "Last 24 hrs") return 5 * 60 * 1000;
  if (range === "Last 7 days") return 15 * 60 * 1000;
  if (range === "Last 30 days") return 2 * 60 * 60 * 1000;
  const days = (new Date(`${endDate}T00:00:00`) - new Date(`${startDate}T00:00:00`)) / 86400000;
  return days >= 7 ? 2 * 60 * 60 * 1000 : days >= 1 ? 15 * 60 * 1000 : 5 * 60 * 1000;
}

export default function DeviceActivityTimeline({
  temperature,
  humidity,
  alerts,
  statusEvents = [],
  range,
  startDate,
  endDate,
  loading,
  error,
}) {
  const events = useMemo(() => {
    const pointsByTime = new Map();
    for (const reading of [...temperature, ...humidity]) {
      const time = new Date(reading.received_at).getTime();
      if (!Number.isFinite(time)) continue;
      pointsByTime.set(time, true);
    }
    const times = [...pointsByTime.keys()].sort((a, b) => a - b);
    const generated = [];

    if (times.length) {
      generated.push({ type: "reading", at: times[0], title: "First sensor reading in range" });
      if (times.length > 1) generated.push({ type: "reading", at: times[times.length - 1], title: "Most recent sensor reading" });

      const threshold = gapThreshold(range, startDate, endDate);
      const explicitOfflineTimes = statusEvents
        .filter((event) => event.event_type === "OFFLINE")
        .map((event) => new Date(event.recorded_at).getTime())
        .filter(Number.isFinite);
      const explicitRecoveryTimes = statusEvents
        .filter((event) => event.event_type === "RECOVERED")
        .map((event) => new Date(event.recorded_at).getTime())
        .filter(Number.isFinite);
      for (let index = 1; index < times.length; index += 1) {
        const gap = times[index] - times[index - 1];
        if (gap > threshold) {
          const hasRecordedOffline = explicitOfflineTimes.some((at) => at >= times[index - 1] && at <= times[index]);
          const hasRecordedRecovery = explicitRecoveryTimes.some((at) => at >= times[index - 1] && at <= times[index]);
          if (!hasRecordedOffline) generated.push({
            type: "gap",
            at: times[index - 1] + threshold,
            title: `Telemetry gap: ${formatDuration(gap - threshold)}`,
            detail: "Inferred from a gap between recorded readings",
          });
          if (!hasRecordedRecovery) generated.push({ type: "resume", at: times[index], title: "Sensor readings resumed" });
        }
      }

      const periodIncludesToday = range !== "Custom range" || endDate >= new Date().toISOString().slice(0, 10);
      const currentSilence = Date.now() - times[times.length - 1];
      const latestOffline = explicitOfflineTimes.filter((at) => at >= times[times.length - 1]).sort((a, b) => b - a)[0];
      const recoveredAfterLatestOffline = latestOffline && explicitRecoveryTimes.some((at) => at > latestOffline);
      if (periodIncludesToday && currentSilence > threshold && !latestOffline && !recoveredAfterLatestOffline) {
        generated.push({
          type: "gap",
          at: times[times.length - 1] + threshold,
          title: `No recent sensor readings for ${formatDuration(currentSilence - threshold)}`,
          detail: "Estimated from the last stored reading; check the heartbeat for device connectivity.",
        });
      }
    }

    for (const alert of alerts) {
      generated.push({
        type: "alert",
        at: new Date(alert.created_at).getTime(),
        title: `${alert.severity} alert: ${alert.alert_type}`,
        detail: alert.message,
      });
      if (alert.resolved_at) {
        generated.push({
          type: "resolved",
          at: new Date(alert.resolved_at).getTime(),
          title: `Alert resolved: ${alert.alert_type}`,
          detail: alert.message,
        });
      }
    }

    for (const statusEvent of statusEvents) {
      const at = new Date(statusEvent.recorded_at).getTime();
      const state = statusEvent.state || "unknown";
      const event = {
        STATE_REPORTED: { type: "status", title: `Device state reported: ${state}`, detail: "State received from device heartbeat." },
        STATE_CHANGED: { type: "status", title: `Device state changed: ${statusEvent.previous_state || "unknown"} → ${state}`, detail: "State transition received from device heartbeat." },
        OFFLINE: { type: "offline", title: "Device marked offline after inactivity timeout", detail: "Recorded by the backend watchdog after the device stopped sending signals." },
        RECOVERED: { type: "resume", title: "Device activity resumed", detail: "Recorded when a new device signal cleared the inactivity timeout." },
      }[statusEvent.event_type];
      if (event) generated.push({ ...event, at });
    }

    return generated
      .filter((event) => Number.isFinite(event.at))
      .sort((a, b) => b.at - a.at)
      .slice(0, 30);
  }, [temperature, humidity, alerts, statusEvents, range, startDate, endDate]);

  return (
    <section className="dashboard-card device-activity-card" aria-labelledby="device-activity-title">
      <div className="device-activity-header">
        <div>
          <h2 className="card-title" id="device-activity-title">Device Activity</h2>
          <p className="device-activity-caption">Recorded device states, watchdog events, alerts, and sensor activity</p>
        </div>
        <span className="device-activity-count">{events.length} events</span>
      </div>

      {loading ? (
        <p className="device-activity-empty" role="status">Loading device activity...</p>
      ) : error ? (
        <p className="device-activity-error" role="alert">Could not load complete device activity: {error}</p>
      ) : events.length === 0 ? (
        <p className="device-activity-empty">No device events or sensor readings were recorded for this period.</p>
      ) : (
        <ol className="device-activity-list">
          {events.map((event, index) => (
            <li className={`device-activity-item ${event.type}`} key={`${event.type}-${event.at}-${index}`}>
              <span className="device-activity-marker" aria-hidden="true" />
              <div className="device-activity-content">
                <div className="device-activity-event-title">{event.title}</div>
                {event.detail && <p className="device-activity-detail">{event.detail}</p>}
                <time className="device-activity-time" dateTime={new Date(event.at).toISOString()}>
                  {formatDateTime(event.at)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="device-activity-footnote">Offline and recovery events are recorded by the backend watchdog. Other reading gaps are estimates and do not confirm an outage.</p>
    </section>
  );
}
