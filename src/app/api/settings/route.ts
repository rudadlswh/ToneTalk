import { getRequestId, logFailure } from "@/server/diagnostics";
import { jsonError } from "@/lib/api";
import { getSettings } from "@/server/settings";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const GET = withAuth(handleGET);
async function handleGET() {
  const requestId = getRequestId();
  try {
    return Response.json({ settings: await getSettings(), requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    logFailure("settings_failed", requestId, error);
    return jsonError(requestId, 503, "SETTINGS_UNAVAILABLE", "기본 설정을 불러오지 못했어요.", true);
  }
}
