import "server-only";
import { getEnv } from "@/server/env";

export class GeminiError extends Error {
  override name = "GeminiError";
  constructor(public status: number, public code: string, message: string) { super(message); }
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
  try {
    const response = await fetch(`${endpoint()}:generateContent`, {
      method: "POST", cache: "no-store",
      headers: { "Content-Type": "application/json", "x-goog-api-key": getEnv().GEMINI_API_KEY! },
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
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
      if (response.status === 429) throw new GeminiError(429, "AI_QUOTA_EXCEEDED", "Gemini 무료 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.");
      throw new GeminiError(503, "GEMINI_UNAVAILABLE", "Gemini 연결 설정 또는 서비스 상태를 확인해 주세요.");
    }
    const data = await response.json();
    const candidate = data.candidates?.[0];
    if (candidate?.finishReason !== "STOP") throw new GeminiError(502, "INVALID_MODEL_OUTPUT", "AI 답변이 차단되었거나 끝까지 생성되지 않았어요. 입력을 짧게 바꿔 주세요.");
    const content = candidate.content?.parts?.filter((p: { thought?: boolean; text?: string }) => !p.thought).map((p: { text?: string }) => p.text ?? "").join("");
    if (!content) throw new GeminiError(502, "INVALID_MODEL_OUTPUT", "AI가 빈 답변을 반환했어요.");
    return Response.json({ message: { content } });
  } catch (error) {
    if (error instanceof GeminiError) throw error;
    throw new GeminiError(503, "GEMINI_UNAVAILABLE", "Gemini 응답을 받지 못했어요. 연결 또는 응답 시간을 확인해 주세요.");
  }
}

// Metadata availability only; does not generate text or guarantee remaining quota.
export async function checkGemini() {
  const response = await fetch(endpoint(), { headers: { "x-goog-api-key": getEnv().GEMINI_API_KEY! }, cache: "no-store", signal: AbortSignal.timeout(5_000) });
  return response.ok;
}
