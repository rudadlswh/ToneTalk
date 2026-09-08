import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { languageCodes } from "@/lib/languages";
import { tones, translationVariantSchema } from "@/lib/translation-contract";
import { pool } from "@/server/db";
import { getEnv } from "@/server/env";
import { assertRequestActive } from "@/server/request-budget";

export const cachedTranslationSchema = z.object({
  sourceLanguage: z.enum(languageCodes),
  variants: z.array(translationVariantSchema).length(5)
    .refine((variants) => variants.every((variant, index) => variant.tone === tones[index])),
  latencyMs: z.number().int().nonnegative(),
});
type CachedTranslation = z.infer<typeof cachedTranslationSchema>;

export function translationCacheKey(owner: string, text: string, source: string, target: string) {
  const env = getEnv();
  // Increment this revision when prompt/format/validation semantics change.
  return createHash("sha256").update(JSON.stringify([
    "tones-v2-structured", env.OLLAMA_BASE_URL, env.OLLAMA_MODEL,
    owner, text.trim(), source, target,
  ])).digest("hex");
}
function tableName() { return `"${getEnv().DATABASE_SCHEMA}"."translation_cache"`; }

export async function readTranslationCache(key: string): Promise<CachedTranslation | null> {
  assertRequestActive();
  const result = await pool.query<{ payload: unknown }>(
    `select payload from ${tableName()} where key = $1 and expires_at > now()`, [key],
  );
  const parsed = cachedTranslationSchema.safeParse(result.rows[0]?.payload);
  return parsed.success ? parsed.data : null;
}

export async function writeTranslationCache(key: string, value: CachedTranslation) {
  assertRequestActive();
  const payload = cachedTranslationSchema.parse(value);
  await pool.query(
    `insert into ${tableName()} (key, payload, expires_at) values ($1, $2::jsonb, now() + interval '7 days')
     on conflict (key) do update set payload = excluded.payload, created_at = now(), expires_at = excluded.expires_at`,
    [key, JSON.stringify(payload)],
  );
  // Bounded disk usage, no user histories are deleted. Only one admitted writer.
  await pool.query(`delete from ${tableName()} where expires_at <= now() or key in
    (select key from ${tableName()} order by created_at desc, key limit all offset 1000)`);
}
