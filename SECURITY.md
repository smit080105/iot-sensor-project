# Enterprise IoT Security Architecture & Hardening Guide

This document defines the zero-trust security controls, Private PKI infrastructure, Mutual TLS (mTLS) enforcement, topic-level access control lists (ACLs), and operational rotation procedures implemented for this IoT system.

---

## 1. Security Architecture Summary

```
                      [ Private PKI Root CA ]
                                 │
         ┌───────────────────────┴───────────────────────┐
         ▼                                               ▼
[ Broker TLS Cert (8883) ]                   [ Device Client Certs (CN=dongle_id) ]
         │                                               │
         │                                               │
         └───────────── Mutual TLS (mTLS) Handshake ─────┘
                       (TLS 1.2 / 1.3 Strict, Port 8883)
                                 │
                                 ▼
                     [ Least-Privilege ACL ]
               device_remo/%u/telemetry (Write Only)
                                 │
                                 ▼
                    [ Backend Ingestion Worker ]
                     (CN=backend-service cert)
                                 │
                                 ▼
                 [ Express API + Rate Limiters ]
```

| Security Dimension | Implementation | Guarantee |
|---|---|---|
| **Transport Encryption** | TLS 1.2 minimum, TLS 1.3 preferred on Port 8883 | All network traffic encrypted; plaintext port 1883 completely disabled |
| **Authentication** | Mutual TLS (mTLS) with X.509 Certificates | Server verifies device; device verifies server; fail-closed on verification errors |
| **Device Identity** | On-Device Key Generation + Root CA Signed Cert | Private keys never leave the device; unique identity per device |
| **Authorization** | Topic Access Control Lists (ACLs) - Deny by Default | Devices can only write to `device_remo/%u/telemetry`; no eavesdropping or cross-device publishing |
| **API Defense** | Multi-Tier Rate Limiting (`express-rate-limit`) | 120 req/min general, 10 req/15min CSV uploads, 5 req/15min sensitive routes, 300 req/min health |
| **Audit Logging** | Broker Audit Logging (`mosquitto-audit.log`) | Real-time audit trail of connections, handshakes, disconnects, and ACL violations |
| **Secrets Protection** | `.gitignore` + Environment Variables | Private keys (`*.key`) and `.env` strictly excluded from source control |

---

## 2. Mutual TLS (mTLS) & Private PKI

### Certificate Authority & Chain Hierarchy
- **Root CA**: 4096-bit RSA self-signed Certificate Authority (`certs/ca.crt`), valid for 10 years.
- **Server Certificate**: 2048-bit RSA with Subject Alternative Names (`DNS:localhost`, `DNS:mosquitto`, `DNS:backend`, `IP:127.0.0.1`), valid for 825 days.
- **Backend Service Identity**: Client certificate (`certs/backend/backend-service.crt`) with Common Name `backend-service`.
- **Device Certificates**: Unique client certificates (`certs/devices/<dongle_id>.crt`) where the certificate's Common Name (CN) binds to the device's unique ID (e.g. `DNG001`).

### Safe On-Device Identity Generation
To guarantee zero-trust:
1. The device creates its own private key locally on edge hardware (`openssl genrsa -out device.key 2048`).
2. The device generates a Certificate Signing Request (CSR) with its ID as the Common Name (`CN=<dongle_id>`).
3. The CSR is submitted to the private CA for signing.
4. The signed certificate (`device.crt`) is returned and installed.
5. **The private key never leaves the edge device.**

To generate or provision new certificates, run:
```bash
node scripts/generate-pki.js
```
This creates the development CA, broker, and backend identities. Device private
keys are not generated on this host. Generate each device key and CSR on the
device with `node scripts/create-device-csr.js <dongle_id>`, then sign only its
CSR on the trusted CA host with
`node scripts/sign-device-csr.js <dongle_id> <csr_path>`. See
[`mqtt/SECURE_DEPLOYMENT.md`](mqtt/SECURE_DEPLOYMENT.md) for the complete flow.

---

## 3. Disabling Plaintext Listeners & Downgrade Attack Prevention

