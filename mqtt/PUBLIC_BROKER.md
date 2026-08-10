# MQTT setup — device registration over a public broker

Devices are registered by uploading `devices.csv` — that CSV **is** the
registry. The MQTT handshake below just confirms a MAC is in that
registry and echoes its row back. There are two people involved:
**you** (this backend) and **her** (a separate device/script that
publishes readings).

## Broker

Both sides must connect to the same broker:

| Setting | Value |
|---|---|
| Broker (plaintext) | `mqtt://broker.emqx.io:1883` |
| Broker (TLS)        | `mqtts://broker.emqx.io:8883` |

Set via `MQTT_URL` in `docker/.env` (or `backend/.env` for local runs).

**Note:** this is a genuinely public broker — anyone can publish or
subscribe to any topic on it, with no authentication at the broker level.
The topic names below are fixed (to match her existing script) rather
than scoped with a random prefix, so the `PAIRING_TOKEN` check in step 1
is the real protection against a stranger on the broker pretending to be
her device. Don't publish anything sensitive through this broker.

## Topic names — case-sensitive

MQTT topics are exact strings. A mismatch here means messages vanish
with no error on either side. Confirmed topic names:

| Purpose | Topic |
|---|---|
| Registration request (her → backend) | `DEVICE_reg` |
| Registration reply (backend → her) | `DEVICE_regok` |
| Telemetry (her → backend) | `device_scd/<dongle_id>/telemetry` |
| Telemetry acknowledgement (backend → her) | `device_scd/<dongle_id>/ack` |

## The flow, step by step

**1. You upload devices.csv first.** Add a row with `mac_address`,
`serial_number`, `product_type`, `dongle_id` and upload it through the
dashboard. This is what makes step 3 succeed.

**2. She publishes `DEVICE_reg`:**
```json
{ "mac_address": "74:4D:BD:AA:C0:F0", "token": "Shalaka" }
```
The backend subscribes to this topic. Every message received is logged
(`docker logs backend`, and the **DEVICE_reg ATTEMPTS** panel on the
dashboard — pushed there live over WebSocket) with the raw payload. If
`token` doesn't exactly match `PAIRING_TOKEN`, it's marked "invalid
token" and no reply is sent.

**3. Backend looks the MAC up in the CSV-backed `devices` table.**
- Not found → logged as "not in CSV registry", no reply sent.
- Found → backend publishes `DEVICE_regok` with that exact row:
  ```json
  {
    "mac_address": "74:4D:BD:AA:C0:F0",
    "serial_number": "SN0001",
    "dongle_id": "DGL0001",
    "product_type": "AHT10"
  }
  ```

**4. She compares MACs.** On her side, she checks the `mac_address` in
`DEVICE_regok` matches what she sent in `DEVICE_reg`, confirming it's
really us replying.

**5. She publishes telemetry** to a topic scoped by the `dongle_id` from
step 3:
```
device_scd/DGL0001/telemetry
```
```json
{
  "message_id": "2FB9:00000003",
  "temperature": 26.4,
  "humidity": 55.1,
  "Ax": 0.01, "Ay": -0.02, "Az": 0.98,
  "Gx": 0.0,  "Gy": 0.0,   "Gz": 0.0
}
```
The backend subscribes to `device_scd/+/telemetry`, looks up which MAC
that `dongle_id` belongs to, and stores **every field it recognizes**:
`temperature`, `humidity`, `Ax`/`Ay`/`Az` (accelerometer), and
`Gx`/`Gy`/`Gz` (gyroscope). Fields you don't send are simply skipped —
you don't need to send all of them every message.

**6. Backend always replies with an ACK**, on
`device_scd/DGL0001/ack`:
```json
{
  "dongle_id": "DGL0001",
  "message_id": "2FB9:00000003",
  "received": true,
  "timestamp": "2026-08-05T06:39:19.130Z"
}
```
`received` is `false` (with a `details` field explaining why) if:
- the `dongle_id` isn't in the registry, or
- the payload contained none of the recognized fields above.

**7. Every stored reading is also pushed live to the dashboard** over
WebSocket the instant it's written to the database — that's what makes
the **LIVE SENSORS** and **RAW FEED** panels update instantly instead of
waiting for the next poll.

## Where to see incoming data live

- **Dashboard → DEVICE_reg ATTEMPTS panel**: every `DEVICE_reg` message
  received, with mac, token, and outcome — pushed live over WebSocket.
- **Dashboard → LIVE SENSORS / RAW FEED panels**: every stored reading,
  pushed live over WebSocket the moment it's saved.
- **`docker logs backend`**: everything above, plus the full raw JSON
  payload as it arrived on the wire, and every ACK published.

## Re-registering

If you change a device's row in the CSV (e.g. assign it a new
`dongle_id`) and re-upload, the next `DEVICE_reg` for that MAC will echo
the new row. Any telemetry using the old `dongle_id` will get an ACK
with `received: false` once it's no longer in the registry.
