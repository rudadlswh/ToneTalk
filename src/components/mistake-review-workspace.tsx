"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RotateCcw } from "lucide-react";
import { useSessionUserId } from "@/components/session-boundary";
import { QuizQuestion, PuzzleQuestion } from "@/components/practice-questions";
import { readJson } from "@/lib/api";
import { getLanguage } from "@/lib/languages";
import { practiceTones } from "@/lib/study-practice";
import { studyPointsAccountHeader } from "@/lib/study-points";
import { mistakeListSchema, mistakeReceiptSchema, type MistakeItem, type MistakeQuery } from "@/lib/mistake-review";
import type { DailyAnswer, DailyAttemptInput, DailyResult } from "@/lib/daily-ai-practice";

const statusLabel = (outcome?: string) => outcome === "correct" ? "복습 완료" : outcome === "wrong" ? "다시 도전" : outcome === "revealed" ? "정답 확인 · 복습 필요" : "아직 복습하지 않음";
const dayLabel = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
type Filters = Omit<MistakeQuery, "cursor">;

export function MistakeReviewWorkspace() {
  const userId = useSessionUserId();
  const [filters, setFilters] = useState<Filters>({ kind: "all", tone: "all", status: "pending" });
  const [items, setItems] = useState<MistakeItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [active, setActive] = useState<MistakeItem | null>(null);
  const [round, setRound] = useState(0);
  const [result, setResult] = useState<DailyResult>();
  const [pending, setPending] = useState<DailyAttemptInput | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true); setLoadError("");
      if (!cursor) { setItems([]); setNextCursor(null); }
      try {
        const query = new URLSearchParams(filters);
        if (cursor) query.set("cursor", cursor);
        const response = await fetch(`/api/study/mistakes?${query}`, { cache: "no-store", headers: { [studyPointsAccountHeader]: userId }, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]) });
        const data = mistakeListSchema.parse(await readJson(response));
        if (controller.signal.aborted) return;
        setItems(previous => cursor ? [...previous, ...data.items.filter(item => !previous.some(old => old.setId === item.setId && old.questionIndex === item.questionIndex))] : data.items);
        setNextCursor(data.nextCursor);
      } catch (error) { if (!controller.signal.aborted) setLoadError(error instanceof Error ? error.message : "오답 목록을 불러오지 못했어요."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    };
    void load();
    return () => controller.abort();
  }, [filters, cursor, reload, userId]);

  const changeFilters = (next: Filters) => { setLoading(true); setItems([]); setFilters(next); setCursor(null); };
  const open = (item: MistakeItem) => { setActive(item); setResult(undefined); setPending(null); setSaveError(""); setRound(value => value + 1); };
  const back = () => { setActive(null); setPending(null); setCursor(null); setReload(value => value + 1); };
  const save = async (input: DailyAttemptInput) => {
    if (submission.current) return;
    const controller = new AbortController(); submission.current = controller;
    setPending(input); setSaving(true); setSaveError("");
    try {
      const response = await fetch("/api/study/mistakes", { method: "POST", headers: { "Content-Type": "application/json", [studyPointsAccountHeader]: userId }, body: JSON.stringify(input), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]) });
      const data = mistakeReceiptSchema.parse(await readJson(response));
      if (controller.signal.aborted) return;
      setResult(data.result); setPending(null);
      setActive(previous => previous?.setId === input.setId && previous.questionIndex === input.questionIndex ? { ...previous, review: data.result } : previous);
    } catch (error) { if (!controller.signal.aborted) setSaveError(error instanceof Error ? error.message : "복습 결과를 저장하지 못했어요."); }
    finally { submission.current = null; if (!controller.signal.aborted) setSaving(false); }
  };
  const submit = (answer: DailyAnswer) => {
    if (active && !pending) void save({ eventId: crypto.randomUUID(), setId: active.setId, questionIndex: active.questionIndex, answer });
  };

  return <div className="page-wrap practice-page mistake-page">
    <Link className="practice-back" href="/study"><ArrowLeft size={17} />학습으로</Link>
    <header className="page-header"><div><span className="eyebrow">LEARN FROM MISTAKES</span><h1>오답 복습</h1><p>틀린 퀴즈와 오답·정답 공개 기록이 있는 퍼즐을 다시 풀어보세요.</p></div></header>
    <p className="practice-muted">오늘의 AI 문제와 저장 문장 학습 기록을 사용합니다. 추가 AI 호출과 XP 지급은 없으며, 원래 풀이와 적립 기록은 유지됩니다.</p>
    {active ? <section className="practice-panel" aria-label="오답 다시 풀기">
      <button type="button" className="practice-back" disabled={saving} onClick={back}><ArrowLeft size={16} />오답 목록으로</button>
      <p className="practice-muted">{dayLabel(active.day)} · {active.source === "saved" ? "저장 문장" : "오늘의 AI 문제"} · {active.kind === "quiz" ? "어투 퀴즈" : "단어 퍼즐"}</p>
      {active.kind === "quiz" ? <QuizQuestion key={round} phrase={active.phrase} daily={{ result, locked: saving || pending !== null, submit }} onNext={back} />
        : <PuzzleQuestion key={round} phrase={active.phrase} daily={{ result, locked: saving || pending !== null, submit }} onNext={back} />}
      {saving && <p role="status">복습 결과를 저장하고 있어요…</p>}
      {saveError && <div className="inline-error" role="alert">{saveError} 저장 확인 전에는 답안을 바꿀 수 없어요. 목록으로 나가면 미확인 답안을 복원하지 못할 수 있습니다. {pending && !saving && <button type="button" onClick={() => void save(pending)}>같은 답안 다시 저장</button>}</div>}
      {result && !pending && <div role="status"><p>복습 {result.attemptNumber}회 · {statusLabel(result.outcome)} · 결과 저장됨 · 추가 XP 0</p>{result.outcome !== "correct" && <button type="button" className="practice-secondary" onClick={() => open(active)}><RotateCcw size={16} />다시 풀기</button>}</div>}
    </section> : <>
      <div className="chat-settings mistake-filters">
        <label>학습 유형<select value={filters.kind} onChange={event => changeFilters({ ...filters, kind: event.target.value as Filters["kind"] })}><option value="all">전체 유형</option><option value="quiz">어투 퀴즈</option><option value="puzzle">단어 퍼즐</option></select></label>
        <label>어투<select value={filters.tone} onChange={event => changeFilters({ ...filters, tone: event.target.value as Filters["tone"] })}><option value="all">전체 어투</option>{Object.entries(practiceTones).map(([tone, meta]) => <option key={tone} value={tone}>{meta.label}</option>)}</select></label>
        <label>복습 상태<select value={filters.status} onChange={event => changeFilters({ ...filters, status: event.target.value as Filters["status"] })}><option value="pending">복습 필요</option><option value="resolved">복습 완료</option><option value="all">전체 기록</option></select></label>
      </div>
      {loading && <p role="status">오답 기록을 불러오고 있어요…</p>}
      {loadError && <div className="inline-error" role="alert">{loadError} <button type="button" disabled={loading} onClick={() => setReload(value => value + 1)}>다시 불러오기</button></div>}
      {!loading && !loadError && items.length === 0 && <section className="practice-panel"><h2>조건에 맞는 오답 기록이 없어요</h2><p>{filters.status === "pending" ? "남아 있는 복습 대상이 없어요. 필터를 바꾸거나 전체 기록에서 이전 결과를 확인할 수 있어요." : "학습 유형·어투·복습 상태를 바꿔 확인해 보세요."}</p><Link href="/study">새 학습 시작하기</Link></section>}
      <div className="mistake-list">{items.map(item => <article className="practice-panel" key={`${item.setId}-${item.questionIndex}`}>
        <p className="practice-muted">{dayLabel(item.day)} · {item.source === "saved" ? "저장 문장" : "오늘의 AI 문제"} · {item.kind === "quiz" ? "어투 퀴즈" : "단어 퍼즐"} · {practiceTones[item.phrase.tone].label}</p>
        <h2 lang={item.kind === "quiz" ? item.phrase.targetLanguage : undefined}>{item.kind === "quiz" ? item.phrase.translatedText : item.phrase.sourceText}</h2>
        <p>{getLanguage(item.phrase.targetLanguage)?.name} · 원래 풀이: {item.original.outcome === "revealed" ? "정답 공개" : "오답"}{item.original.answer.type === "quiz" && ` (${practiceTones[item.original.answer.tone].label} 선택)`}</p>
        <p className="practice-muted">{statusLabel(item.review?.outcome)}{item.review && ` · 복습 ${item.review.attemptNumber}회`}</p>
        <button type="button" className="practice-primary" onClick={() => open(item)}>{item.review?.outcome === "correct" ? "다시 연습하기" : "다시 풀기"}</button>
      </article>)}</div>
      {nextCursor && !loadError && <button type="button" className="practice-secondary" disabled={loading} onClick={() => { setLoading(true); setCursor(nextCursor); }}>이전 오답 더 보기</button>}
    </>}
  </div>;
}
