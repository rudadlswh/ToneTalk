import "server-only";

import {
  normalizeVariants,
  ollamaTranslationSchema,
  tones,
  type TranslationVariant,
} from "@/lib/translation-contract";
import { getLanguage, type TargetLanguage } from "@/lib/languages";
import { getEnv } from "@/server/env";

type OllamaChatResponse = {
  message?: { content?: string };
  total_duration?: number;
};

export class OllamaUnavailableError extends Error {}
export class OllamaOutputError extends Error {}

function buildPrompt(
  sourceText: string,
  targetLanguage: TargetLanguage,
  retry: boolean,
) {
  const target = getLanguage(targetLanguage);
  if (!target) throw new Error("Unsupported target language");

  return `Translate this English sentence into natural ${target.name} (${target.nativeName}).

All translatedText values MUST be written in ${target.name}, never English.
Do not reverse who is speaking or who performs the action. Preserve the exact meaning.
Return exactly five results in this order: ${tones.join(", ")}.

Tone definitions:
- casual: natural speech between friends
- polite: courteous everyday speech to a stranger
- formal: professional or official speech
- slang: natural colloquial speech used by close peers; avoid offensive language
- written: clear language appropriate for an email or written note

Rules: preserve meaning, tense, subject, negation, and certainty. Each tone should sound different. Return JSON only.${retry ? " A previous answer was invalid: do not copy the English source and check every result is in the target language." : ""}

Use exactly this JSON shape: {"casual":"...","polite":"...","formal":"...","slang":"...","written":"..."}

Source sentence:
${JSON.stringify(sourceText)}`;
}

async function callOllama(
  sourceText: string,
  targetLanguage: TargetLanguage,
  retry: boolean,
): Promise<OllamaChatResponse> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.OLLAMA_BASE_URL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: "json",
        keep_alive: "10m",
        options: { temperature: 0, num_predict: 800 },
        messages: [
          {
            role: "system",
            content:
              "You are a meticulous multilingual language coach. Follow the JSON schema exactly.",
          },
          { role: "user", content: buildPrompt(sourceText, targetLanguage, retry) },
        ],
      }),
    });

    if (!response.ok) {
      throw new OllamaUnavailableError(`Ollama returned ${response.status}`);
    }

    return (await response.json()) as OllamaChatResponse;
  } catch (error) {
    if (error instanceof OllamaUnavailableError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new OllamaUnavailableError("Ollama request timed out");
    }
    throw new OllamaUnavailableError("Could not reach Ollama");
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateTranslation(
  sourceText: string,
  targetLanguage: TargetLanguage,
): Promise<{
  sourceLanguage: string;
  variants: TranslationVariant[];
  latencyMs: number;
}> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callOllama(sourceText, targetLanguage, attempt > 0);
      if (!response.message?.content) {
        throw new OllamaOutputError("Ollama returned an empty response");
      }

      const parsedJson = JSON.parse(response.message.content) as unknown;
      const parsed = ollamaTranslationSchema.parse(parsedJson);
      const variants = normalizeVariants(parsed);
      if (!variants.every((variant) => looksLikeTargetLanguage(variant.translatedText, sourceText, targetLanguage))) {
        throw new OllamaOutputError("The model copied the source or used the wrong language");
      }
      return {
        sourceLanguage: "en",
        variants,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (error instanceof OllamaUnavailableError) throw error;
      lastError = error;
      console.warn("ollama_output_invalid", {
        attempt: attempt + 1,
        reason: error instanceof Error ? error.message : "unknown output error",
      });
    }
  }

  throw new OllamaOutputError(
    lastError instanceof Error ? lastError.message : "Invalid Ollama output",
  );
}

function looksLikeTargetLanguage(
  translatedText: string,
  sourceText: string,
  targetLanguage: TargetLanguage,
) {
  const normalizedTranslation = translatedText.trim().toLocaleLowerCase();
  const normalizedSource = sourceText.trim().toLocaleLowerCase();
  if (normalizedTranslation === normalizedSource) return false;
  if (targetLanguage === "ko") return /[\uac00-\ud7af]/u.test(translatedText);
  if (targetLanguage === "ja") return /[\u3040-\u30ff\u3400-\u9fff]/u.test(translatedText);
  if (targetLanguage === "zh-CN") return /[\u3400-\u9fff]/u.test(translatedText);
  return true;
}

export async function checkOllama() {
  const env = getEnv();
  const response = await fetch(`${env.OLLAMA_BASE_URL}/api/tags`, {
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return false;
  const data = (await response.json()) as { models?: { name?: string }[] };
  return Boolean(data.models?.some((model) => model.name === env.OLLAMA_MODEL));
}
