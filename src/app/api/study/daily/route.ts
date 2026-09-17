import { getRequestId } from "@/server/diagnostics";
import { ZodError } from "zod";
import { withAuth, getAuthenticatedUser } from "@/server/auth";
import { aiErrorResponse } from "@/server/ai-error";
import { consumeRateLimit } from "@/server/rate-limit";
import { InferenceBusyError } from "@/server/inference-limit";
import { PayloadTooLargeError, readLimitedJson } from "@/server/request-body";
import { withRequestBudget } from "@/server/request-budget";
import { DailyPracticeError, ensureDailyPractice, getDailyPractice, submitDailyAnswer } from "@/server/daily-practice";
import { jsonError } from "@/lib/api";
import { dailyAttemptInputSchema, dailyInputSchema, dailyKindSchema, practiceSourceSchema } from "@/lib/daily-ai-practice";
import { studyPointsAccountHeader } from "@/lib/study-points";

export const runtime = "nodejs";
export const maxDuration = 180;

async function assertAccount(request: Request) {
  const user = await getAuthenticatedUser();
  const expected = request.headers.get(studyPointsAccountHeader);
  if (expected !== null && expected !== user.id) throw new DailyPracticeError(403, "ACCOUNT_CHANGED", "학습한 계정으로 다시 로그인해 주세요.");
  return user.id;
}
function failure(error: unknown, requestId: string, generating = false) {
  if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
  if (error instanceof ZodError || error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_INPUT", "문제 요청 형식을 확인해 주세요.");
  if (error instanceof DailyPracticeError) {
    const response = jsonError(requestId, error.status, error.code, error.message, error.status === 409);
    if (error.code === "DAILY_GENERATING") response.headers.set("Retry-After", "3");
    return response;
  }
  const aiFailure = aiErrorResponse(error, requestId);
  if (aiFailure) return aiFailure;
  if (error instanceof InferenceBusyError) return jsonError(requestId, 503, "AI_BUSY", "AI가 다른 요청을 처리하고 있어요. 잠시 후 다시 시도해 주세요.", true);
  console.error("daily_practice_failed", { requestId, generating });
  return jsonError(requestId, generating ? 502 : 500, "DAILY_REQUEST_FAILED", generating ? "문제를 만들거나 저장하지 못했어요. 잠시 후 다시 시도해 주세요." : "학습 기록을 저장하거나 불러오지 못했어요. 다시 시도해 주세요.", true);
}

export const GET = withAuth(async request => {
  const requestId = getRequestId();
  try {
    await assertAccount(request);
    const kind = dailyKindSchema.parse(new URL(request.url).searchParams.get("kind"));
    const source = practiceSourceSchema.parse(new URL(request.url).searchParams.get("source") ?? "daily");
    return Response.json({ practice: await getDailyPractice(kind, source), requestId });
  } catch (error) { return failure(error, requestId); }
});

export const POST = withAuth(request => withRequestBudget(request, async () => {
  const requestId = getRequestId();
  try {
    const ownerId = await assertAccount(request);
    // Accept old clients' bounded exclude field, but only trust DB history.
    const { kind, source } = dailyInputSchema.parse(await readLimitedJson(request, 64_000));
    const existing = await getDailyPractice(kind, source);
    if (existing) return Response.json({ ...existing, requestId });
    if (!consumeRateLimit(`daily-practice:${ownerId}`, 4, 60_000).allowed) {
      const response = jsonError(requestId, 429, "RATE_LIMITED", "잠시 후 새 문제를 요청해 주세요.", true);
      response.headers.set("Retry-After", "60"); return response;
    }
    return Response.json({ ...await ensureDailyPractice(kind, source), requestId });
  } catch (error) { return failure(error, requestId, true); }
}));

export const PUT = withAuth(async request => {
  const requestId = getRequestId();
  try {
    const ownerId = await assertAccount(request);
    const input = dailyAttemptInputSchema.parse(await readLimitedJson(request, 2048));
    if (!consumeRateLimit(`daily-answer:${ownerId}`, 60).allowed) {
      const response = jsonError(requestId, 429, "RATE_LIMITED", "잠시 후 답안 저장을 다시 시도해 주세요.", true);
      response.headers.set("Retry-After", "60"); return response;
    }
    return Response.json({ ...await submitDailyAnswer(input), requestId });
  } catch (error) { return failure(error, requestId); }
});
