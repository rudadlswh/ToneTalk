import "server-only";

import { attachDatabasePool } from "@vercel/functions";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/env";
import { SUPABASE_ROOT_CA } from "@/server/supabase-ca";
import * as schema from "@/db/schema";

const connectionUrl = new URL(getEnv().DATABASE_URL);

// `pg` lets URL SSL parameters override the explicit TLS options. Remove them so
// both local development and Vercel verify the pooler with Supabase's root CA.
connectionUrl.searchParams.delete("sslmode");
connectionUrl.searchParams.delete("sslrootcert");
connectionUrl.searchParams.delete("uselibpqcompat");

const pool = new Pool({
  connectionString: connectionUrl.toString(),
  ssl: {
    ca: SUPABASE_ROOT_CA,
    rejectUnauthorized: true,
  },
  // Vercel instances can scale horizontally, so keep the per-instance pool
  // deliberately small and let Supavisor handle cross-instance pooling.
  max: 2,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 15_000,
  keepAlive: true,
  keepAliveInitialDelayMillis: 5_000,
  allowExitOnIdle: true,
});

attachDatabasePool(pool);

export const db = drizzle({ client: pool, schema });
export { pool };
