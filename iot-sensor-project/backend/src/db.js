const { Pool } = require("pg");

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: process.env.PGPORT || 5432,
  user: process.env.PGUSER || "iotuser",
  password: process.env.PGPASSWORD || "iotpassword",
  database: process.env.PGDATABASE || "iotdb",
});

pool.on("error", (err) => {
  console.error("Unexpected error on idle Postgres client", err);
});

module.exports = pool;
