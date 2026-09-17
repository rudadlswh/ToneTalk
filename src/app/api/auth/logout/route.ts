import { getRequestId, logFailure } from "@/server/diagnostics";
import { jsonError } from "@/lib/api";
import { isSameOriginRequest } from "@/lib/auth-navigation";
import { createAuthClient } from "@/server/supabase-auth";

export async function POST(request: Request) {
  const requestId = getRequestId();
  if (!isSameOriginRequest(request)) return jsonError(requestId, 403, "INVALID_ORIGIN", "같은 사이트에서 요청해 주세요.");
  try {
    const client = await createAuthClient();
    const { error } = await client.auth.signOut({ scope: "local" });
    if (error) throw error;
    return Response.json({ signedOut: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    logFailure("sign_out_failed", requestId, error);
    return jsonError(requestId, 503, "SIGN_OUT_FAILED", "로그아웃하지 못했습니다. 다시 시도해 주세요.", true);
  }
}
