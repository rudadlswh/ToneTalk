import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { jsonError } from "@/lib/api";
import { isSameOriginRequest } from "@/lib/auth-navigation";
import { createAuthClient } from "@/server/supabase-auth";
import { consumeRateLimit } from "@/server/rate-limit";
import { readLimitedJson } from "@/server/request-body";
import { logFailure } from "@/server/diagnostics";

const credentials = z.object({ username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{4,24}$/), password: z.string().min(8).max(128) });
export async function passwordAuth(request: Request, signup: boolean) {
  const requestId = crypto.randomUUID();
  if (!isSameOriginRequest(request)) return jsonError(requestId, 403, "INVALID_ORIGIN", "같은 사이트에서 요청해 주세요.");
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!consumeRateLimit(`password-ip:${ip}`, 20, 60_000).allowed) return limited(requestId);
  let input;
  try { input = credentials.parse(await readLimitedJson(request, 4096)); }
  catch { return jsonError(requestId, 400, "INVALID_INPUT", "아이디는 영문·숫자·밑줄 4~24자, 비밀번호는 8~128자로 입력해 주세요."); }
  const hash = createHash("sha256").update(input.username).digest("hex");
  if (!consumeRateLimit(`password-user:${hash}`, 5, 60_000).allowed) return limited(requestId);
  try {
    const client = await createAuthClient();
    // Reserved, non-deliverable namespace; this does not assert real email ownership.
    const account = { email: `${input.username}@users.tonetalk.invalid`, password: input.password };
    const { data, error } = signup ? await client.auth.signUp(account) : await client.auth.signInWithPassword(account);
    if (error) {
      // Provider codes are diagnostic; never log credentials or the email value.
      logFailure(signup ? "signup_rejected" : "login_rejected", requestId, error);
      if (error.status === 429) return jsonError(requestId, 429, "AUTH_RATE_LIMIT", "인증 요청이 많습니다. 잠시 후 다시 시도해 주세요.", true);
      return jsonError(requestId, signup ? 400 : 401, "CREDENTIALS_REJECTED", signup ? "가입하지 못했습니다. 다른 아이디를 사용하거나 잠시 후 다시 시도해 주세요." : "아이디 또는 비밀번호를 확인해 주세요.");
    }
    if (!data.session) {
      logFailure("auth_session_missing", requestId);
      return jsonError(requestId, 503, "AUTH_SETUP_REQUIRED", "관리자가 Supabase Confirm email 설정을 꺼야 가입할 수 있습니다.");
    }
    return Response.json({ authenticated: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logFailure("password_auth_unavailable", requestId, error);
    return jsonError(requestId, 503, "AUTH_UNAVAILABLE", "인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.", true);
  }
}
function limited(requestId: string) {
  const response = jsonError(requestId, 429, "RATE_LIMITED", "요청이 많습니다. 60초 후 다시 시도해 주세요.", true);
  response.headers.set("Retry-After", "60");
  return response;
}
