import { ZodError } from "zod";
import { aiErrorResponse } from "@/server/ai-error";
import { jsonError } from "@/lib/api";
import { chatStartSchema, chatTurnSchema } from "@/lib/study-chat";
import { startStudyChat, submitStudyChat, StudyChatError } from "@/server/study-chat";
import { OllamaOutputError, OllamaUnavailableError } from "@/server/ollama";
import { consumeRateLimit } from "@/server/rate-limit";
import { withRequestBudget, requestSignal } from "@/server/request-budget";
import { InferenceBusyError } from "@/server/inference-limit";
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";

import { getAuthenticatedUser, withAuth } from "@/server/auth";
import { studyPointsAccountHeader } from "@/lib/study-points";

export const runtime = "nodejs";
export const POST = withAuth(handlePOST);
export const PUT = withAuth(handlePOST);
export const maxDuration = 180;

async function handlePOST(request: Request) {
  return withRequestBudget(request, () => handlePost(request));
}

async function handlePost(request: Request) {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return jsonError(requestId, 403, "INVALID_ORIGIN", "같은 사이트에서 요청해 주세요.");
  }
  const key = `study-chat:${request.headers.get("x-forwarded-for") ?? "single-user"}`;
  const rate = consumeRateLimit(key, 6);
  if (!rate.allowed) {
    const response = jsonError(requestId, 429, "RATE_LIMITED", `${rate.retryAfterSeconds}초 후 다시 시도해 주세요.`, true);
    response.headers.set("Retry-After", String(rate.retryAfterSeconds));
    return response;
  }

  try {
    const account = request.headers.get(studyPointsAccountHeader);
    if (account !== null && account !== (await getAuthenticatedUser()).id) return jsonError(requestId, 403, "ACCOUNT_CHANGED", "대화를 시작한 계정으로 다시 로그인해 주세요.");
    const body = await readLimitedJson(request, 24_000);
    const result = request.method === "PUT" ? await startStudyChat(chatStartSchema.parse(body))
      : await submitStudyChat(chatTurnSchema.parse(body), requestSignal() ?? request.signal);
    return Response.json({ ...result, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudyChatError) {
      const response = jsonError(requestId, error.status, error.code, error.message, error.code === "CHAT_BUSY" || error.status === 429);
      if (error.code === "CHAT_BUSY" || error.status === 429) response.headers.set("Retry-After", error.status === 429 ? "60" : "3");
      return response;
    }
    const aiFailure = aiErrorResponse(error, requestId);
    if (aiFailure) return aiFailure;
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "대화가 너무 깁니다. 새 대화를 시작해 주세요.");
    if (error instanceof InferenceBusyError) {
      const response = jsonError(requestId, 429, "AI_BUSY", "AI가 다른 요청을 처리 중이에요. 잠시 후 다시 보내 주세요.", true);
      response.headers.set("Retry-After", "10");
      return response;
    }
    if (error instanceof ZodError || error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_INPUT", "대화 내용과 언어를 확인해 주세요.");
    if (error instanceof OllamaUnavailableError) return jsonError(requestId, 503, "OLLAMA_UNAVAILABLE", "AI 응답을 받지 못했어요. Ollama 연결을 확인하거나 다시 시도해 주세요.", true);
    if (error instanceof OllamaOutputError) return jsonError(requestId, 502, "INVALID_MODEL_OUTPUT", "AI 답변 형식을 정리하지 못했어요. 다시 시도해 주세요.", true);
    console.error("study_chat_failed", { requestId, errorType: error instanceof Error ? error.name : "unknown" });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "대화를 진행하지 못했어요.", true);
  }
}
