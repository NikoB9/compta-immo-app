import "server-only";

import { Pool } from "pg";

let pool: Pool | undefined;

export function getDatabasePool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not configured.");

  pool = new Pool({
    connectionString,
    max: 5,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "compta-immo-app",
  });

  pool.on("error", () => {
    console.error("Unexpected idle PostgreSQL connection error.");
  });

  return pool;
}
