import "server-only";

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
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle({ client: pool, schema });
export { pool };
