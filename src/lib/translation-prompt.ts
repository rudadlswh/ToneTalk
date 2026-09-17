import { getLanguage, languageCodes, type SourceLanguage, type TargetLanguage } from "./languages.ts";
const tones = ["casual", "polite", "formal", "slang", "written"];

export function buildPrompt(
  sourceText: string,
  sourceLanguage: SourceLanguage,
  targetLanguage: TargetLanguage,
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

Rules: preserve meaning, tense, subject, negation, and certainty. Each tone should sound different. Return JSON only.

Use exactly this JSON shape: {"sourceLanguage":"en","casual":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"polite":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"formal":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"slang":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."},"written":{"translatedText":"...","romanization":"...","hangulPronunciation":"..."}}

Source sentence:
${JSON.stringify(sourceText)}`;
}
