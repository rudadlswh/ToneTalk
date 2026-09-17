import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { pool } from "@/server/db";
import { getEnv } from "@/server/env";
import { getAuthenticatedUser } from "@/server/auth";
import { AiServiceError } from "@/server/ai-error";

type State = { id: string; minute: number; day: number; minute_calls: number; day_calls: number; blocked_until: Date | null; block_code: string | null };
type Clock = { minute: number; day: number; seconds: number };
const clockSql = "select floor(extract(epoch from statement_timestamp()) / 60)::int as minute, floor((extract(epoch from statement_timestamp()) + 32400) / 86400)::int as day, extract(epoch from statement_timestamp())::float8 as seconds";
const unavailable = () => new AiServiceError(503, "AI_GUARD_UNAVAILABLE", "AI 사용량을 확인하지 못해 새 호출을 잠시 중단했어요. 기존 학습 기록은 계속 볼 수 있어요.", 30);

function configuration(ownerId: string) {
  const env = getEnv();
  const schema = env.AI_USAGE_SCHEMA ?? env.DATABASE_SCHEMA;
  const scope = `${env.AI_PROVIDER}:${env.AI_USAGE_SCOPE}`;
  return {
    env, table: `"${schema}"."ai_usage_state"`, leases: `"${schema}"."inference_leases"`,
    global: `${scope}:global`, user: `${scope}:user:${ownerId}`,
    slotPrefix: `ai-${createHash("sha256").update(scope).digest("hex").slice(0, 30)}-`,
  };
}
function remaining(row: State | undefined, clock: Clock, minuteLimit: number, dayLimit: number) {
  const minuteUsed = row?.minute === clock.minute ? row.minute_calls : 0;
  const dayUsed = row?.day === clock.day ? row.day_calls : 0;
  const dayRetry = Math.max(1, Math.ceil((clock.day + 1) * 86400 - 32400 - clock.seconds));
  const minuteRetry = Math.max(1, Math.ceil((clock.minute + 1) * 60 - clock.seconds));
  return { dayUsed, left: Math.max(0, dayLimit - dayUsed), dayRetry, minuteRetry, dayLimited: dayUsed >= dayLimit, minuteLimited: minuteUsed >= minuteLimit };
}
function cooldown(row: State | undefined, clock: Clock) {
  return Math.max(0, Math.ceil((Number(row?.blocked_until) - clock.seconds * 1000) / 1000)) || 0;
}

