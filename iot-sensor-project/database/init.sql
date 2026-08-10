-- The CSV you upload IS the registry now — there is no separate pairing
-- table. A device becomes real the moment its row is in the most
-- recently uploaded CSV (mac_address, serial_number, product_type,
-- dongle_id). The MQTT handshake (DEVICE_reg -> DEVICE_regok) just looks
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
