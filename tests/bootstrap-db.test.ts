import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

it.skipIf(process.env.BOOTSTRAP_DB_TEST !== "1")("bootstraps an empty isolated schema and rolls everything back", async () => {
  if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit dev connection required");
  const { pool } = await import("@/server/db");
  const schema = `bootstrap_test_${randomUUID().replaceAll("-", "")}`;
  const ddl = execFileSync(process.execPath, ["scripts/print-db-bootstrap.mjs", "tonetalk_dev"], { encoding: "utf8" })
    .replaceAll('"tonetalk_dev"', `"${schema}"`).replace(/^BEGIN;\n/, "").replace(/COMMIT;\n$/, "");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(ddl);
    const tables = await client.query("select relname, relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and relkind='r'", [schema]);
    expect(tables.rows).toHaveLength(14);
    expect(tables.rows.every((row) => row.relrowsecurity)).toBe(true);
  } finally {
    await client.query("ROLLBACK");
    client.release();
    await pool.end();
  }
});
