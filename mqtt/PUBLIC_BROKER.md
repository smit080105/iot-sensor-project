# Public MQTT broker (test only)

The shared EMQX broker is suitable only for non-production connectivity smoke tests.
TLS protects each connection in transit but does not make topic data private from
other clients using the same broker. Do not publish real device data or secrets.

For a deliberate non-production test, configure:

```env
MQTT_URL=mqtts://broker.emqx.io:8883
MQTT_BROKER_MODE=public-test
MQTT_AUTH_MODE=none
PAIRING_TOKEN=<long-random-secret>
```

Production refuses `MQTT_BROKER_MODE=public-test`. The private broker's
certificate-based per-device ACLs apply only to the bundled Mosquitto deployment.

The current registration topics are scoped by device ID:

- Request: `device_remo/<dongle_id>/register`
- Reply: `device_remo/<dongle_id>/register_ack`
- Telemetry, heartbeat, and feed: `device_remo/<dongle_id>/<kind>`

The backend still checks the pairing token and verifies that the certificate
identity/topic device ID maps to the submitted MAC address in the registry.
For production, use the private broker and follow
[`SECURE_DEPLOYMENT.md`](SECURE_DEPLOYMENT.md).
