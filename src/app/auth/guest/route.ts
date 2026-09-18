import { NextResponse } from "next/server";
import { safeAuthNext } from "@/lib/auth-navigation";
import { logFailure } from "@/server/diagnostics";
import { isGuestMode } from "@/server/guest-mode";
import { createAuthClient } from "@/server/supabase-auth";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const next = safeAuthNext(url.searchParams.get("next"));
  if (!isGuestMode()) return NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(next)}`, url));
  try {
    const client = await createAuthClient();
    await client.auth.signOut({ scope: "local" });
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.session || !data.user?.is_anonymous) throw error ?? new Error("Anonymous session missing");
    return NextResponse.redirect(new URL(next, url));
  } catch (error) {
    logFailure("guest_sign_in_failed", crypto.randomUUID(), error);
    return new Response("게스트 체험을 시작하지 못했습니다. 잠시 후 다시 시도해 주세요.", {
      status: 503,
      headers: { "Cache-Control": "private, no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
