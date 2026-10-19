# Secure MQTT deployment

For real deployments, set up a private MQTT broker and use TLS with a unique
client identity for the backend. The bundled Mosquitto configuration requires
mutual TLS and topic ACLs. Protect private keys and credentials with a secret
manager or deployment secrets; never commit them.

For a local development broker, `node scripts/generate-pki.js` creates a
development CA, broker identity, and backend identity. It does not create
device identities. Do not run that development CA on a production app host;
use an isolated CA or managed PKI and mount only the broker and backend
certificates required by the services.

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
The bundled ACL uses each device certificate's Common Name as its MQTT
username and permits it to access only `device_remo/<CN>/...` topics. The CN
must exactly match the device's registered dongle ID. Registration uses
`device_remo/<dongle_id>/register` and
`device_remo/<dongle_id>/register_ack`; the old shared `remo_reg` topics are
not permitted by the private broker ACL.

## Provision a device certificate

Add the device's dongle ID and MAC address to the registry first. On a
Node-capable gateway, create its private key and CSR locally:

```sh
node scripts/create-device-csr.js DNG001 ./certs/devices
```

For a device without Node.js but with OpenSSL, the equivalent local commands
are:

```sh
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out DNG001.key
openssl req -new -key DNG001.key -out DNG001.csr -subj "/C=US/O=IoT-Devices/OU=Sensors/CN=DNG001"
```

Embedded devices without OpenSSL should generate the key and CSR with their
firmware's cryptographic library or a secure element. Do not generate their
private keys on the backend server.

Send only `DNG001.csr` to the trusted certificate authority using an approved
channel. On the CA signing host, validate that the dongle ID is registered and
sign the request:

```sh
node scripts/sign-device-csr.js DNG001 ./certs/devices/DNG001.csr
```

Return `certs/devices/DNG001.crt` to the device. Install it alongside the
original `DNG001.key` and `ca.crt`. The private key stays on the device and is
never copied to the backend or committed to source control. Use one unique
certificate per device. The bundled broker does not yet load a CRL, so its
production setup needs a managed PKI or a configured CRL before certificate
revocation can be relied on. The repository scripts support development
provisioning; production issuance should use an isolated CA or managed PKI
with approval, revocation, and protected CA key storage.

The device firmware must connect with its own certificate and publish only
under its identity namespace. It must subscribe to its own `register_ack`,
`commands`, and `ack` topics. Update firmware that still uses global
`remo_reg`/`remo_regOK` topics before enabling the private broker ACL.

For a private managed broker that authenticates with a username and password,
use `MQTT_AUTH_MODE=password`, keep `MQTT_URL` on `mqtts://`, and inject
`MQTT_USERNAME` and `MQTT_PASSWORD` through the secret store. Do not include
credentials in the broker URL.

The shared EMQX public broker is for non-production smoke tests only. It
requires all of `MQTT_BROKER_MODE=public-test`, `MQTT_AUTH_MODE=none`, and an
explicit broker URL and a disposable test-only `PAIRING_TOKEN`; the backend
refuses this mode when `NODE_ENV=production`. Never reuse the production token.
TLS protects the network connection but does not make shared broker topics
private. Do not publish real device data or secrets there. The per-device ACL
in this repository applies to the bundled private Mosquitto broker, not to a
public test broker.

The backend requires an explicit `MQTT_URL`, enables certificate validation,
and rejects plaintext MQTT by default. Never set `MQTT_ALLOW_INSECURE=true` in
production.
