import { ZodError } from "zod";
import { jsonError } from "@/lib/api";
import { lyricsRequestSchema } from "@/lib/lyrics-contract";
import { lyricExplanationRequestSchema } from "@/lib/lyric-explanation";
import { generateLyrics, generateLyricExplanation, OllamaOutputError, OllamaUnavailableError } from "@/server/ollama";
import { consumeRateLimit } from "@/server/rate-limit";
import { withRequestBudget, requestSignal } from "@/server/request-budget";
import { withInferenceSlot, InferenceBusyError } from "@/server/inference-limit";
import { readLimitedJson, PayloadTooLargeError } from "@/server/request-body";

export const runtime = "nodejs";
export const maxDuration = 180;

export async function POST(request: Request) {
  return withRequestBudget(request, () => handlePost(request));
}

async function handlePost(request: Request) {
  const requestId = crypto.randomUUID();
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return jsonError(requestId, 403, "INVALID_ORIGIN", "같은 사이트에서 요청해 주세요.");
  const rate = consumeRateLimit(`lyrics:${request.headers.get("x-forwarded-for") ?? "single-user"}`, 30);
  if (!rate.allowed) return jsonError(requestId, 429, "RATE_LIMITED", `${rate.retryAfterSeconds}초 후 이어서 번역해 주세요.`, true);
  try {
    const body = await readLimitedJson(request, 6000);
    if (body && typeof body === "object" && "action" in body && body.action === "explain") {
      const input = lyricExplanationRequestSchema.parse(body);
      const explanation = await withInferenceSlot(() => generateLyricExplanation(input, requestSignal() ?? request.signal));
      return Response.json({ explanation, requestId }, { headers: { "Cache-Control": "no-store" } });
    }
    const input = lyricsRequestSchema.parse(body);
    const result = await withInferenceSlot(() => generateLyrics(input, requestSignal() ?? request.signal));
    return Response.json({ ...result, requestId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return jsonError(requestId, 413, "PAYLOAD_TOO_LARGE", "가사를 더 짧게 나눠 주세요.");
    if (error instanceof InferenceBusyError) {
      const response = jsonError(requestId, 429, "AI_BUSY", "AI가 다른 요청을 처리 중이에요. 잠시 후 이어서 번역해 주세요.", true);
      response.headers.set("Retry-After", "10");
      return response;
    }
    if (error instanceof SyntaxError || error instanceof ZodError) return jsonError(requestId, 400, "INVALID_INPUT", "언어와 가사를 확인해 주세요. 한 번에 최대 2줄, 줄당 200자까지 번역할 수 있어요.");
    if (error instanceof OllamaOutputError) return jsonError(requestId, 502, "INVALID_MODEL_OUTPUT", "AI가 번역·발음을 올바른 형식으로 반환하지 못했어요. 이어서 번역을 눌러 다시 시도해 주세요.", true);
    if (error instanceof OllamaUnavailableError) return jsonError(requestId, 503, "OLLAMA_UNAVAILABLE", "AI 연결 또는 응답 시간이 초과됐어요. 완료된 줄은 유지됩니다. 잠시 후 이어서 번역해 주세요.", true);
    console.error("lyrics_failed", { requestId, errorType: error instanceof Error ? error.name : "unknown" });
    return jsonError(requestId, 500, "INTERNAL_ERROR", "가사를 번역하지 못했어요.", true);
  }
}
