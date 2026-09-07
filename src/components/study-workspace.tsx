"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowRight,
  Brain,
  Check,
  Flame,
  LoaderCircle,
  RotateCcw,
  Sparkles,
  Square,
  Target,
  Trophy,
  Volume2,
} from "lucide-react";
import { useSpeech } from "@/hooks/use-speech";
import { PronunciationGuide } from "@/components/pronunciation-guide";
import { readJson } from "@/lib/api";
import type {
  StudyItemDto,
  StudyRating,
  StudySummaryDto,
} from "@/lib/dto";
import { getLanguage } from "@/lib/languages";
import type { Tone } from "@/lib/translation-contract";

const toneLabels: Record<Tone, string> = {
  casual: "😊 Casual",
  polite: "🙏 Polite",
  formal: "👔 Formal",
  slang: "🤙 Slang",
  written: "✍️ Written",
};

const ratings: Array<{
  value: StudyRating;
  label: string;
  hint: string;
  className: string;
}> = [
  { value: "again", label: "다시", hint: "10분 뒤", className: "rating-again" },
  { value: "hard", label: "어려움", hint: "짧게 복습", className: "rating-hard" },
  { value: "good", label: "좋음", hint: "적정 간격", className: "rating-good" },
  { value: "easy", label: "쉬움", hint: "길게 복습", className: "rating-easy" },
];

type StudyResponse = {
  items: StudyItemDto[];
  summary: StudySummaryDto;
  requestId: string;
};

type ReviewResponse = {
  summary: StudySummaryDto;
  requestId: string;
};

