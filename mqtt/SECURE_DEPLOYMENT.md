# Secure MQTT deployment

For real deployments, set up a private MQTT broker and use TLS with a unique
client identity for the backend. The bundled Mosquitto configuration requires
mutual TLS and topic ACLs. Protect private keys and credentials with a secret
manager or deployment secrets; never commit them.

Configure the backend with:

```env
MQTT_URL=mqtts://your-private-broker:8883
MQTT_BROKER_MODE=private
MQTT_AUTH_MODE=mtls
MQTT_CA_CERT_PATH=/path/to/ca.crt
MQTT_CLIENT_CERT_PATH=/path/to/backend-service.crt
MQTT_CLIENT_KEY_PATH=/path/to/backend-service.key
PAIRING_TOKEN=<long-random-secret>
```

The broker must validate the backend certificate and enforce ACLs for the
required registration, telemetry, status, feed, and acknowledgement topics.
Issue separate client certificates and topic permissions to each device where
the firmware supports them. Rotate certificates and the pairing token when a
device or operator credential is exposed.

For a private managed broker that authenticates with a username and password,
use `MQTT_AUTH_MODE=password`, keep `MQTT_URL` on `mqtts://`, and inject
`MQTT_USERNAME` and `MQTT_PASSWORD` through the secret store. Do not include
credentials in the broker URL.

The shared EMQX public broker is for non-production smoke tests only. It
requires all of `MQTT_BROKER_MODE=public-test`, `MQTT_AUTH_MODE=none`, and an
explicit broker URL; the backend refuses this mode when `NODE_ENV=production`.
TLS protects the network connection but does not make shared broker topics
private. Do not publish real device data or secrets there.

The backend requires an explicit `MQTT_URL`, enables certificate validation,
and rejects plaintext MQTT by default. Never set `MQTT_ALLOW_INSECURE=true` in
production.
