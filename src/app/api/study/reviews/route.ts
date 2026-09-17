import { getRequestId, logFailure } from "@/server/diagnostics";
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";
import { z, ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { studyRatings } from "@/lib/study-schedule";
import { getStudySummary, reviewStudyItem } from "@/server/study";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const POST = withAuth(handlePOST);

const reviewSchema = z.object({
  savedPhraseId: z.string().uuid(),
  rating: z.enum(studyRatings),
});

async function handlePOST(request: Request) {
  const requestId = getRequestId();
  try {
    const input = reviewSchema.parse(await readLimitedJson(request, 4096));
    const progress = await reviewStudyItem(input.savedPhraseId, input.rating);
    if (!progress) {
      return jsonError(requestId, 404, "NOT_FOUND", "복습할 저장 문장을 찾지 못했습니다.");
    }
    const summary = await getStudySummary();
    return Response.json(
      { progress, summary, requestId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
    if (error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_JSON", "올바른 JSON 본문을 보내 주세요.");
    if (error instanceof ZodError) {
      return jsonError(requestId, 400, "VALIDATION_ERROR", "복습 평가를 확인해 주세요.");
    }
    logFailure("study_review_failed", requestId, error);
    return jsonError(requestId, 500, "INTERNAL_ERROR", "복습 결과를 저장하지 못했습니다.", true);
  }
}
