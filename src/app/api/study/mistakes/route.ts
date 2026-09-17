import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { dailyAttemptInputSchema } from "@/lib/daily-ai-practice";
import { mistakeQuerySchema } from "@/lib/mistake-review";
import { studyPointsAccountHeader } from "@/lib/study-points";
import { getAuthenticatedUser, withAuth } from "@/server/auth";
import { listMistakes, submitMistakeReview, MistakeReviewError } from "@/server/mistake-review";
import { PayloadTooLargeError, readLimitedJson } from "@/server/request-body";
import { consumeRateLimit } from "@/server/rate-limit";

export const runtime = "nodejs";
export const GET = withAuth(handle);
export const POST = withAuth(handle);

async function handle(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const user = await getAuthenticatedUser();
    const account = request.headers.get(studyPointsAccountHeader);
    if (account !== null && account !== user.id) return jsonError(requestId, 403, "ACCOUNT_CHANGED", "복습을 시작한 계정으로 다시 로그인해 주세요.");
    if (request.method === "GET") {
      const query = mistakeQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
      return Response.json({ ...await listMistakes(query), requestId });
    }
    const input = dailyAttemptInputSchema.parse(await readLimitedJson(request, 2048));
    const rate = consumeRateLimit(`mistake-review:${user.id}`, 60);
    if (!rate.allowed) {
      const response = jsonError(requestId, 429, "RATE_LIMITED", "잠시 후 복습 답안을 다시 저장해 주세요.", true);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds)); return response;
    }
    return Response.json({ ...await submitMistakeReview(input), requestId });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
    if (error instanceof ZodError || error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_INPUT", "복습 요청 형식을 확인해 주세요.");
    if (error instanceof MistakeReviewError) return jsonError(requestId, error.status, error.code, error.message);
    console.error("mistake_review_failed", { requestId });
    return jsonError(requestId, 500, "MISTAKE_REVIEW_FAILED", "오답 기록을 불러오거나 저장하지 못했어요. 다시 시도해 주세요.", true);
  }
}
