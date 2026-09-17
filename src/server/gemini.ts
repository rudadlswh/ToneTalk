import "server-only";
import { getEnv } from "@/server/env";
import { AiServiceError, retryAfterSeconds } from "@/server/ai-error";

export class GeminiError extends AiServiceError {
  override name = "GeminiError";
}

type ChatRequest = {
  messages: { role: string; content: string }[];
  format: unknown;
  options: { temperature: number; num_predict: number };
};

function endpoint() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${getEnv().GEMINI_MODEL}`;
}

// Preserve the existing validated chat envelope. No retries or model fallback.
export async function postGemini(body: unknown, signal: AbortSignal): Promise<Response> {
  const input = body as ChatRequest;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  try {
    deadline.throwIfAborted();
    const response = await fetch(`${endpoint()}:generateContent`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-goog-api-key": getEnv().GEMINI_API_KEY! },
      signal: deadline,
      body: JSON.stringify({
        systemInstruction: { parts: input.messages.filter(m => m.role === "system").map(m => ({ text: m.content })) },
        contents: input.messages.filter(m => m.role !== "system").map(m => ({
          role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }],
        })),
        generationConfig: {
          temperature: input.options.temperature, maxOutputTokens: input.options.num_predict,
          responseMimeType: "application/json",
          ...(typeof input.format === "object" ? { responseJsonSchema: input.format } : {}),
          thinkingConfig: { thinkingLevel: "minimal" },
        },
      }),
    });
    if (!response.ok) {
      if (response.status === 429) {
        const wait = retryAfterSeconds(response.headers.get("retry-after"));
        throw new GeminiError(429, "AI_QUOTA_EXCEEDED", "Gemini 사용 한도에 도달했어요. 대기 후에도 계속되면 관리자에게 무료 등급 한도 확인을 요청해 주세요.", wait, wait);
      }
      if ([400, 401, 403, 404].includes(response.status)) throw new GeminiError(503, "AI_CONFIGURATION_ERROR", "AI 연결 설정을 확인해야 해요. 관리자에게 문의해 주세요.", 300, 300);
      throw new GeminiError(503, "GEMINI_UNAVAILABLE", "Gemini 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.", 30, 30);
    }
    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason !== "STOP") throw new GeminiError(502, "INVALID_MODEL_OUTPUT", "AI 답변이 차단되었거나 끝까지 생성되지 않았어요. 입력을 짧게 바꿔 주세요.");
    const content = candidate.content?.parts?.filter((p: { thought?: boolean; text?: string }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
    if (!content) throw new GeminiError(502, "INVALID_MODEL_OUTPUT", "AI가 빈 답변을 반환했어요.");
    return Response.json({ message: { content } });
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    if (signal.aborted) throw new GeminiError(499, "AI_CANCELLED", "AI 요청을 취소했어요.", 0, 0, true);
    if (deadline.aborted) throw new GeminiError(504, "AI_TIMEOUT", "AI 응답 시간이 초과됐어요. 입력을 유지했으니 잠시 후 다시 시도해 주세요.", 15, 15, true);
    throw new GeminiError(503, "GEMINI_UNAVAILABLE", "Gemini 응답을 받지 못했어요. 입력은 유지됩니다.", 30, 30, true);
  }
}

// Metadata availability only; does not generate text or guarantee remaining quota.
export async function checkGemini() {
  const response = await fetch(endpoint(), { headers: { "x-goog-api-key": getEnv().GEMINI_API_KEY! }, cache: "no-store", signal: AbortSignal.timeout(5_000) });
  return response.ok;
}
