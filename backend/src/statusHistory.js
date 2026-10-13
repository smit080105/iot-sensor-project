const pool = require("./db");

async function initDeviceStatusEventsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS device_status_events (
      id BIGSERIAL PRIMARY KEY,
      dongle_id VARCHAR(100) NOT NULL REFERENCES devices(dongle_id) ON DELETE CASCADE,
      mac_address VARCHAR(17) NOT NULL REFERENCES devices(mac_address) ON DELETE CASCADE,
      event_type VARCHAR(30) NOT NULL,
      previous_state VARCHAR(20),
      state VARCHAR(20),
      uptime_sec BIGINT,
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_device_status_events_device_time
      ON device_status_events (dongle_id, recorded_at DESC);
  `);

  // Seed one baseline from the current-state table for devices that existed
  // before status history was introduced. This is not presented as older history.
  await pool.query(`
    INSERT INTO device_status_events
      (dongle_id, mac_address, event_type, state, uptime_sec, recorded_at)
    SELECT ds.dongle_id, ds.mac_address, 'STATE_REPORTED', ds.state, ds.uptime_sec, ds.updated_at
    FROM device_status ds
    WHERE NOT EXISTS (
      SELECT 1 FROM device_status_events e WHERE e.dongle_id = ds.dongle_id
    )
  `);
}

async function recordDeviceStatusEvent({
  dongleId,
  macAddress,
  eventType,
  previousState = null,
  state = null,
  uptimeSec = null,
  recordedAt = null,
}) {
  await pool.query(
    `INSERT INTO device_status_events
       (dongle_id, mac_address, event_type, previous_state, state, uptime_sec, recorded_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7::timestamptz, now()))`,
    [dongleId, macAddress, eventType, previousState, state, uptimeSec, recordedAt]
  );
}

module.exports = { initDeviceStatusEventsTable, recordDeviceStatusEvent };
