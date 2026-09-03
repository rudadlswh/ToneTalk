export const languages = [
  { code: "en", name: "English", nativeName: "English", flag: "🇺🇸", speechLocale: "en-US" },
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵", speechLocale: "ja-JP" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷", speechLocale: "ko-KR" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷", speechLocale: "fr-FR" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸", speechLocale: "es-ES" },
  { code: "zh-CN", name: "Chinese", nativeName: "中文", flag: "🇨🇳", speechLocale: "zh-CN" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪", speechLocale: "de-DE" },
] as const;

export type TargetLanguage = (typeof languages)[number]["code"];
export type LanguageCode = TargetLanguage;

export const sourceLanguages = [
  { code: "auto", name: "Auto detect", nativeName: "자동 감지", flag: "✨" },
  ...languages,
] as const;

export type SourceLanguage = (typeof sourceLanguages)[number]["code"];

export const languageCodes = languages.map((language) => language.code) as [
  TargetLanguage,
  ...TargetLanguage[],
];

export const sourceLanguageCodes = sourceLanguages.map(
  (language) => language.code,
) as [SourceLanguage, ...SourceLanguage[]];

export function getLanguage(code: string) {
  return languages.find((language) => language.code === code);
}
