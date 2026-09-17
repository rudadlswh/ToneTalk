import { sql } from "drizzle-orm";
import { db } from "@/server/db";
import { checkOllama } from "@/server/ollama";

import { withAuth } from "@/server/auth";
import { getRequestId, logFailure } from "@/server/diagnostics";

export const runtime = "nodejs";
export const GET = withAuth(handleGET);

async function handleGET() {
  const checks = await Promise.allSettled([
    db.execute(sql`select 1 as ok`),
    checkOllama(),
  ]);
  const database = checks[0].status === "fulfilled";
  const ollama = checks[1].status === "fulfilled" && checks[1].value;
  const requestId = getRequestId();
  if (!database) logFailure("health_database_failed", requestId, checks[0].status === "rejected" ? checks[0].reason : undefined);
  if (!ollama) logFailure("health_ai_failed", requestId, checks[1].status === "rejected" ? checks[1].reason : undefined);
  return Response.json(
    { status: database && ollama ? "ok" : "degraded", database, ollama, requestId },
    {
      status: database && ollama ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
