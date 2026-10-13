-- The CSV you upload IS the registry now — there is no separate pairing
-- table. A device becomes real the moment its row is in the most
-- recently uploaded CSV (mac_address, serial_number, product_type,
-- dongle_id). The MQTT handshake (remo_reg -> remo_regOK) just looks
-- a MAC up in this table and echoes the row back; it never invents new
-- serial_number/dongle_id values. See backend/src/mqtt.js and
-- backend/src/csvSync.js.
CREATE TABLE IF NOT EXISTS devices (
    id              SERIAL PRIMARY KEY,
    mac_address     VARCHAR(17) NOT NULL UNIQUE,
    serial_number   VARCHAR(100),
    product_type    VARCHAR(100),
    dongle_id       VARCHAR(100) UNIQUE,
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_devices_dongle_id ON devices (dongle_id);

-- sensor_readings.mac_address is a FOREIGN KEY into devices.mac_address —
-- this is what makes "unregistered MAC = data can't be stored" a real
-- database-level guarantee, not just an application check.
CREATE TABLE IF NOT EXISTS sensor_readings (
    id              SERIAL PRIMARY KEY,
    mac_address     VARCHAR(17) NOT NULL REFERENCES devices(mac_address) ON DELETE CASCADE,
    sensor_id       VARCHAR(100) NOT NULL,
    sensor_type     VARCHAR(50),
    value           NUMERIC NOT NULL,
    unit            VARCHAR(20),
    received_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_received_at ON sensor_readings (received_at DESC);
CREATE INDEX IF NOT EXISTS idx_sensor_readings_mac ON sensor_readings (mac_address);

-- One row per device, always overwritten in place ("upsert") with the
-- most recent device_remo/<dongle_id>/status message. We don't keep a
-- history of every status ping — just "what's the last thing we heard"
-- — since that's all the dashboard's online/offline badge needs.
CREATE TABLE IF NOT EXISTS device_status (
    dongle_id       VARCHAR(100) PRIMARY KEY REFERENCES devices(dongle_id) ON DELETE CASCADE,
    mac_address     VARCHAR(17) NOT NULL REFERENCES devices(mac_address) ON DELETE CASCADE,
    state           VARCHAR(20) NOT NULL,
    uptime_sec      BIGINT,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Append-only device status transitions and inactivity watchdog events.
CREATE TABLE IF NOT EXISTS device_status_events (
    id              BIGSERIAL PRIMARY KEY,
    dongle_id       VARCHAR(100) NOT NULL REFERENCES devices(dongle_id) ON DELETE CASCADE,
    mac_address     VARCHAR(17) NOT NULL REFERENCES devices(mac_address) ON DELETE CASCADE,
    event_type      VARCHAR(30) NOT NULL,
    previous_state  VARCHAR(20),
    state           VARCHAR(20),
    uptime_sec      BIGINT,
    recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_device_status_events_device_time
    ON device_status_events (dongle_id, recorded_at DESC);

-- One row per device holding the last device_remo/<dongle_id>/feed
-- payload verbatim as JSONB. The feed's shape is whatever she chooses to
-- publish on it, so we don't force it into fixed columns — we just keep
-- the latest blob and let the dashboard render whatever keys are in it.
CREATE TABLE IF NOT EXISTS device_feed (
    dongle_id       VARCHAR(100) PRIMARY KEY REFERENCES devices(dongle_id) ON DELETE CASCADE,
    mac_address     VARCHAR(17) NOT NULL REFERENCES devices(mac_address) ON DELETE CASCADE,
    data            JSONB NOT NULL,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Users table for Role-Based Access Control (RBAC)
CREATE TABLE IF NOT EXISTS users (
    id              SERIAL PRIMARY KEY,
    username        VARCHAR(50) NOT NULL UNIQUE,
    email           VARCHAR(255) NOT NULL UNIQUE,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(20) NOT NULL DEFAULT 'viewer',
    created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users (email);
CREATE INDEX IF NOT EXISTS idx_users_username ON users (username);

-- Alerts table
CREATE TABLE IF NOT EXISTS alerts (
    id              SERIAL PRIMARY KEY,
    dongle_id       VARCHAR(100) REFERENCES devices(dongle_id) ON DELETE CASCADE,
    mac_address     VARCHAR(17) REFERENCES devices(mac_address) ON DELETE CASCADE,
    alert_type      VARCHAR(50) NOT NULL,
    severity        VARCHAR(20) NOT NULL, -- 'WARNING' or 'CRITICAL'
    message         TEXT NOT NULL,
    reading_value   NUMERIC,
    unit            VARCHAR(20),
    status          VARCHAR(20) NOT NULL DEFAULT 'ACTIVE', -- 'ACTIVE', 'ACKNOWLEDGED', 'RESOLVED'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_dongle_id ON alerts (dongle_id);
CREATE INDEX IF NOT EXISTS idx_alerts_created_at ON alerts (created_at DESC);

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
    id              SERIAL PRIMARY KEY,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
    username        VARCHAR(100),
    action          VARCHAR(50) NOT NULL,
    resource_type   VARCHAR(50) NOT NULL,
    resource_id     VARCHAR(100),
    ip_address      VARCHAR(45),
    details         JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs (action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs (user_id);
