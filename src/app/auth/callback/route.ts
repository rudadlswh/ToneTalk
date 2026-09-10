import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { safeAuthNext } from "@/lib/auth-navigation";
import { createAuthClient } from "@/server/supabase-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const code = params.get("code");
  const requestId = crypto.randomUUID();
  // Never record callback URLs, codes, cookie values or raw error messages.
  const store = await cookies();
  const hasVerifierCookie = store.getAll().some(({ name, value }) => /-code-verifier(?:\.\d+)?$/.test(name) && Boolean(value));
  const report = (stage: string, error: unknown) => {
    const detail = error as { code?: unknown; status?: unknown } | null;
    const knownCodes = ["otp_expired", "bad_code_verifier", "flow_state_expired", "flow_state_not_found", "pkce_verifier_missing"];
    const errorCode = typeof detail?.code === "string" && knownCodes.includes(detail.code) ? detail.code : "other";
    console.error("auth_callback_failed", { requestId, stage, errorCode, hasVerifierCookie,
      status: typeof detail?.status === "number" ? detail.status : null });
    return errorCode;
  };
  let destination = "/login?error=link";
  if (params.has("error")) {
    const reason = report("provider", { code: params.get("error_code") });
    if (reason === "otp_expired") destination = "/login?error=expired";
  } else if (code) {
    try {
      const client = await createAuthClient();
      const { error } = await client.auth.exchangeCodeForSession(code);
      if (!error) {
        destination = `/auth/complete?next=${encodeURIComponent(safeAuthNext(store.get("tonetalk-auth-next")?.value))}`;
        store.delete("tonetalk-auth-next");
      } else {
        const reason = report("exchange", error);
        if (!hasVerifierCookie || reason === "pkce_verifier_missing") destination = "/login?error=browser";
      }
    } catch (error) { report("exception", error); }
  } else {
    report("missing_code", null);
  }
  const response = NextResponse.redirect(new URL(destination, request.url), 303);
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
