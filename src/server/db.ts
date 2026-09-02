import "server-only";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getEnv } from "@/server/env";
import * as schema from "@/db/schema";

const pool = new Pool({
  connectionString: getEnv().DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export const db = drizzle({ client: pool, schema });
export { pool };
