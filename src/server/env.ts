import "server-only";

import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_SCHEMA: z.enum(["tonetalk_dev", "tonetalk_prod"]).default("tonetalk_dev"),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5:14b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(120_000),
  OLLAMA_BASIC_AUTH_USERNAME: z.string().min(1).optional(),
  OLLAMA_BASIC_AUTH_PASSWORD: z.string().min(1).optional(),
  SINGLE_USER_ID: z.string().min(1).max(64).default("single-user"),
}).superRefine((env, context) => {
  if (Boolean(env.OLLAMA_BASIC_AUTH_USERNAME) !== Boolean(env.OLLAMA_BASIC_AUTH_PASSWORD)) {
    context.addIssue({
      code: "custom",
      path: ["OLLAMA_BASIC_AUTH_PASSWORD"],
      message: "OLLAMA_BASIC_AUTH_USERNAME and OLLAMA_BASIC_AUTH_PASSWORD must be set together",
    });
  }
});

let cachedEnv: z.infer<typeof envSchema> | undefined;

export function getEnv() {
  if (!cachedEnv) cachedEnv = envSchema.parse(process.env);
  return cachedEnv;
}
