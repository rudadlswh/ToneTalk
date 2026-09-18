import "server-only";
import { getEnv } from "@/server/env";
import { AiServiceError, retryAfterSeconds } from "@/server/ai-error";
import { getRequestId } from "@/server/diagnostics";

export class GeminiError extends AiServiceError {
  override name = "GeminiError";
}

type ChatRequest = {
  messages: { role: string; content: string }[];
  format: unknown;
  options: { temperature: number; num_predict: number };
};

type UsageMetadata = {
  promptTokenCount?: number;
  cachedContentTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  totalTokenCount?: number;
  serviceTier?: string;
};

function endpoint() {
  return `https://generativelanguage.googleapis.com/v1beta/models/${getEnv().GEMINI_MODEL}`;
}

function apiKeys() {
  const env = getEnv();
  const configured = env.GEMINI_API_KEYS?.split(",").map(value => value.trim()).filter(Boolean);
  return [...new Set(configured?.length ? configured : [env.GEMINI_API_KEY!])];
}

function keyIndexForRequest(requestId: string, keyCount: number) {
  let hash = 2166136261;
  for (let index = 0; index < requestId.length; index += 1) {
    hash = Math.imul(hash ^ requestId.charCodeAt(index), 16777619);
  }
  return (hash >>> 0) % keyCount;
}

async function keyFailure(response: Response) {
  if ([401, 403, 429].includes(response.status)) return true;
  if (response.status !== 400) return false;
  try {
    const payload = await response.clone().json() as { error?: { details?: Array<{ reason?: string }> } };
    return payload.error?.details?.some(detail => detail.reason?.startsWith("API_KEY_")) ?? false;
  } catch { return false; }
}

function providerError(response: Response) {
  if (response.status === 429) {
    const wait = retryAfterSeconds(response.headers.get("retry-after"));
    return new GeminiError(429, "AI_QUOTA_EXCEEDED", "등록된 Gemini 프로젝트의 사용 한도에 도달했어요. 잠시 후 다시 시도해 주세요.", wait, wait);
  }
  if ([400, 401, 403, 404].includes(response.status)) return new GeminiError(503, "AI_CONFIGURATION_ERROR", "AI 연결 설정을 확인해야 해요. 관리자에게 문의해 주세요.", 300, 300);
  return new GeminiError(503, "GEMINI_UNAVAILABLE", "Gemini 서비스가 응답하지 않아요. 잠시 후 다시 시도해 주세요.", 30, 30);
}

// Preserve the validated chat envelope. Rotate only key/quota failures; an
// ambiguous transport failure may already have generated output, so never retry it.
export async function postGemini(body: unknown, signal: AbortSignal): Promise<Response> {
  const input = body as ChatRequest;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(45_000)]);
  const requestId = getRequestId();
  const started = performance.now();
  try {
    deadline.throwIfAborted();
    const keys = apiKeys();
    const requestBody = JSON.stringify({
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
    });
    let response: Response | undefined;
    let usedKeyIndex = 0;
    let attempts = 0;
    const startIndex = keyIndexForRequest(requestId, keys.length);
    for (let offset = 0; offset < keys.length; offset += 1) {
      deadline.throwIfAborted();
      const index = (startIndex + offset) % keys.length;
      usedKeyIndex = index;
      attempts = offset + 1;
      response = await fetch(`${endpoint()}:generateContent`, {
        method: "POST", cache: "no-store",
        headers: { "Content-Type": "application/json", "x-goog-api-key": keys[index] },
        signal: deadline, body: requestBody,
      });
      if (response.ok) break;
      if (offset + 1 >= keys.length || !(await keyFailure(response))) throw providerError(response);
      console.warn("gemini_key_failover", {
        requestId, model: getEnv().GEMINI_MODEL, failedKeySlot: index + 1,
        nextKeySlot: ((index + 1) % keys.length) + 1, status: response.status,
      });
    }
    if (!response?.ok) throw providerError(response!);
    const data = await response.json();
    const usage = (data.usageMetadata ?? {}) as UsageMetadata;
    console.info("gemini_usage", {
      requestId, provider: "gemini", model: getEnv().GEMINI_MODEL,
      keySlot: usedKeyIndex + 1, configuredKeyCount: keys.length, attempts,
      promptTokens: usage.promptTokenCount ?? null,
      cachedTokens: usage.cachedContentTokenCount ?? null,
      outputTokens: usage.candidatesTokenCount ?? null,
      thoughtTokens: usage.thoughtsTokenCount ?? null,
      totalTokens: usage.totalTokenCount ?? null,
      serviceTier: usage.serviceTier ?? null,
      remainingTokens: null,
      remainingTokensReason: "not_provided_by_gemini_api",
      elapsedMs: Math.round(performance.now() - started),
    });
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
  const keys = apiKeys();
  const startIndex = keyIndexForRequest(getRequestId(), keys.length);
  for (let offset = 0; offset < keys.length; offset += 1) {
    const index = (startIndex + offset) % keys.length;
    const response = await fetch(endpoint(), { headers: { "x-goog-api-key": keys[index] }, cache: "no-store", signal: AbortSignal.timeout(5_000) });
    if (response.ok) return true;
    if (!(await keyFailure(response))) return false;
  }
  return false;
}
