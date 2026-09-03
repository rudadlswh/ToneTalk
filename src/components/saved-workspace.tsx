"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { BookOpen, Check, Clipboard, LoaderCircle, Search, Trash2, X } from "lucide-react";
import { readJson } from "@/lib/api";
import type { SavedPhraseDto } from "@/lib/dto";
import { getLanguage, languages } from "@/lib/languages";
import type { Tone } from "@/lib/translation-contract";

const toneLabels: Record<Tone, string> = {
  casual: "😊 Casual",
  polite: "🙏 Polite",
  formal: "👔 Formal",
  slang: "🤙 Slang",
  written: "✍️ Written",
};

type SavedResponse = { items: SavedPhraseDto[]; totalCount: number; requestId: string };

export function SavedWorkspace() {
  const [items, setItems] = useState<SavedPhraseDto[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [language, setLanguage] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams();
      if (debouncedQuery) params.set("q", debouncedQuery);
      if (language) params.set("language", language);
      try {
        const response = await fetch(`/api/saved-phrases?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson<SavedResponse>(response);
        setItems(data.items);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "저장 문장을 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [debouncedQuery, language, reloadKey]);

  const availableLanguages = useMemo(
    () => languages.filter((candidate) => items.some((item) => item.targetLanguage === candidate.code) || (!query && !language)),
    [items, query, language],
  );

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2200);
  };

  const copyText = async (text: string) => {
    await navigator.clipboard.writeText(text);
    showToast("클립보드에 복사했어요.");
  };

  const remove = async (id: string) => {
    const previous = items;
    setItems((current) => current.filter((item) => item.id !== id));
    try {
      const response = await fetch(`/api/saved-phrases/${id}`, { method: "DELETE" });
      if (!response.ok) await readJson(response);
      showToast("저장 문장을 삭제했어요.");
    } catch (caught) {
      setItems(previous);
      showToast(caught instanceof Error ? caught.message : "삭제하지 못했습니다.");
    }
  };

  return (
    <div className="page-wrap saved-page">
      <header className="page-header saved-header">
        <div>
          <span className="eyebrow">YOUR BOOKMARKED PHRASES</span>
          <h1>Saved</h1>
          <p>다시 쓰고 싶은 표현을 언어와 말투별로 모아보세요.</p>
        </div>
        <div className="count-card"><strong>{items.length}</strong><span>phrases</span></div>
      </header>

      <div className="saved-toolbar">
        <label className="search-box">
          <Search size={19} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved phrases..." aria-label="저장 문장 검색" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="검색어 지우기"><X size={16} /></button>}
        </label>
        <div className="filter-row" aria-label="언어 필터">
          <button type="button" className={!language ? "is-selected" : ""} onClick={() => setLanguage("")}>All</button>
          {availableLanguages.map((candidate) => (
            <button type="button" className={language === candidate.code ? "is-selected" : ""} onClick={() => setLanguage(candidate.code)} key={candidate.code}>
              {candidate.flag} {candidate.name}
            </button>
          ))}
        </div>
      </div>

      {loading && <div className="list-state"><LoaderCircle className="spin" size={28} /><span>표현장을 불러오고 있어요</span></div>}
      {error && <div className="list-state is-error"><span>{error}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)}>다시 시도</button></div>}
      {!loading && !error && items.length === 0 && (
        <div className="saved-empty">
          <span className="empty-orbit"><BookOpen size={28} /></span>
          <h2>{query || language ? "조건에 맞는 표현이 없어요" : "첫 표현을 저장해 보세요"}</h2>
          <p>{query || language ? "검색어나 언어 필터를 바꿔보세요." : "번역 결과의 북마크 버튼을 누르면 여기에 모여요."}</p>
          {query || language ? (
            <button type="button" className="secondary-button" onClick={() => { setQuery(""); setLanguage(""); }}>필터 초기화</button>
          ) : (
            <Link href="/" className="primary-link">번역하러 가기</Link>
          )}
        </div>
      )}

      {!loading && items.length > 0 && (
        <div className="saved-list">
          {items.map((item) => {
            const source = getLanguage(item.sourceLanguage);
            const target = getLanguage(item.targetLanguage);
            return (
              <article className={`saved-card tone-${item.tone}`} key={item.id}>
                <div className="saved-card-main">
                  <div className="saved-card-header">
                    <span className="language-pair">{source?.flag} {source?.name ?? item.sourceLanguage} <span>→</span> {target?.flag} {target?.name ?? item.targetLanguage}</span>
                    <span className="tone-badge">{toneLabels[item.tone]}</span>
                  </div>
                  <p className="saved-source">{item.sourceText}</p>
                  <p className="translation-text" lang={item.targetLanguage}>{item.translatedText}</p>
                  {item.transliteration && <p className="transliteration">{item.transliteration}</p>}
                  <p className="context-note">{item.contextNote}</p>
                </div>
                <div className="saved-card-actions">
                  <time dateTime={item.savedAt}>{new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(item.savedAt))}</time>
                  <button type="button" onClick={() => void copyText(item.translatedText)}><Clipboard size={16} />Copy</button>
                  <button type="button" className="danger-icon" onClick={() => void remove(item.id)} aria-label="저장 문장 삭제"><Trash2 size={17} /></button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {toast && <div className="toast" role="status"><Check size={17} />{toast}</div>}
    </div>
  );
}
