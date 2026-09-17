// One synthetic translation only. No DB, private user text, retries or fallback.
// Use an AI Studio project without billing for free-tier-only testing.
import { buildPrompt } from "../src/lib/translation-prompt.ts";
import { translationFormat } from "../src/lib/translation-format.ts";

if (!process.env.GEMINI_API_KEY) throw new Error("GEMINI_API_KEY is required");
const model = "gemini-3.1-flash-lite";
const started = performance.now();
const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
  signal: AbortSignal.timeout(30000),
  body: JSON.stringify({
    systemInstruction: { parts: [{ text: "You are a meticulous multilingual language coach. Follow the JSON schema exactly." }] },
    contents: [{ role: "user", parts: [{ text: buildPrompt("Could you help me?", "en", "ja") }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 1600, responseMimeType: "application/json", responseJsonSchema: translationFormat, thinkingConfig: { thinkingLevel: "minimal" } },
  }),
});
const data = await response.json();
if (!response.ok) {
  // Do not dump upstream messages or request headers: they may contain secrets.
  console.log(JSON.stringify({ model, status: response.status, code: data.error?.status, elapsedMs: Math.round(performance.now() - started) }));
  process.exitCode = 1;
} else {
  const candidate = data.candidates?.[0];
  const text = candidate?.content?.parts?.filter((part) => !part.thought).map((part) => part.text ?? "").join("");
  console.log(JSON.stringify({ model, elapsedMs: Math.round(performance.now() - started), finishReason: candidate?.finishReason, usage: data.usageMetadata, output: text ? JSON.parse(text) : null }, null, 2));
}
