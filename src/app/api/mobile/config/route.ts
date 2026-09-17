import { getAuthConfig } from "@/server/supabase-auth";
import { jsonError } from "@/lib/api";

export const runtime = "nodejs";
export async function GET() {
  try {
    const { url, key } = getAuthConfig();
    // Only the public Auth configuration; never database or AI secrets.
    return Response.json({ supabaseUrl: url, publishableKey: key,
      provider: process.env.AI_PROVIDER === "gemini" ? "gemini" : "ollama" },
      { headers: { "Cache-Control": "no-store" } });
  } catch {
    return jsonError(crypto.randomUUID(), 503, "AUTH_UNAVAILABLE", "로그인 설정을 불러오지 못했습니다.", true);
  }
}
