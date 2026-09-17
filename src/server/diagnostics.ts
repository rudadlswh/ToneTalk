import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";

const requests = new AsyncLocalStorage<string>();
export const getRequestId = () => requests.getStore() ?? crypto.randomUUID();
export const withRequestId = <T>(id: string, run: () => T): T => requests.run(id, run);

// Never serialize arbitrary error fields, messages, stacks, SQL or parameters.
const names = new Set(["Error", "TypeError", "SyntaxError", "AbortError", "TimeoutError", "AuthConfigurationError", "AuthenticationUnavailableError", "AuthApiError", "AuthRetryableFetchError", "DrizzleQueryError"]);
const codes = new Set(["23505", "23503", "23502", "22021", "57014", "53300", "08006", "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "invalid_credentials", "over_request_rate_limit", "over_email_send_rate_limit", "email_not_confirmed", "unexpected_failure", "request_timeout"]);
for (const code of ["signup_disabled", "user_already_exists", "email_address_invalid", "email_address_not_authorized", "validation_failed"]) codes.add(code);
export function safeError(error: unknown) {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const cause = value.cause && typeof value.cause === "object" ? value.cause as Record<string, unknown> : {};
  const code = [value.code, cause.code].find((item) => typeof item === "string" && codes.has(item));
  const status = value.status ?? cause.status;
  return {
    category: typeof value.name === "string" && names.has(value.name) ? value.name : "unknown",
    ...(code ? { code } : {}),
    ...(typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? { status } : {}),
  };
}
export function logFailure(event: string, requestId: string, error?: unknown) {
  console.error(event, { requestId, ...safeError(error) });
}
