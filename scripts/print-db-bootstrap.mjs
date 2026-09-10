// Prints SQL only; never connects to a database. Existing tables cause failure.
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const schema = process.argv[2];
if (!["tonetalk_dev", "tonetalk_prod"].includes(schema)) {
  throw new Error("Usage: node scripts/print-db-bootstrap.mjs tonetalk_dev|tonetalk_prod");
}
const cwd = fileURLToPath(new URL("../", import.meta.url));
const ddl = execFileSync(process.execPath, ["node_modules/drizzle-kit/bin.cjs", "export", "--dialect", "postgresql", "--schema", "./src/db/schema.ts"], {
  cwd, env: { ...process.env, DATABASE_SCHEMA: schema }, encoding: "utf8",
});
if (!ddl.startsWith("CREATE TABLE")) throw new Error("Unexpected schema export; refusing to emit bootstrap");
const tables = [...ddl.matchAll(/CREATE TABLE "[^"]+"\."([^"]+)"/g)].map((match) => match[1]);
const hardening = tables.map((table) => `ALTER TABLE "${schema}"."${table}" ENABLE ROW LEVEL SECURITY;\nREVOKE ALL ON TABLE "${schema}"."${table}" FROM PUBLIC, anon, authenticated;`).join("\n");
process.stdout.write(`BEGIN;\nCREATE SCHEMA IF NOT EXISTS "${schema}";\n${ddl}\nREVOKE ALL ON SCHEMA "${schema}" FROM PUBLIC, anon, authenticated;\n${hardening}\nCOMMIT;\n`);
