/**
 * Relative time formatter for heartbeats, readings, and alerts
 */
export function timeAgo(iso) {
  if (!iso) return "No heartbeat";
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  return `${m}m ${s % 60}s ago`;
}

/**
 * Formats structured audit event details into readable summaries
 */
export function formatAuditDetails(details) {
  if (!details) return "--";
  if (typeof details === "string") return details;
  if (details.filename) {
    return `CSV: ${details.filename} (${details.added_count ?? (details.added ? details.added.length : 0)} added, ${details.removed_count ?? (details.removed ? details.removed.length : 0)} removed)`;
  }
  if (details.reason) {
    return `Reason: ${details.reason}`;
  }
  if (details.reading_value !== undefined) {
    return `${details.sensor_type || "reading"}: ${details.reading_value} ${details.unit || ""}`;
  }
  return JSON.stringify(details);
}
