import { ZodError } from "zod";
import { aiErrorResponse } from "@/server/ai-error";
import { jsonError } from "@/lib/api";
import { translateRequestSchema } from "@/lib/translation-contract";
import {
  OllamaOutputError,
  OllamaUnavailableError,
  SameLanguageError,
} from "@/server/ollama";
import { consumeRateLimit } from "@/server/rate-limit";
import { createTranslation } from "@/server/translations";
import { withRequestBudget } from "@/server/request-budget";
import { InferenceBusyError } from "@/server/inference-limit";
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const POST = withAuth(handlePOST);
export const maxDuration = 180;

async function handlePOST(request: Request) {
  return withRequestBudget(request, () => handlePost(request));
}

async function handlePost(request: Request) {
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 10_000) {
    return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.");
  }
  const clientKey = request.headers.get("x-forwarded-for") ?? "local-single-user";
  const rateLimit = consumeRateLimit(clientKey);

  if (!rateLimit.allowed) {
    return jsonError(
      requestId,
      429,
      "RATE_LIMITED",
      `${rateLimit.retryAfterSeconds}초 후 다시 시도해 주세요.`,
      true,
    );
  }

  try {
    const input = translateRequestSchema.parse(await readLimitedJson(request, 10_000));
    const session = await createTranslation(
      input.sourceText,
      input.sourceLanguage,
      input.targetLanguage,
    );
    return Response.json(
      { session, requestId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const aiFailure = aiErrorResponse(error, requestId);
    if (aiFailure) return aiFailure;
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 크기가 너무 큽니다.");
    if (error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_INPUT", "입력값을 확인해 주세요.");
    if (error instanceof InferenceBusyError) {
      const response = jsonError(requestId, 429, "AI_BUSY", "AI가 다른 요청을 처리 중이에요. 잠시 후 다시 시도해 주세요.", true);
      response.headers.set("Retry-After", "10");
      return response;
    }
    if (error instanceof ZodError) {
      return jsonError(
        requestId,
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "입력값을 확인해 주세요.",
      );
    }
    if (error instanceof OllamaUnavailableError) {
      return jsonError(
        requestId,
        503,
        "OLLAMA_UNAVAILABLE",
        "로컬 번역 모델에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요.",
        true,
      );
    }
    if (error instanceof SameLanguageError) {
      return jsonError(
        requestId,
        422,
        "SAME_LANGUAGE",
        "감지된 입력 언어와 번역 언어가 같습니다. 번역 언어를 바꿔 주세요.",
      );
    }
    if (error instanceof OllamaOutputError) {
      return jsonError(
        requestId,
        502,
        "INVALID_MODEL_OUTPUT",
        "번역 결과를 정리하지 못했습니다. 다시 시도해 주세요.",
        true,
      );
    }
    console.error("translation_failed", { requestId, error });
    return jsonError(
      requestId,
      500,
      "INTERNAL_ERROR",
      "번역을 완료하지 못했습니다.",
      true,
    );
  }
}
