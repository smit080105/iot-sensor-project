# AeroMetry Gateway — Enterprise IoT & Telemetry Platform

AeroMetry Gateway is an IoT telemetry and sensor registration platform. It processes real-time sensor metrics (temperature, humidity, accelerometer, and gyroscope) transmitted over a private MQTT broker, saves them to a structured relational database, and broadcasts live feeds to a responsive, web-based control console.

The application architecture follows a highly modular, containerized multi-tier pattern optimized for production environments.

---

## 🏛 Architecture & Data Flow

```
                      +-----------------------------+
                      |      External MQTT Client   |
                      |   (Physical/Simulated Node) |
                      +--------------+--------------+
                                     |
                                     | MQTT (certificate-scoped device topics)
                                     v
                       +-------------+-------------+
                       | Private Mosquitto Broker |
                       +-------------+-------------+
                                     |
                                     | Subscribe & Publish
                                     v
+------------------+   +-------------+-------------+   +------------------+
|  CSV Registry    |-->|      NodeJS Backend       |<--|  PostgreSQL DB   |
| (Authorized MACs)|   |  (MQTT / WS / REST API)   |   | (Data Store)     |
+------------------+   +-------------+-------------+   +------------------+
                                     |
                                     | WebSockets (Raw Feed) & HTTP API
                                     v
                       +-------------+-------------+
                       |      Vite React Web UI    |
                       |       (ReMoNet Style)     |
                       +---------------------------+
```

1.  **Hardware Sync (CSV)**: Administrators sync authorized devices using a CSV containing hardware profiles (MAC Address, Serial Number, Product Type).
2.  **Handshake Verification (MQTT)**: Each mTLS-authenticated sensor registers on `device_remo/<dongle_id>/register`. The broker ACL binds that topic to the certificate identity, and the backend confirms the MAC and dongle ID against the PostgreSQL registry before replying on the device's `register_ack` topic.
3.  **Telemetry Stream**: Authorized nodes stream telemetry payloads to `device_remo/<dongle_id>/telemetry` (Temperature, Humidity, Ambient_light, Accel_x/y/z, Potentiometer1-4, nested under `data`). The Backend stores every recognized field and replies with an ack on `device_remo/<dongle_id>/ack`.
4.  **Status & Feed**: Nodes also publish heartbeats to `device_remo/<dongle_id>/status` (`state`, `uptime_sec`) and free-form updates to `device_remo/<dongle_id>/feed`, both stored and surfaced on the dashboard.
5.  **Live Dashboard (WS & HTTP)**: Incoming signals are broadcasted live to the Web UI using WebSockets for real-time visualization.

---

## 📁 Repository Directory Structure

```
iot-sensor-project/
├── backend/                     # Multi-tier NodeJS API & MQTT Client Service
│   ├── src/
│   │   ├── routes/              # Express API Routes (Sensors, Devices, Debugging)
│   │   ├── csvSync.js           # CSV Parsing & Batch PostgreSQL Syncer
│   │   ├── db.js                # PostgreSQL Pool Client Initializer
│   │   ├── deviceRegistry.js    # Device Verification Utilities
│   │   ├── index.js             # HTTP server & WebSocket Broadcast Coordinator
│   │   ├── mqtt.js              # MQTT Subscriber/Publisher Pipeline & JSON Parser
│   │   └── ws.js                # WebSocket Connection Handler
│   ├── Dockerfile               # Node Service Container Recipe
│   └── package.json             
│
├── frontend/                    # Vite React Control Console Dashboard
│   ├── src/
│   │   ├── App.css              # Custom ReMoNet Palette & Responsive Layout Styles
│   │   ├── App.jsx              # UI Sidebar, Filter Controls & Panel Grid
│   │   ├── TelemetryChart.jsx   # High-Contrast Recharts Dual-Axis Graphics
│   │   └── main.jsx             # React Virtual DOM Bootstrapper
│   ├── Dockerfile               # Production NGINX static bundle container
│   └── package.json             
│
├── database/                    # Relational Database Storage Configurations
│   └── init.sql                 # DDL Schemas & Automated Indexes for Telemetry
│
├── csv/                         # Registry uploads location
│   ├── devices.csv              # Seed Device Hardware list
│   └── README.md                # Specifications for registry format
│
├── mqtt/                        # Telemetry Broker protocol specs
│   └── PUBLIC_BROKER.md         # Full protocol specifications & handshake payloads
│
└── docker/                      # Multi-Container Deployment Configuration
    ├── .env                     # Local compose environment configurations
    └── docker-compose.yml       # Production network and service compose orchestration
```

