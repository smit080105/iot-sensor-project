const { parse } = require("csv-parse/sync");
const pool = require("./db");

/**
 * Sync the `devices` table to exactly match a CSV's content. The CSV is
 * now the registry directly — there's no separate "paired" gate. This is
 * where you decide a device's serial_number, product_type, and dongle_id;
 * the MQTT handshake (see mqtt.js) just reads this table back.
 *
 * Rules:
 *  - A row needs both mac_address and dongle_id to be considered.
 *    Anything missing either is rejected.
 *  - Any accepted MAC not already in the DB is ADDED.
 *  - Any MAC currently in the DB but no longer present in this CSV is
 *    DELETED (along with its historical readings, via ON DELETE CASCADE)
 *    — re-uploading a CSV with a row removed removes that device.
 *  - A MAC appearing more than once in the CSV is de-duplicated (last
 *    occurrence wins), so the dashboard never shows repeats.
 *
 * Returns a summary: { added: [], removed: [], rejected: [], total: n }
 */
async function syncDevicesFromCsvText(csvText) {
  const records = parse(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });

  const accepted = new Map(); // mac -> row
  const rejected = [];

  for (const row of records) {
    const mac = (row.mac_address || "").toUpperCase();
    const dongleId = (row.dongle_id || "").trim();
    if (!mac || !dongleId) {
      if (mac) rejected.push(mac);
      continue; // needs both a MAC and a dongle_id to be usable
    }
    accepted.set(mac, { ...row, mac_address: mac, dongle_id: dongleId }); // de-dupe: last occurrence wins
  }

  const client = await pool.connect();
  const added = [];
  const removed = [];

  try {
    await client.query("BEGIN");

    // Add / refresh every accepted device from the CSV
    for (const [mac, row] of accepted) {
      const result = await client.query(
        `INSERT INTO devices (mac_address, serial_number, product_type, dongle_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (mac_address) DO UPDATE
           SET serial_number = EXCLUDED.serial_number,
               product_type  = EXCLUDED.product_type,
               dongle_id     = EXCLUDED.dongle_id
         RETURNING (xmax = 0) AS inserted`,
        [mac, row.serial_number, row.product_type, row.dongle_id]
      );
      if (result.rows[0]?.inserted) {
        added.push(mac);
      }
    }

    // Remove any device no longer present in this CSV upload
    const acceptedMacs = Array.from(accepted.keys());
    const deleteResult = await client.query(
      acceptedMacs.length > 0
        ? `DELETE FROM devices WHERE mac_address <> ALL($1::varchar[]) RETURNING mac_address`
        : `DELETE FROM devices RETURNING mac_address`,
      acceptedMacs.length > 0 ? [acceptedMacs] : []
    );
    removed.push(...deleteResult.rows.map((r) => r.mac_address));

    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }

  const summary = {
    added,
    removed,
    rejected: [...new Set(rejected)],
    total: accepted.size,
  };

  console.log(
    `[csv-sync] ${summary.added.length} added, ${summary.removed.length} removed, ` +
      `${summary.rejected.length} rejected (missing mac_address/dongle_id), ${summary.total} device(s) now registered.`
  );

  return summary;
}

module.exports = { syncDevicesFromCsvText };
