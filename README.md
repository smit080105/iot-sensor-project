# AeroMetry Gateway — Enterprise IoT & Telemetry Platform

AeroMetry Gateway is a production-grade IoT telemetry and sensor registration platform. Built for reliability and visibility, it processes real-time sensor metrics (temperature, humidity, accelerometer, and gyroscope) transmitted over public/private MQTT brokers, saves them to a structured relational database, and broadcasts live feeds to a responsive, web-based control console.

The application architecture follows a highly modular, containerized multi-tier pattern optimized for production environments.

---

## 🏛 Architecture & Data Flow

```
                      +-----------------------------+
                      |      External MQTT Client   |
                      |   (Physical/Simulated Node) |
                      +--------------+--------------+
                                     |
                                     | MQTT (DEVICE_reg / Telemetry)
                                     v
                       +-------------+-------------+
                       |      EMQX MQTT Broker     |
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
2.  **Handshake Verification (MQTT)**: Incoming sensor nodes attempt to register on topic `DEVICE_reg`. The Backend queries the PostgreSQL registry to verify credentials and issues authorization on `DEVICE_regok`.
3.  **Telemetry Stream**: Authorized nodes stream telemetry payloads to `device_scd/<dongle_id>/telemetry`. The Backend parses recognized sensor types (Temperature, Humidity, Ax, Ay, Az, Gx, Gy, Gz) and logs them.
4.  **Live Dashboard (WS & HTTP)**: Incoming signals are broadcasted live to the Web UI using WebSockets for real-time visualization.

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
1.  Navigate into the `docker` subdirectory:
    ```bash
    cd docker
    ```
2.  Launch all services (Database, Backend, and Frontend) in detached mode:
    ```bash
    docker-compose up -d --build
    ```
3.  Verify that all containers are healthy:
    ```bash
    docker-compose ps
    ```
4.  Open your browser and navigate to:
    *   **Frontend Panel**: `http://localhost:3000`
    *   **Backend REST API**: `http://localhost:4000/api/devices`

---

## 🔧 Component Integrations

*   **Database Integration**: Spawns an alpine-based PostgreSQL instance. Automatically executes [init.sql](file:///C:/Users/smitb/Downloads/iot-sensor-project-fixed-v3/database/init.sql) upon bootstrap to provision tables, indexes, and primary keys.
*   **MQTT Client Service**: Automatically connects to the designated public broker upon backend boot, subscribing to register endpoints and routing all streams directly into the active database pool.
*   **React Web Client**: Configured to connect to REST routes and fallback polling, switching protocols instantly to WebSockets to stream incoming data live without page reloads.
