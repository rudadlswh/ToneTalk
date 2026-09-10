import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";
import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { ttsRequestSchema } from "@/lib/tts-contract";
import { consumeRateLimit } from "@/server/rate-limit";
import {
  LocalTtsUnavailableError,
  synthesizeLocalSpeech,
} from "@/server/tts";

import { withAuth } from "@/server/auth";

export const runtime = "nodejs";
export const POST = withAuth(handlePOST);

async function handlePOST(request: Request) {
  const requestId = crypto.randomUUID();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 5_000) {
    return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "읽을 문장이 너무 깁니다.");
  }

  const clientKey = `tts:${request.headers.get("x-forwarded-for") ?? "local-single-user"}`;
  const rateLimit = consumeRateLimit(clientKey, 30, 60_000);
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
    const input = ttsRequestSchema.parse(await readLimitedJson(request, 5000));
    const audio = await synthesizeLocalSpeech(input.text, input.language);
    return new Response(audio, {
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Type": "audio/mp4",
        "Content-Disposition": 'inline; filename="speech.m4a"',
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "요청 본문이 너무 큽니다.");
    if (error instanceof SyntaxError) return jsonError(requestId, 400, "INVALID_JSON", "올바른 JSON 본문을 보내 주세요.");
    if (error instanceof ZodError) {
      return jsonError(
        requestId,
        400,
        "VALIDATION_ERROR",
        error.issues[0]?.message ?? "음성 요청을 확인해 주세요.",
      );
    }
    if (error instanceof LocalTtsUnavailableError) {
      console.error("local_tts_unavailable", { requestId });
      return jsonError(
        requestId,
        503,
        "LOCAL_TTS_UNAVAILABLE",
        "로컬 음성을 만들지 못했습니다.",
        true,
      );
    }
    console.error("tts_failed", { requestId, error });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "음성을 만들지 못했습니다.", true);
  }
}
