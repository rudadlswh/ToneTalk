import "server-only";

import { z } from "zod";

const envSchema = z.object({
  AI_PROVIDER: z.enum(["ollama", "gemini"]).default("ollama"),
  AI_ENABLED: z.enum(["true", "false"]).default("true").transform(value => value === "true"),
  AI_USER_DAILY_LIMIT: z.coerce.number().int().min(1).max(10000).default(30),
  AI_GLOBAL_DAILY_LIMIT: z.coerce.number().int().min(1).max(100000).default(100),
  AI_USER_MINUTE_LIMIT: z.coerce.number().int().min(1).max(100).default(5),
  AI_GLOBAL_MINUTE_LIMIT: z.coerce.number().int().min(1).max(1000).default(10),
  AI_MAX_CONCURRENT: z.coerce.number().int().min(1).max(10).default(2),
  AI_USAGE_SCHEMA: z.enum(["tonetalk_dev", "tonetalk_prod"]).optional(),
  AI_USAGE_SCOPE: z.string().regex(/^[a-zA-Z0-9_-]{1,32}$/).default("primary"),
  GEMINI_API_KEY: z.string().min(1).optional(),
  GEMINI_MODEL: z.literal("gemini-3.1-flash-lite").default("gemini-3.1-flash-lite"),
  DATABASE_URL: z.string().url(),
  DATABASE_SCHEMA: z.enum(["tonetalk_dev", "tonetalk_prod"]).default("tonetalk_dev"),
  OLLAMA_LEASE_SCHEMA: z.enum(["tonetalk_dev", "tonetalk_prod"]).optional(),
  OLLAMA_BASE_URL: z.string().url().default("http://127.0.0.1:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen2.5:14b"),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(180_000).default(120_000),
  OLLAMA_BASIC_AUTH_USERNAME: z.string().min(1).optional(),
  OLLAMA_BASIC_AUTH_PASSWORD: z.string().min(1).optional(),
}).superRefine((env, context) => {
  if (env.AI_PROVIDER === "gemini" && !env.GEMINI_API_KEY) {
    context.addIssue({ code: "custom", path: ["GEMINI_API_KEY"], message: "Gemini API key is required" });
  }
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
