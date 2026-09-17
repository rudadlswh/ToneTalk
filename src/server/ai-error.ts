import "server-only";
import { jsonError } from "@/lib/api";

export class AiServiceError extends Error {
  override name = "AiServiceError";
  constructor(public status: number, public code: string, message: string,
    public retryAfterSeconds = 0, public cooldownSeconds = 0, public retainLease = false) { super(message); }
}

export function aiErrorResponse(error: unknown, requestId: string) {
  if (!(error instanceof AiServiceError)) return null;
  const response = jsonError(requestId, error.status, error.code, error.message, error.status !== 499);
  if (error.retryAfterSeconds > 0) response.headers.set("Retry-After", String(Math.ceil(error.retryAfterSeconds)));
  return response;
}

export function retryAfterSeconds(value: string | null, fallback = 60) {
  if (!value) return fallback;
  const numeric = Number(value);
  const seconds = Number.isFinite(numeric) ? numeric : (Date.parse(value) - Date.now()) / 1000;
  return Number.isFinite(seconds) ? Math.min(86_400, Math.max(1, Math.ceil(seconds))) : fallback;
}
