import "server-only";
import { randomUUID } from "node:crypto";
import { pool } from "@/server/db";
import { getEnv } from "@/server/env";
import { assertRequestActive, requestSignal } from "@/server/request-budget";
import { AiServiceError } from "@/server/ai-error";

export class InferenceBusyError extends Error {}

// A database lease works across Vercel instances; an in-memory semaphore does not.
// No connection or SQL transaction is held while the PC generates text.
export async function withInferenceSlot<T>(work: () => Promise<T>): Promise<T> {
  assertRequestActive();
  const env = getEnv();
  if (env.AI_PROVIDER === "gemini") return work();
  const table = `"${env.OLLAMA_LEASE_SCHEMA ?? env.DATABASE_SCHEMA}"."inference_leases"`;
  const token = randomUUID();
  const acquired = await pool.query<{ token: string }>(
    `insert into ${table} (id, token, expires_at) values ('ollama', $1, now() + interval '200 seconds')
     on conflict (id) do update set token = excluded.token, expires_at = excluded.expires_at
     where ${table}.expires_at < now() returning token`, [token],
  );
  if (!acquired.rows.length) throw new InferenceBusyError("AI is busy");
  let finished = false;
  try {
    assertRequestActive();
    const result = await work();
    finished = true;
    return result;
  } catch (error) {
    // Output validation happens after a complete response; it is safe to admit
    // the next request. Network failures/timeouts are ambiguous, so retain lease.
    finished = (error instanceof AiServiceError && !error.retainLease) || (error instanceof Error && ["OllamaOutputError", "SameLanguageError"].includes(error.name));
    throw error;
  } finally {
    // On cancellation keep the lease until expiry: upstream cancellation is best
    // effort and must not immediately admit a second inference on the same PC.
    if (finished && !requestSignal()?.aborted) {
      await pool.query(`delete from ${table} where id = 'ollama' and token = $1`, [token])
        .catch(() => console.warn("inference_lease_release_failed"));
    }
  }
}
