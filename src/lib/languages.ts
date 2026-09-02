export const languages = [
  { code: "ja", name: "Japanese", nativeName: "日本語", flag: "🇯🇵" },
  { code: "ko", name: "Korean", nativeName: "한국어", flag: "🇰🇷" },
  { code: "fr", name: "French", nativeName: "Français", flag: "🇫🇷" },
  { code: "es", name: "Spanish", nativeName: "Español", flag: "🇪🇸" },
  { code: "zh-CN", name: "Chinese", nativeName: "中文", flag: "🇨🇳" },
  { code: "de", name: "German", nativeName: "Deutsch", flag: "🇩🇪" },
] as const;

export type TargetLanguage = (typeof languages)[number]["code"];

export const languageCodes = languages.map((language) => language.code) as [
  TargetLanguage,
  ...TargetLanguage[],
];

export function getLanguage(code: string) {
  return languages.find((language) => language.code === code);
}
