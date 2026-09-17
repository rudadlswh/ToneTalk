import { withAuth, getAuthenticatedUser } from "@/server/auth";
import { getAiUsage } from "@/server/ai-usage";
import { aiErrorResponse } from "@/server/ai-error";
import { jsonError } from "@/lib/api";
import { studyPointsAccountHeader } from "@/lib/study-points";

export const runtime = "nodejs";
export const GET = withAuth(async request => {
  const requestId = crypto.randomUUID();
  try {
    const expected = request.headers.get(studyPointsAccountHeader);
    if (expected !== null && expected !== (await getAuthenticatedUser()).id) return jsonError(requestId, 403, "ACCOUNT_CHANGED", "현재 로그인 계정이 바뀌었어요. 새로고침해 주세요.");
    return Response.json({ ...await getAiUsage(), requestId });
  } catch (error) {
    return aiErrorResponse(error, requestId) ?? jsonError(requestId, 503, "AI_USAGE_UNAVAILABLE", "사용량 정보를 불러오지 못했어요.", true);
  }
});
