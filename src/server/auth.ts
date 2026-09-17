import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { jsonError } from "@/lib/api";
import { isSameOriginRequest } from "@/lib/auth-navigation";
import { AuthConfigurationError, createAuthClient } from "@/server/supabase-auth";

export type AuthenticatedUser = { id: string; email: string };
type AuthContext = { user: AuthenticatedUser; owner?: Promise<string> };
const context = new AsyncLocalStorage<AuthContext>();

export class AuthenticationError extends Error {
  constructor() { super("로그인이 필요합니다."); this.name = "AuthenticationError"; }
}
export class AuthenticationUnavailableError extends Error {
  constructor() { super("인증 서버에 연결하지 못했습니다."); this.name = "AuthenticationUnavailableError"; }
}

export async function verifyUser(accessToken?: string): Promise<AuthenticatedUser> {
  const client = await createAuthClient(accessToken);
  const { data, error } = await client.auth.getUser(accessToken);
  if (error && (error.status === undefined || error.status >= 500 || error.status === 429)) throw new AuthenticationUnavailableError();
  const user = data.user;
  if (error || !user || user.is_anonymous || !user.email || !user.email_confirmed_at) throw new AuthenticationError();
  return { id: user.id, email: user.email };
}

export async function getAuthenticatedUser() {
  return context.getStore()?.user ?? verifyUser();
}

// Deduplication is REQUEST-scoped, never a global promise shared by users.
export function requestOwner(initialize: () => Promise<string>): Promise<string> {
  const store = context.getStore();
  if (!store) return initialize();
  return store.owner ??= initialize();
}

export function withAuth<Args extends unknown[]>(handler: (request: Request, ...args: Args) => Promise<Response>) {
  return async (request: Request, ...args: Args): Promise<Response> => {
    const requestId = crypto.randomUUID();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method) && !isSameOriginRequest(request)) {
      return jsonError(requestId, 403, "INVALID_ORIGIN", "같은 사이트에서 요청해 주세요.");
    }
    let user: AuthenticatedUser;
    const started = performance.now();
    try {
      const authorization = request.headers.get("authorization");
      const bearer = authorization?.match(/^Bearer ([^\s]+)$/i);
      // A supplied invalid token must never fall back to another cookie identity.
      if (authorization !== null && !bearer) throw new AuthenticationError();
      user = await verifyUser(bearer?.[1]);
    }
    catch (error) {
      if (error instanceof AuthenticationError) return jsonError(requestId, 401, "AUTH_REQUIRED", "로그인 후 다시 시도해 주세요.");
      return jsonError(requestId, 503, "AUTH_UNAVAILABLE", error instanceof AuthConfigurationError ? "로그인 설정이 준비되지 않았습니다." : "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
    }
    const authenticated = performance.now();
    return context.run({ user }, async () => {
      const response = await handler(request, ...args);
      response.headers.set("Cache-Control", "private, no-store");
      response.headers.append("Server-Timing", `auth;dur=${(authenticated - started).toFixed(1)}, app;dur=${(performance.now() - authenticated).toFixed(1)}`);
      return response;
    });
  };
}