export function StudyWorkspace() {
  const [items, setItems] = useState<StudyItemDto[]>([]);
  const [summary, setSummary] = useState<StudySummaryDto | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const { speakingId, speechError, speak, stop } = useSpeech();

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch("/api/study?limit=20", {
          cache: "no-store",
          signal: controller.signal,
        });
        const data = await readJson<StudyResponse>(response);
        setItems(data.items);
        setSummary(data.summary);
      } catch (caught) {
        if (caught instanceof Error && caught.name === "AbortError") return;
        setError(caught instanceof Error ? caught.message : "학습 카드를 불러오지 못했습니다.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reloadKey]);

  const current = items[0];
  const currentSource = current ? getLanguage(current.sourceLanguage) : null;
  const dailyPercent = useMemo(() => {
    if (!summary) return 0;
    return Math.min(100, Math.round((summary.reviewedToday / summary.dailyGoal) * 100));
  }, [summary]);

  const review = async (rating: StudyRating) => {
    if (!current || submitting) return;
    stop();
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/study/reviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ savedPhraseId: current.id, rating }),
      });
      const data = await readJson<ReviewResponse>(response);
      const remainingItems = items.slice(1);
      setItems(remainingItems);
      setSummary(data.summary);
      setRevealed(false);
      if (remainingItems.length === 0 && data.summary.dueCount > 0) {
        setReloadKey((value) => value + 1);
      }
      setToast("복습 결과를 저장했어요.");
      window.setTimeout(() => setToast(null), 1800);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "복습 결과를 저장하지 못했습니다.");
    } finally {
      setSubmitting(false);
    }
  };

  const nextReviewLabel = summary?.nextReviewAt
    ? new Intl.DateTimeFormat("ko-KR", {
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(summary.nextReviewAt))
    : null;

  const playAnswer = () => {
    if (!current) return;
    speak({ id: current.id, text: current.translatedText, language: current.targetLanguage });
  };

  return (
    <div className="page-wrap study-page">
      <header className="page-header study-header">
        <div>
          <span className="eyebrow">SMART PHRASE REVIEW</span>
          <h1>Study</h1>
          <p>저장한 표현을 기억이 흐려질 때 다시 만나보세요.</p>
        </div>
        {summary && (
          <div className="study-streak"><Flame size={18} /><strong>{summary.streakDays}</strong><span>day streak</span></div>
        )}
      </header>

      {summary && (
        <section className="study-overview" aria-label="오늘의 학습 현황">
          <div className="goal-card">
            <div className="goal-card-top">
              <span><Target size={17} />오늘의 목표</span>
              <strong>{summary.reviewedToday} / {summary.dailyGoal}</strong>
            </div>
            <div className="goal-track"><span style={{ width: `${dailyPercent}%` }} /></div>
          </div>
          <div className="study-mini-stat"><Brain size={18} /><div><strong>{summary.dueCount}</strong><span>복습할 표현</span></div></div>
          <div className="study-mini-stat"><Trophy size={18} /><div><strong>{summary.masteredCount}</strong><span>익힌 표현</span></div></div>
        </section>
      )}

      {loading && <div className="study-state"><LoaderCircle className="spin" size={30} /><span>오늘의 복습 카드를 준비하고 있어요</span></div>}
      {error && !current && (
        <div className="study-state is-error"><span>{error}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)}>다시 시도</button></div>
      )}

      {!loading && summary?.totalSaved === 0 && (
        <div className="study-complete">
          <span className="empty-orbit"><Brain size={29} /></span>
          <h2>학습할 표현을 먼저 모아주세요</h2>
          <p>번역 결과를 저장하면 자동으로 첫 복습 카드가 만들어져요.</p>
          <Link href="/" className="primary-link">표현 만들기 <ArrowRight size={15} /></Link>
        </div>
      )}

      {!loading && summary && summary.totalSaved > 0 && !current && (
        <div className="study-complete">
          <span className="complete-mark"><Check size={32} /></span>
          <h2>오늘 복습을 마쳤어요</h2>
          <p>{nextReviewLabel ? `다음 복습은 ${nextReviewLabel}에 열려요.` : "새 표현을 저장하면 바로 학습할 수 있어요."}</p>
          <Link href="/saved" className="secondary-link">저장한 표현 보기</Link>
        </div>
      )}

      {!loading && current && (
        <section className="study-session" aria-live="polite">
          <div className="session-progress">
            <span>오늘 남은 카드</span>
            <strong>{summary?.dueCount ?? items.length}</strong>
          </div>
          <article className={`study-card tone-${current.tone} ${revealed ? "is-revealed" : ""}`}>
            <div className="study-card-meta">
              <span className="language-pair">{currentSource?.flag} {currentSource?.name ?? current.sourceLanguage} <span>→</span> {getLanguage(current.targetLanguage)?.flag} {getLanguage(current.targetLanguage)?.name}</span>
              <span className="tone-badge">{toneLabels[current.tone]}</span>
            </div>
            <div className="study-question">
              <span>이 문장을 어떻게 표현할까요?</span>
              <h2>{current.sourceText}</h2>
            </div>

            {!revealed ? (
              <button type="button" className="reveal-button" onClick={() => setRevealed(true)}>
                <RotateCcw size={18} /> 정답 확인
              </button>
            ) : (
              <div className="study-answer">
                <div className="study-answer-heading">
                  <span className="answer-label">ANSWER</span>
                  <button
                    type="button"
                    className={`speech-button ${speakingId === current.id ? "is-speaking" : ""}`}
                    onClick={playAnswer}
                    aria-label={speakingId === current.id ? "정답 음성 중지" : "정답 듣기"}
                  >
                    {speakingId === current.id ? <Square size={14} /> : <Volume2 size={16} />}
                    {speakingId === current.id ? "중지" : "듣기"}
                  </button>
                </div>
                <p className="translation-text" lang={current.targetLanguage}>{current.translatedText}</p>
                <PronunciationGuide
                  romanization={current.transliteration}
                  hangulPronunciation={current.hangulPronunciation}
                />
                <p className="context-note">{current.contextNote}</p>
                {current.warning && <p className="tone-warning">{current.warning}</p>}
              </div>
            )}
          </article>

          {revealed && (
            <div className="rating-panel">
              <span>얼마나 잘 기억했나요?</span>
              <div className="rating-grid">
                {ratings.map((rating) => (
                  <button
                    type="button"
                    className={rating.className}
                    disabled={submitting}
                    key={rating.value}
                    onClick={() => void review(rating.value)}
                  >
                    <strong>{rating.label}</strong>
                    <span>{rating.hint}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          {error && <div className="inline-error" role="alert">{error}</div>}
        </section>
      )}
      {(toast || speechError) && <div className="toast" role="status"><Sparkles size={17} />{toast ?? speechError}</div>}
    </div>
  );
}
