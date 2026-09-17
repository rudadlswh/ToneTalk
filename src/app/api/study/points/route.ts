import { getRequestId } from "@/server/diagnostics";
import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { parseStudyPointsCursor, studyPointInputSchema, studyPointsAccountHeader } from "@/lib/study-points";
import { getAuthenticatedUser, withAuth } from "@/server/auth";
import { consumeRateLimit } from "@/server/rate-limit";
import { PayloadTooLargeError, readLimitedJson } from "@/server/request-body";
import { awardStudyPoints, listStudyPoints } from "@/server/study-points";

export const runtime = "nodejs";

async function accountChanged(request: Request) {
  const expected = request.headers.get(studyPointsAccountHeader);
  // Older non-queued clients remain compatible. New outbox clients always send
  // this assertion, closing the cookie-switch race after the session preflight.
  return expected !== null && expected !== (await getAuthenticatedUser()).id;
}

export const GET = withAuth(async (request) => {
  const requestId = getRequestId();
  try {
    if (await accountChanged(request)) return jsonError(requestId, 403, "ACCOUNT_CHANGED", "학습한 계정으로 다시 로그인해 주세요. 미저장 포인트는 보관됩니다.");
    const cursor = parseStudyPointsCursor(new URL(request.url).searchParams.get("cursor"));
    return Response.json({ ...await listStudyPoints(cursor), requestId });
  } catch (error) {
    if (error instanceof ZodError) return jsonError(requestId, 400, "VALIDATION_ERROR", "적립 기록의 조회 위치를 확인해 주세요.");
    console.error("study_points_read_failed", { requestId });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "포인트 적립 기록을 불러오지 못했습니다.", true);
  }
});

export const POST = withAuth(async (request) => {
  const requestId = getRequestId();
  try {
    if (await accountChanged(request)) return jsonError(requestId, 403, "ACCOUNT_CHANGED", "학습한 계정으로 다시 로그인해 주세요. 미저장 포인트는 보관됩니다.");
    const input = studyPointInputSchema.parse(await readLimitedJson(request, 2048));
    const user = await getAuthenticatedUser();
    if (!consumeRateLimit(`study-points:${user.id}`, 60).allowed) {
      const response = jsonError(requestId, 429, "RATE_LIMITED", "잠시 후 포인트 저장을 다시 시도해 주세요.", true);
      response.headers.set("Retry-After", "60");
      return response;
    }
    const result = await awardStudyPoints(input);
    if (!result) return jsonError(requestId, 409, "POINTS_PROOF_REQUIRED", "서버에서 확인한 풀이·대화 완료 기록이 필요해요. 이전 미저장 요청은 자동 적립할 수 없으며 삭제하지 않고 보관합니다. 새 학습을 시작해 주세요.");
    return Response.json({ ...result, requestId });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
    if (error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_JSON", "올바른 JSON 본문을 보내 주세요.");
    if (error instanceof ZodError) return jsonError(requestId, 400, "VALIDATION_ERROR", "포인트 적립 요청을 확인해 주세요.");
    console.error("study_points_write_failed", { requestId });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "포인트를 저장하지 못했습니다. 다시 저장해 주세요.", true);
  }
});
