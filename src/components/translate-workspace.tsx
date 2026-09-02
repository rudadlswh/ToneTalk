"use client";

import { useEffect, useState } from "react";
import {
  Bookmark,
  Check,
  Clipboard,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import type { TranslationSessionDto } from "@/lib/dto";
import { getLanguage, languages, type TargetLanguage } from "@/lib/languages";
import { readJson } from "@/lib/api";
import type { Tone } from "@/lib/translation-contract";

const examples = [
  "How are you?",
  "Thank you so much!",
  "Nice to meet you.",
  "Could you help me?",
];

const toneMeta: Record<Tone, { label: string; emoji: string; className: string }> = {
  casual: { label: "Casual", emoji: "😊", className: "tone-casual" },
  polite: { label: "Polite", emoji: "🙏", className: "tone-polite" },
  formal: { label: "Formal", emoji: "👔", className: "tone-formal" },
  slang: { label: "Slang", emoji: "🤙", className: "tone-slang" },
  written: { label: "Written", emoji: "✍️", className: "tone-written" },
};

type TranslationResponse = { session: TranslationSessionDto; requestId: string };
type SaveResponse = { savedPhraseId: string; requestId: string };

export function TranslateWorkspace() {
  const [sourceText, setSourceText] = useState("");
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("ja");
  const [session, setSession] = useState<TranslationSessionDto | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [savingVariantId, setSavingVariantId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const loadDefaultLanguage = async () => {
      try {
        const response = await fetch("/api/profile", {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const data = (await response.json()) as {
          profile?: { defaultTargetLanguage?: TargetLanguage };
        };
        if (data.profile?.defaultTargetLanguage) {
          setTargetLanguage(data.profile.defaultTargetLanguage);
        }
      } catch {
        // The translator remains usable with Japanese as the safe default.
      }
    };
    void loadDefaultLanguage();
    return () => controller.abort();
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const translate = async () => {
    const cleanText = sourceText.trim();
    if (!cleanText || loading) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/translations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceText: cleanText, targetLanguage }),
      });
      const data = await readJson<TranslationResponse>(response);
      setSession(data.session);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "번역에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    showToast("번역을 클립보드에 복사했어요.");
  };

  const toggleSave = async (variantId: string, savedPhraseId: string | null) => {
    if (!session || savingVariantId) return;
    setSavingVariantId(variantId);
    try {
      if (savedPhraseId) {
        const response = await fetch(`/api/saved-phrases/${savedPhraseId}`, { method: "DELETE" });
        if (!response.ok) await readJson(response);
        setSession({
          ...session,
          variants: session.variants.map((variant) =>
            variant.id === variantId ? { ...variant, savedPhraseId: null } : variant,
          ),
        });
        showToast("저장을 취소했어요.");
      } else {
        const response = await fetch("/api/saved-phrases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ variantId }),
        });
        const data = await readJson<SaveResponse>(response);
        setSession({
          ...session,
          variants: session.variants.map((variant) =>
            variant.id === variantId
              ? { ...variant, savedPhraseId: data.savedPhraseId }
              : variant,
          ),
        });
        showToast("내 표현장에 저장했어요.");
      }
    } catch (caught) {
      showToast(caught instanceof Error ? caught.message : "저장하지 못했습니다.");
    } finally {
      setSavingVariantId(null);
    }
  };

  return (
    <div className="page-wrap translate-page">
      <header className="page-header">
        <div>
          <span className="eyebrow">TRANSLATE WITH NUANCE</span>
          <h1>같은 뜻도, 상황에 맞게.</h1>
          <p>한 문장을 다섯 가지 말투로 비교하며 자연스럽게 익혀보세요.</p>
        </div>
        <div className="privacy-pill"><span className="status-dot" /> Local LLM</div>
      </header>

      <div className="translate-grid">
        <section className="composer-panel" aria-labelledby="composer-title">
          <div className="section-label" id="composer-title">Translate to</div>
          <div className="language-grid" role="radiogroup" aria-label="번역 언어 선택">
            {languages.map((language) => (
              <button
                type="button"
                role="radio"
                aria-checked={targetLanguage === language.code}
                className={`language-chip ${targetLanguage === language.code ? "is-selected" : ""}`}
                key={language.code}
                onClick={() => setTargetLanguage(language.code)}
              >
                <span>{language.flag}</span>
                <span>{language.nativeName}</span>
              </button>
            ))}
          </div>

          <div className="source-block">
            <div className="source-label"><span>🇺🇸</span> English</div>
            <textarea
              value={sourceText}
              maxLength={500}
              placeholder="Type a sentence to translate..."
              aria-label="번역할 영어 문장"
              onChange={(event) => setSourceText(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && !event.nativeEvent.isComposing) {
                  void translate();
                }
              }}
            />
            <div className="source-meta">
              <span>{sourceText.length}/500</span>
              {sourceText && (
                <button type="button" className="icon-button compact" onClick={() => setSourceText("")} aria-label="입력 지우기">
                  <X size={16} />
                </button>
              )}
            </div>
          </div>

          <div className="examples">
            <span>Try an example</span>
            <div className="example-list">
              {examples.map((example) => (
                <button type="button" key={example} onClick={() => setSourceText(example)}>{example}</button>
              ))}
            </div>
          </div>

          {error && <div className="inline-error" role="alert">{error}</div>}

          <button
            type="button"
            className="primary-button"
            disabled={!sourceText.trim() || loading}
            onClick={() => void translate()}
          >
            {loading ? <LoaderCircle className="spin" size={20} /> : <Sparkles size={20} />}
            {loading ? "다섯 가지 말투를 만들고 있어요" : "Translate in All Tones"}
          </button>
          <span className="shortcut-hint">⌘/Ctrl + Enter</span>
        </section>

        <section className="results-panel" aria-live="polite" aria-busy={loading}>
          {!session && !loading && (
            <div className="empty-results">
              <div className="empty-orbit"><Sparkles size={28} /></div>
              <h2>표현의 온도를 바꿔보세요</h2>
              <p>문장을 입력하면 Casual부터 Written까지<br />상황별 표현을 한 번에 보여드려요.</p>
            </div>
          )}

          {loading && (
            <div className="tone-grid" aria-label="번역 중">
              {Array.from({ length: 5 }).map((_, index) => <div className="tone-skeleton" key={index} />)}
            </div>
          )}

          {session && !loading && (
            <>
              <div className="results-header">
                <div>
                  <span className="section-label">5 tone translations</span>
                  <h2>{getLanguage(session.targetLanguage)?.flag} {getLanguage(session.targetLanguage)?.nativeName}</h2>
                </div>
                <span>{(session.latencyMs / 1000).toFixed(1)}s · {session.model}</span>
              </div>
              <div className="tone-grid">
                {session.variants.map((variant) => {
                  const meta = toneMeta[variant.tone];
                  const saving = savingVariantId === variant.id;
                  return (
                    <article className={`tone-card ${meta.className}`} key={variant.id}>
                      <div className="tone-card-top">
                        <span className="tone-badge"><span>{meta.emoji}</span>{meta.label}</span>
                        <div className="card-actions">
                          <button type="button" className="icon-button" onClick={() => void copyText(variant.translatedText)} aria-label={`${meta.label} 번역 복사`}>
                            <Clipboard size={17} />
                          </button>
                          <button
                            type="button"
                            className={`icon-button ${variant.savedPhraseId ? "is-saved" : ""}`}
                            disabled={saving}
                            onClick={() => void toggleSave(variant.id, variant.savedPhraseId)}
                            aria-label={variant.savedPhraseId ? "저장 취소" : "문장 저장"}
                          >
                            {saving ? <LoaderCircle className="spin" size={17} /> : variant.savedPhraseId ? <Check size={17} /> : <Bookmark size={17} />}
                          </button>
                        </div>
                      </div>
                      <p className="context-note">{variant.contextNote}</p>
                      <p className="translation-text" lang={session.targetLanguage}>{variant.translatedText}</p>
                      {variant.transliteration && <p className="transliteration">{variant.transliteration}</p>}
                      {variant.warning && <p className="tone-warning">{variant.warning}</p>}
                    </article>
                  );
                })}
              </div>
            </>
          )}
        </section>
      </div>
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}
