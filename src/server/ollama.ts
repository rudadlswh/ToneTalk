import "server-only";

import {
  normalizeVariants,
  ollamaTranslationSchema,
  tones,
  type TranslationVariant,
} from "@/lib/translation-contract";
import {
  getLanguage,
  languageCodes,
  type LanguageCode,
  type SourceLanguage,
  type TargetLanguage,
} from "@/lib/languages";
import { getEnv } from "@/server/env";

type OllamaChatResponse = {
  message?: { content?: string };
  total_duration?: number;
};

export class OllamaUnavailableError extends Error {}
export class OllamaOutputError extends Error {}
export class SameLanguageError extends Error {}

function buildOllamaHeaders(includeJsonContentType = false) {
  const env = getEnv();
  const headers = new Headers({
    "ngrok-skip-browser-warning": "1",
  });

  if (includeJsonContentType) headers.set("Content-Type", "application/json");
  if (env.OLLAMA_BASIC_AUTH_USERNAME && env.OLLAMA_BASIC_AUTH_PASSWORD) {
    const credentials = Buffer.from(
      `${env.OLLAMA_BASIC_AUTH_USERNAME}:${env.OLLAMA_BASIC_AUTH_PASSWORD}`,
      "utf8",
    ).toString("base64");
    headers.set("Authorization", `Basic ${credentials}`);
  }

  return headers;
}

function buildOllamaUrl(path: string) {
  return new URL(path, getEnv().OLLAMA_BASE_URL).toString();
}

function buildPrompt(
  sourceText: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
  retry: boolean,
) {
  const target = getLanguage(targetLanguage);
  if (!target) throw new Error("Unsupported target language");
  const source = sourceLanguage === "auto" ? null : getLanguage(sourceLanguage);
  const sourceInstruction = source
    ? `The source language is ${source.name} (${source.nativeName}), code ${source.code}.`
    : `Detect the source language and return exactly one of these codes: ${languageCodes.join(", ")}.`;

  return `${sourceInstruction}
Translate the source sentence into natural ${target.name} (${target.nativeName}).

Set sourceLanguage to the detected or provided source language code.
Every translatedText value MUST be written in ${target.name}.
Do not reverse who is speaking or who performs the action. Preserve the exact meaning.
Return exactly five results in this order: ${tones.join(", ")}.

Tone definitions:
- casual: natural speech between friends
- polite: courteous everyday speech to a stranger
- formal: professional or official speech
- slang: natural colloquial speech used by close peers; avoid offensive language
- written: clear language appropriate for an email or written note

Pronunciation rules for every result:
- romanization: write the actual spoken reading of translatedText using Latin letters only. Do not translate it, use IPA symbols, or copy Hangul, Kana, Hanzi, or Kanji.
- hangulPronunciation: write a natural Korean Hangul approximation of the actual spoken reading. Use Hangul, spaces, numbers, and punctuation only; never mix in Latin letters, Kana, Hanzi, or Kanji.
- Pronounce each word as used in the complete sentence. For Japanese Kanji and Chinese Hanzi, use the contextually correct word reading instead of guessing from individual characters.
- Return both pronunciation values even when the target language already uses Latin letters or Hangul.

Rules: preserve meaning, tense, subject, negation, and certainty. Each tone should sound different. Return JSON only.${retry ? " A previous answer was invalid: check every nested key, the sourceLanguage code, the target language, and both pronunciation formats." : ""}

Use exactly this JSON shape: {"sourceLanguage":"en","casual":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"polite":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"formal":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"slang":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"written":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."}}

Source sentence:
${JSON.stringify(sourceText)}`;
}

async function callOllama(
  sourceText: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
  retry: boolean,
): Promise<OllamaChatResponse> {
  const env = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.OLLAMA_TIMEOUT_MS);

  try {
    const response = await fetch(buildOllamaUrl("/api/chat"), {
      method: "POST",
      headers: buildOllamaHeaders(true),
      cache: "no-store",
      signal: controller.signal,
      body: JSON.stringify({
        model: env.OLLAMA_MODEL,
        stream: false,
        format: "json",
        keep_alive: "10m",
        options: { temperature: 0, num_predict: 1600 },
        messages: [
          {
            role: "system",
            content:
              "You are a meticulous multilingual language coach. Follow the JSON schema exactly.",
          },
          {
            role: "user",
            content: buildPrompt(
              sourceText,
              sourceLanguage,
              targetLanguage,
              retry,
            ),
          },
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
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
): Promise<{
  sourceLanguage: LanguageCode;
  variants: TranslationVariant[];
  latencyMs: number;
}> {
  const startedAt = Date.now();
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await callOllama(
        sourceText,
        sourceLanguage,
        targetLanguage,
        attempt > 0,
      );
      if (!response.message?.content) {
        throw new OllamaOutputError("Ollama returned an empty response");
      }

      const parsedJson = JSON.parse(response.message.content) as unknown;
      const parsed = ollamaTranslationSchema.parse(parsedJson);
      if (sourceLanguage !== "auto" && parsed.sourceLanguage !== sourceLanguage) {
        throw new OllamaOutputError("The model returned the wrong source language");
      }
      if (parsed.sourceLanguage === targetLanguage) {
        throw new SameLanguageError("Source and target languages are identical");
      }
      const variants = normalizeVariants(parsed);
      if (!variants.every((variant) => looksLikeTargetLanguage(variant.translatedText, sourceText, targetLanguage))) {
        throw new OllamaOutputError("The model copied the source or used the wrong language");
      }
      return {
        sourceLanguage: parsed.sourceLanguage,
        variants,
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      if (
        error instanceof OllamaUnavailableError ||
        error instanceof SameLanguageError
      ) {
        throw error;
      }
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
  const response = await fetch(buildOllamaUrl("/api/tags"), {
    headers: buildOllamaHeaders(),
    cache: "no-store",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) return false;
  const data = (await response.json()) as { models?: { name?: string }[] };
  return Boolean(data.models?.some((model) => model.name === env.OLLAMA_MODEL));
}
