// Node >=22.18 (native TypeScript): node --env-file=.env.local scripts/benchmark-ollama.mjs
// Sequential real-model benchmark. Never downloads models or prints credentials.
import { buildPrompt } from "../src/lib/translation-prompt.ts";
import { translationFormat } from "../src/lib/translation-format.ts";

const base = process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434";
const headers = { "Content-Type": "application/json", "ngrok-skip-browser-warning": "1" };
if (process.env.OLLAMA_BASIC_AUTH_USERNAME && process.env.OLLAMA_BASIC_AUTH_PASSWORD) {
  headers.Authorization = `Basic ${Buffer.from(`${process.env.OLLAMA_BASIC_AUTH_USERNAME}:${process.env.OLLAMA_BASIC_AUTH_PASSWORD}`).toString("base64")}`;
}
const models = process.argv.slice(2).length ? process.argv.slice(2) : ["qwen2.5:1.5b", "qwen2.5:14b"];
const tones = ["casual", "polite", "formal", "slang", "written"];
const format = process.env.BENCH_LEGACY_JSON === "1" ? "json" : translationFormat;
const installed = await fetch(new URL("/api/tags", base), { headers, signal: AbortSignal.timeout(10_000) }).then((res) => res.json());
const loaded = await fetch(new URL("/api/ps", base), { headers, signal: AbortSignal.timeout(10_000) }).then((res) => res.json());
if (loaded.models?.length) throw new Error("A model is already loaded; stop the benchmark to avoid disrupting existing work. Retry after it unloads.");
for (const model of models) {
  if (!installed.models?.some((item) => item.name === model)) throw new Error(`Model is not installed: ${model}`);
  try {
    for (let trial = 0; trial < 2; trial++) {
      const started = performance.now();
      try {
        const response = await fetch(new URL("/api/chat", base), {
          method: "POST", headers, signal: AbortSignal.timeout(150_000),
          body: JSON.stringify({ model, stream: false, format, keep_alive: "2m", options: { temperature: 0, num_predict: 1600, num_ctx: 4096 }, messages: [
            { role: "system", content: "You are a meticulous multilingual language coach. Follow the JSON schema exactly." },
            { role: "user", content: buildPrompt("Could you help me?", "en", "ja") },
          ] }),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const result = await response.json();
        let output, validShape = false;
        try { output = JSON.parse(result.message?.content); validShape = output.sourceLanguage === "en" && tones.every((tone) => output[tone]?.translatedText && output[tone]?.romanization && output[tone]?.hangulPronunciation); } catch { output = result.message?.content; }
        console.log(JSON.stringify({ model, format: typeof format === "string" ? "json" : "schema", trial: trial === 0 ? "cold" : "warm", wallMs: Math.round(performance.now() - started), loadMs: Math.round((result.load_duration || 0) / 1e6), promptTokens: result.prompt_eval_count, outputTokens: result.eval_count, tokensPerSecond: result.eval_duration ? +(result.eval_count / (result.eval_duration / 1e9)).toFixed(2) : null, validShape, hangulValid: validShape && tones.every((tone) => /^[가-힣0-9 .,!?'-]+$/.test(output[tone].hangulPronunciation) && /[가-힣]/.test(output[tone].hangulPronunciation)), output }));
        const running = await fetch(new URL("/api/ps", base), { headers, signal: AbortSignal.timeout(5000) }).then((res) => res.json());
        console.log(JSON.stringify({ model, loaded: running.models?.map((item) => ({ name: item.name, size: item.size, size_vram: item.size_vram, context_length: item.context_length })) }));
      } catch (error) {
        console.log(JSON.stringify({ model, trial, wallMs: Math.round(performance.now() - started), error: error.message }));
        break;
      }
    }
  } finally {
    await fetch(new URL("/api/generate", base), { method: "POST", headers, signal: AbortSignal.timeout(10_000), body: JSON.stringify({ model, keep_alive: 0 }) }).catch(() => {});
  }
}