- **Port 1883 is disabled**: The broker does not listen on unencrypted port 1883.
- **Encrypted Port 8883**: All edge communication occurs over TLS-enabled port 8883.
- **TLS Version Pinning**: Minimum TLS version is strictly set to `tlsv1.2`. Legacy protocols (SSLv2, SSLv3, TLS 1.0, TLS 1.1) are rejected to prevent downgrade attacks.
- **Forward-Secrecy Cipher Suites**:
  - `ECDHE-ECDSA-AES256-GCM-SHA384`
  - `ECDHE-RSA-AES256-GCM-SHA384`
  - `ECDHE-ECDSA-CHACHA20-POLY1305`
  - `ECDHE-RSA-CHACHA20-POLY1305`
  - `ECDHE-ECDSA-AES128-GCM-SHA256`
  - `ECDHE-RSA-AES128-GCM-SHA256`

---

## 4. Least-Privilege Topic Access Control Lists (ACLs)

Authentication does not imply full access. The broker enforces deny-by-default access control rules in `docker/mosquitto/acl.conf`:

### Device Rules (Identity = `%u` matching Certificate CN)
```ini
# Write access strictly scoped to device's own telemetry:
pattern write device_remo/%u/telemetry
pattern write device_remo/%u/status
pattern write device_remo/%u/feed
pattern write device_remo/%u/register

# Read access strictly scoped to device's own commands:
pattern read device_remo/%u/commands
pattern read device_remo/%u/ack
pattern read device_remo/%u/register_ack
```

- **Deny Wildcards**: Devices cannot subscribe to `#` or `+`.
- **Deny Cross-Device Access**: Device `DNG001` cannot read or write to `device_remo/DNG002/...`. Any attempt is silently dropped and logged.

### Backend Ingestion Service Rules (Identity = `backend-service`)
```ini
user backend-service
topic read device_remo/+/telemetry
topic read device_remo/+/status
topic read device_remo/+/feed
topic read device_remo/+/register
topic write device_remo/+/register_ack
topic write device_remo/+/ack
topic write device_remo/+/commands
```

---

## 5. Network Segmentation & Firewall Recommendations

1. **Broker in DMZ / Isolated VLAN**:
   - The MQTT broker should reside on an isolated IoT VLAN or DMZ network segment.
   - Restrict incoming firewall rules to **only port 8883** (MQTTS). The project dashboard does not need direct MQTT broker access.
2. **Database Isolation**:
   - The PostgreSQL database is on an internal Docker bridge network (`iot-net`) with no published host port.
3. **Internal Backend Routing**:
   - The backend container interacts with Mosquitto over the internal Docker network.

---

## 6. Certificate Rotation & Revocation Policy

1. **Device Certificate Expiration**:
   - Standard device certificates have a 365-day lifetime.
   - Automated re-enrollment scripts should request a renewal 30 days prior to expiration.
2. **Revoking Compromised Devices**:
   - The bundled Mosquitto configuration does not currently load a CRL. For production, use a managed PKI or configure and deploy a CA-generated CRL before relying on certificate revocation. Until then, rotate the issuing CA and replace affected device certificates as part of incident response.
3. **Secret Storage**:
   - Private keys are ignored by Git via `.gitignore`.
   - In production environments, store CA keys in Hardware Security Modules (HSM) or cloud secrets managers (AWS Secrets Manager, Google Secret Manager, HashiCorp Vault).

---

## 7. Verifying the Hardened System

### 1. Re-generate PKI Certificates
```bash
node scripts/generate-pki.js
```

### 2. Verify Certificate Chains
```bash
"C:\Program Files\Git\usr\bin\openssl.exe" verify -CAfile certs/ca.crt certs/server.crt certs/backend/backend-service.crt certs/devices/DNG001.crt
```

### 3. Run the Edge Device Simulator
```bash
node scripts/device-sim.js
```
The simulator tests mTLS handshake, publishes authorized telemetry, and proves that unauthorized cross-device publish attempts are rejected by the broker.
