// The `devices` table (populated by uploading devices.csv, see csvSync.js)
// IS the registry. There is no separate pairing table anymore — the MQTT
// handshake just reads/echoes rows from here, it never invents data.
const pool = require("./db");

// Used by DEVICE_reg: look up a device by MAC so we can echo its real
// serial_number/dongle_id/product_type back on DEVICE_regok.
async function getDeviceByMac(mac) {
  const result = await pool.query(
    "SELECT mac_address, serial_number, product_type, dongle_id FROM devices WHERE mac_address = $1",
    [mac]
  );
  return result.rows[0] || null;
}

// Used by telemetry ingestion: the topic only carries dongle_id, so we
// need to find which MAC (and therefore which device) it belongs to.
async function getMacByDongleId(dongleId) {
  const result = await pool.query(
    "SELECT mac_address FROM devices WHERE dongle_id = $1",
    [dongleId]
  );
  return result.rows[0]?.mac_address || null;
}

module.exports = { getDeviceByMac, getMacByDongleId };
