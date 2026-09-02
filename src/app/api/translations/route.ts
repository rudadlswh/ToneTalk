import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { translateRequestSchema } from "@/lib/translation-contract";
import {
  OllamaOutputError,
  OllamaUnavailableError,
} from "@/server/ollama";
import { consumeRateLimit } from "@/server/rate-limit";
import { createTranslation } from "@/server/translations";

export const runtime = "nodejs";

export async function POST(request: Request) {
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
    const input = translateRequestSchema.parse(await request.json());
    const session = await createTranslation(
      input.sourceText,
      input.targetLanguage,
    );
    return Response.json(
      { session, requestId },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
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
