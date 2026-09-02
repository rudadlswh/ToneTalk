import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { checkOllama } from "@/server/ollama";

export const runtime = "nodejs";

export async function GET() {
  const checks = await Promise.allSettled([
    db.execute(sql`select 1 as ok`),
    checkOllama(),
  ]);
  const database = checks[0].status === "fulfilled";
  const ollama = checks[1].status === "fulfilled" && checks[1].value;
  return Response.json(
    { status: database && ollama ? "ok" : "degraded", database, ollama },
    {
      status: database ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