---

## 🚀 Getting Started (Production Run)

The entire environment is configured to run out-of-the-box using Docker Compose.

### Prerequisites
*   Docker & Docker Compose installed on your system.

### Steps to Run
1.  **Generate Private PKI Certificates** (Root CA, Broker TLS Cert, Backend Cert, and Device Certs):
    ```bash
    node scripts/generate-pki.js
    ```
    Keep the generated private keys local and out of source control. The dashboard uses individual login sessions; set `INITIAL_ADMIN_USERNAME`, `INITIAL_ADMIN_EMAIL`, and a strong `INITIAL_ADMIN_PASSWORD` in `docker/.env` before the first database startup if no administrator account exists. Set a random `JWT_SECRET` of at least 32 bytes and unique database and API credentials there as well.
2.  Navigate into the `docker` subdirectory:
    ```bash
    cd docker
    ```
3.  Launch all services (Database, Hardened Mosquitto Broker, Backend, and Frontend):
    ```bash
    docker-compose up -d --build
    ```
4.  Verify that all containers are healthy:
    ```bash
    docker-compose ps
    ```
5.  Open your browser and navigate to:
    *   **Frontend Panel**: `http://localhost:3000`
    *   **Backend health check**: `http://localhost:4000/api/health`
6.  **(Optional) Run the Edge Device Simulator** against the local Mosquitto broker. Generate the development broker/backend certificates, then create the simulator device identity and sign its CSR:
    ```bash
    node scripts/generate-pki.js
    node scripts/create-device-csr.js DNG001 ./certs/devices
    node scripts/sign-device-csr.js DNG001 ./certs/devices/DNG001.csr
    ```
    Set `MQTT_URL=mqtts://mosquitto:8883` and a long random `PAIRING_TOKEN` in `docker/.env`, then recreate the backend container. In a second PowerShell terminal at the repository root, set the same token and run:
    ```powershell
    $env:MQTT_URL='mqtts://localhost:8888'
    $env:PAIRING_TOKEN='<same-test-token-as-docker/.env>'
    node scripts/device-sim.js
    ```
    This generates the simulator's key locally for development. For a real device, create its key on the device and send only its CSR to the CA; follow [`mqtt/SECURE_DEPLOYMENT.md`](mqtt/SECURE_DEPLOYMENT.md).

---

## 🔒 Enterprise Zero-Trust Security

*   **Mutual TLS (mTLS) & TLS 1.2/1.3**: The local Mosquitto container accepts encrypted MQTT on container port `8883`, mapped to host port `8888` by default. Plaintext port 1883 is disabled.
*   **Private PKI**: Dedicated CA, broker, backend, and per-device identities. Device private keys are generated on-device and never leave the device.
*   **Narrowly Authorized Topic ACLs**: Enforced at the broker level. Each device certificate can publish and subscribe only within its own `device_remo/<dongle_id>/...` namespace.
*   **Multi-Tier Rate Limiting**: Protects API routes against brute-force and credential stuffing (general, auth, upload, and health check limits).
*   **Audit Logging**: Continuous logging of broker connections, handshakes, and access control violations (`mosquitto-audit.log`).

**Read [`SECURITY.md`](./SECURITY.md) for full architecture details, rotation policies, and firewall configurations.**

## 🔧 Component Integrations

*   **Database Integration**: Starts PostgreSQL and automatically executes [`database/init.sql`](./database/init.sql) on first bootstrap to provision tables, indexes, and primary keys.
*   **MQTT Client Service**: Connects to the explicitly configured private broker with TLS and mTLS, subscribing to certificate-scoped registration, telemetry, status, and feed topics.
*   **React Web Client**: Configured to connect to REST routes and fallback polling, switching protocols instantly to WebSockets to stream incoming data live without page reloads.
## Troubleshooting

**Backend can't connect to the database?**
Render's free Postgres tier expires after ~30 days. Check `https://<your-backend>.onrender.com/api/health` — if it reports a database error, recreate the Postgres instance on Render and update `DATABASE_URL` in both `backend/.env` and Render's backend environment settings.