// Called ONLY immediately before provider dispatch: cache hits/DB reads cost zero.
// ponytail: one short global-row lock per dispatch; enough for this <10-user MVP.
export async function withAiUsage<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const owner = await getAuthenticatedUser();
  const config = configuration(owner.id);
  const { env, table, leases } = config;
  if (!env.AI_ENABLED) throw new AiServiceError(503, "AI_DISABLED", "새 AI 생성을 일시 중단했어요. 저장한 표현과 기존 오늘의 문제는 이용할 수 있어요.", 300);
  const token = randomUUID();
  let slotId: string;
  let client;
  try {
    client = await pool.connect();
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '2s'");
    await client.query(`insert into ${table} (id) values ($1) on conflict do nothing`, [config.global]);
    const global = (await client.query<State>(`select * from ${table} where id=$1 for update`, [config.global])).rows[0];
    // Always lock global before user, so requests cannot deadlock each other.
    await client.query(`insert into ${table} (id) values ($1) on conflict do nothing`, [config.user]);
    const user = (await client.query<State>(`select * from ${table} where id=$1 for update`, [config.user])).rows[0];
    const clock = (await client.query<Clock>(clockSql)).rows[0];
    const wait = cooldown(global, clock);
    if (wait) throw new AiServiceError(global.block_code === "AI_QUOTA_EXCEEDED" ? 429 : 503, global.block_code ?? "AI_COOLDOWN", "AI 공급자 한도 또는 장애로 호출을 잠시 쉬고 있어요. 입력은 유지됩니다.", wait);
    for (const [row, minuteLimit, dayLimit, label] of [
      [global, env.AI_GLOBAL_MINUTE_LIMIT, env.AI_GLOBAL_DAILY_LIMIT, "서비스 전체"],
      [user, env.AI_USER_MINUTE_LIMIT, env.AI_USER_DAILY_LIMIT, "내 계정"],
    ] as const) {
      const quota = remaining(row, clock, minuteLimit, dayLimit);
      if (quota.dayLimited) throw new AiServiceError(429, "AI_DAILY_LIMIT", `${label}의 오늘 AI 사용 한도에 도달했어요. 한국 시간 자정 이후 다시 이용할 수 있어요.`, quota.dayRetry);
      if (quota.minuteLimited) throw new AiServiceError(429, "AI_RATE_LIMIT", `${label}의 AI 요청이 잠시 몰렸어요. 입력은 유지됩니다.`, quota.minuteRetry);
    }
    const slot = await client.query<{ id: string }>(`insert into ${leases} as lease (id,token,expires_at)
      select $1 || slot::text, $2, now() + interval '200 seconds' from generate_series(1,$3::int) slot
      where not exists (select 1 from ${leases} where id=$1 || slot::text and expires_at > now())
      order by slot limit 1
      on conflict (id) do update set token=excluded.token,expires_at=excluded.expires_at where lease.expires_at <= now() returning id`,
    [config.slotPrefix, token, env.AI_MAX_CONCURRENT]);
    if (!slot.rows.length) throw new AiServiceError(429, "AI_BUSY", "AI가 다른 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.", 10);
    slotId = slot.rows[0].id;
    signal.throwIfAborted();
    await client.query(`update ${table} set minute=$3, day=$4,
      minute_calls=case when minute=$3 then minute_calls+1 else 1 end,
      day_calls=case when day=$4 then day_calls+1 else 1 end where id in ($1,$2)`, [config.global, config.user, clock.minute, clock.day]);
    await client.query("COMMIT");
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    if (signal.aborted) throw signal.reason;
    if (error instanceof AiServiceError) throw error;
    console.warn("ai_admission_failed"); // Never log SQL parameters, keys or input.
    throw unavailable();
  } finally { client?.release(); }

  let retain = false;
  try {
    signal.throwIfAborted();
    return await work();
  } catch (error) {
    retain = signal.aborted || (error instanceof AiServiceError && error.retainLease);
    if (error instanceof AiServiceError) console.warn("ai_provider_failure", { provider: env.AI_PROVIDER, code: error.code, status: error.status });
    if (error instanceof AiServiceError && error.cooldownSeconds > 0) {
      await pool.query(`update ${table} set blocked_until=greatest(coalesce(blocked_until,now()),now()+$2::int*interval '1 second'), block_code=$3 where id=$1`,
        [config.global, error.cooldownSeconds, error.code]).catch(() => console.warn("ai_cooldown_save_failed"));
    }
    throw error;
  } finally {
    // On timeout/cancel upstream termination is uncertain: retain until expiry.
    if (!retain && !signal.aborted) await pool.query(`delete from ${leases} where id=$1 and token=$2`, [slotId!, token]).catch(() => console.warn("ai_slot_release_failed"));
  }
}

export async function getAiUsage() {
  const owner = await getAuthenticatedUser();
  const { env, table, global: globalId, user: userId } = configuration(owner.id);
  try {
    const rows = (await pool.query<State>(`select * from ${table} where id in ($1,$2)`, [globalId, userId])).rows;
    const clock = (await pool.query<Clock>(clockSql)).rows[0];
    const global = rows.find(row => row.id === globalId);
    const user = rows.find(row => row.id === userId);
    const own = remaining(user, clock, env.AI_USER_MINUTE_LIMIT, env.AI_USER_DAILY_LIMIT);
    const shared = remaining(global, clock, env.AI_GLOBAL_MINUTE_LIMIT, env.AI_GLOBAL_DAILY_LIMIT);
    const wait = Math.max(cooldown(global, clock), shared.dayLimited || own.dayLimited ? own.dayRetry : 0,
      shared.minuteLimited || own.minuteLimited ? own.minuteRetry : 0);
    return { used: own.dayUsed, limit: env.AI_USER_DAILY_LIMIT, remaining: own.left,
      resetsAt: new Date(((clock.day + 1) * 86400 - 32400) * 1000).toISOString(),
      enabled: env.AI_ENABLED, retryAfterSeconds: wait, available: env.AI_ENABLED && wait === 0 };
  } catch { throw unavailable(); }
}
