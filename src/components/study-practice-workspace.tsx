"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Layers, LoaderCircle, MessageSquare, RotateCcw, Send, Sparkles, Target } from "lucide-react";
import { StudyWorkspace } from "@/components/study-workspace";
import { readJson } from "@/lib/api";
import { languages, type TargetLanguage } from "@/lib/languages";
import { scenarios, type PracticePhrase, type RoleplayReply, type RoleplayRequest } from "@/lib/study-practice";
import { chatReceiptSchema, type ChatTurnInput } from "@/lib/study-chat";
import { dailyAttemptResponseSchema, dailyPracticeSchema, isDailyComplete, nextDailyQuestion, type DailyAttemptInput, type DailyPractice } from "@/lib/daily-ai-practice";
import { useStudyPoints } from "@/hooks/use-study-points";
import { useSessionUserId } from "@/components/session-boundary";
import { studyPointRewards, studyPointsAccountHeader } from "@/lib/study-points";
import { QuizQuestion, PuzzleQuestion, type DailyQuestionControls } from "@/components/practice-questions";

const activities = [
  { id: "quiz", title: "어투 뉘앙스 퀴즈", english: "Tone Quiz", icon: Target, description: "외국어 문장을 읽고 5가지 어투 중 어떤 뉘앙스인지 맞추며 자연스러운 어감 감각을 기릅니다.", level: "초급 · 뉘앙스 식별", feature: "4지선다형 · 즉각 해설" },
  { id: "chat", title: "상황별 롤플레이 채팅", english: "Chat Practice", icon: MessageSquare, description: "비즈니스 회의, 카페 주문, 친구와의 대화. 원하는 상황에서 AI와 대화하며 어투와 공손도 피드백을 받아보세요.", level: "중급 · 실전 회화", feature: "어투 분석 & 표현 추천" },
  { id: "puzzle", title: "단어 나열 퍼즐", english: "Word Scramble", icon: Layers, description: "뒤섞인 단어 블록을 올바른 순서로 조립하며 각 어투에 어울리는 문장 구조와 표현을 익힙니다.", level: "초급/중급 · 어순 완성", feature: "내 저장 문장 연동" },
] as const;
type Mode = typeof activities[number]["id"] | "review";

export function StudyPracticeWorkspace() {
  const [mode, setMode] = useState<Mode | null>(null);
  const userId = useSessionUserId();
  const { totalPoints, loadError, saveError, storageError, notice, pending, failed, unverified, retry, refresh } = useStudyPoints(userId);
  return (
    <>
      <div className="page-wrap practice-page">
        <header className="page-header practice-header">
          <div><span className="eyebrow">A LITTLE PRACTICE, EVERY DAY</span><h1>Study</h1><p>뜻을 아는 것에서, 자연스럽게 말하는 것으로.</p></div>
          <div className="practice-xp" aria-live="polite"><Sparkles size={17} /><strong>{totalPoints === null ? "—" : totalPoints.toLocaleString("ko-KR")} XP</strong><small>내 계정 누적 포인트 · 프로필에서 기록 확인</small></div>
        </header>
        {loadError && <p className="inline-error" role="alert">{loadError} <button type="button" onClick={refresh}>다시 조회</button></p>}
        {storageError && <p className="inline-error" role="alert">{storageError}</p>}
        {unverified > 0 && <p className="inline-error" role="alert">이전 미저장 요청 {unverified}건은 서버에서 풀이 완료를 확인할 수 없어 적립하지 않았습니다. 브라우저 기록은 삭제하지 않고 보관합니다. 새 학습부터 서버에서 채점하고 적립합니다.</p>}
        {pending > 0 && <p role="status">미저장 포인트 {pending}건을 저장하고 있어요.</p>}
        {failed > 0 && <div className="inline-error" role="alert">{saveError} 미저장 {failed}건이 있어요. {!storageError && "같은 계정으로 스터디를 다시 열거나 연결이 복구되면 재시도합니다."} <button type="button" disabled={pending > 0} onClick={retry}>포인트 다시 저장</button></div>}
        {notice && !pending && !failed && <p role="status">{notice}</p>}
        {mode ? (
          <div className="practice-section-heading"><button className="practice-back" onClick={() => setMode(null)}><ArrowLeft size={17} />학습 모드</button><h2>{mode === "review" ? "저장 표현 복습" : activities.find((item) => item.id === mode)?.title}</h2></div>
        ) : (
          <>
            <div className="practice-menu">
              {activities.map((activity) => {
                const Icon = activity.icon;
                return <button type="button" key={activity.id} className={`practice-tile practice-${activity.id}`} onClick={() => setMode(activity.id)}>
                  <span className="practice-tile-icon"><Icon size={29} /></span>
                  <span className="practice-tile-content"><span className="practice-tile-title"><strong>{activity.title}</strong><span>{activity.english}</span></span>
                    <span className="practice-reward"><Sparkles size={14} />+{studyPointRewards[activity.id]} XP</span>
                    <span className="practice-description">{activity.description}</span>
                    <span className="practice-tags"><span>{activity.level}</span><span>{activity.feature}</span></span>
                  </span><span className="practice-chevron"><ChevronRight size={23} /></span>
                </button>;
              })}
              <button type="button" className="practice-tile practice-review" onClick={() => setMode("review")}>
                <span className="practice-tile-icon"><BookOpen size={29} /></span>
                <span className="practice-tile-content">
                  <span className="practice-tile-title"><strong>저장 표현 복습</strong><span>Saved Review</span></span>
                  <span className="practice-reward practice-reward-neutral">간격 반복 학습</span>
                  <span className="practice-description">저장한 표현을 기억이 흐려지는 시점에 다시 만나고, 기억 정도에 따라 다음 복습 일정을 조정합니다.</span>
                  <span className="practice-tags"><span>전체 수준 · 표현 암기</span><span>내 저장 문장 연동</span></span>
                </span>
                <span className="practice-chevron"><ChevronRight size={23} /></span>
              </button>
              <Link className="practice-tile practice-mistake" href="/study/mistakes">
                <span className="practice-tile-icon"><RotateCcw size={29} /></span>
                <span className="practice-tile-content">
                  <span className="practice-tile-title"><strong>오답 복습</strong><span>Mistake Review</span></span>
                  <span className="practice-reward practice-reward-neutral">추가 XP 없음</span>
                  <span className="practice-description">틀린 어투 퀴즈와 헷갈린 단어 퍼즐을 모아 다시 풀고, 반복해서 어려운 표현을 집중적으로 익힙니다.</span>
                  <span className="practice-tags"><span>맞춤 복습 · 약점 보완</span><span>풀이 결과 저장</span></span>
                </span>
                <span className="practice-chevron"><ChevronRight size={23} /></span>
              </Link>
            </div>
            <p className="practice-footnote">XP는 계정에 저장되는 학습용 포인트이며 복습 통계와 별개입니다. 퀴즈·퍼즐·채팅 각각 하루 한 번, 총 80 XP까지 적립됩니다. 한국 시간 자정에 초기화되며 이후에도 학습은 계속할 수 있어요.</p>
          </>
        )}
        {(mode === "quiz" || mode === "puzzle") && <PhrasePractice key={mode} kind={mode} onDailySaved={refresh} />}
        {mode === "chat" && <ChatPractice onSaved={refresh} />}
      </div>
      {mode === "review" && <StudyWorkspace />}
    </>
  );
}

function PhrasePractice({ kind, onDailySaved }: { kind: "quiz" | "puzzle"; onDailySaved: () => void }) {
  const userId = useSessionUserId();
  const [generating, setGenerating] = useState(false);
  const generation = useRef<AbortController | null>(null);
  useEffect(() => () => generation.current?.abort(), []);
  const [source, setSource] = useState<"daily" | "saved">("daily");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deck, setDeck] = useState<PracticePhrase[] | null>(null);
  const [index, setIndex] = useState(0);
  const [daily, setDaily] = useState<DailyPractice | null>(null);
  const [pendingAnswer, setPendingAnswer] = useState<DailyAttemptInput | null>(null);
  const [saving, setSaving] = useState(false);
  const submission = useRef<AbortController | null>(null);
  useEffect(() => () => submission.current?.abort(), []);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/study/daily?kind=${kind}&source=${source}`, {
          signal: controller.signal, cache: "no-store", headers: { [studyPointsAccountHeader]: userId },
        });
        const data = await readJson<{ practice: unknown }>(response);
        if (controller.signal.aborted) return;
        setDaily(data.practice === null ? null : dailyPracticeSchema.parse(data.practice));
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "문제와 풀이 기록을 불러오지 못했어요.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reload, source, kind, userId]);
  const start = async () => {
    if (generation.current) return;
    const controller = new AbortController();
    generation.current = controller;
    setGenerating(true); setError("");
    try {
      // Always ask the server: another browser or Korean midnight may have changed the set.
      const response = await fetch("/api/study/daily", {
        method: "POST", headers: { "Content-Type": "application/json", [studyPointsAccountHeader]: userId },
        body: JSON.stringify({ kind, source }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(185_000)]),
      });
      const data = dailyPracticeSchema.parse(await readJson(response));
      if (!controller.signal.aborted) { setDaily(data); setDeck(data.phrases); setIndex(nextDailyQuestion(data)); }
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "새 문제 생성에 실패했어요.");
    } finally {
      if (!controller.signal.aborted) setGenerating(false);
      generation.current = null;
    }
  };
  const saveAnswer = async (input: DailyAttemptInput) => {
    if (submission.current) return;
    const controller = new AbortController();
    submission.current = controller;
    setPendingAnswer(input); setSaving(true); setError("");
    try {
      const response = await fetch("/api/study/daily", {
        method: "PUT", headers: { "Content-Type": "application/json", [studyPointsAccountHeader]: userId },
        body: JSON.stringify(input), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
      });
      const data = dailyAttemptResponseSchema.parse(await readJson(response));
      if (controller.signal.aborted) return;
      setDaily(previous => previous?.id === input.setId ? {
        ...previous, results: [...previous.results.filter(r => r.questionIndex !== data.result.questionIndex), data.result],
      } : previous);
      setPendingAnswer(null);
      onDailySaved();
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "답안을 저장하지 못했어요.");
    } finally {
      submission.current = null;
      if (!controller.signal.aborted) setSaving(false);
    }
  };
  const current = deck?.[index];
  const completed = daily?.results.filter(result => isDailyComplete(kind, result)).length ?? 0;
  const dailyControls: DailyQuestionControls | undefined = daily ? {
    result: daily.results.find(result => result.questionIndex === index),
    locked: saving || pendingAnswer !== null,
    submit: answer => { if (!pendingAnswer) void saveAnswer({ eventId: crypto.randomUUID(), setId: daily.id, questionIndex: index, answer }); },
  } : undefined;
  const next = () => setIndex(daily ? nextDailyQuestion(daily, index + 1) : index + 1);
  const returnToStart = () => { setDeck(null); setReload(value => value + 1); };
  return <section className="practice-panel">
    {!deck ? <>
      <h3>어떤 문장으로 연습할까요?</h3>
      <p className="practice-muted">한국 시간 기준 매일 AI가 새 영어 문제 5개를 만듭니다. 오늘의 문제와 제출한 답안은 내 계정에 저장되어 다른 브라우저에서도 이어 풀 수 있어요. 최근 150문장과 같은 문장은 제외하며 AI 해설은 틀릴 수 있어요.</p>
      <fieldset className="practice-source-picker" aria-label="문제 출처" disabled={generating}>
        <button aria-pressed={source === "daily"} onClick={() => { if (source !== "daily") setLoading(true); setSource("daily"); }}>오늘의 AI 문제 · 영어</button>
        <button aria-pressed={source === "saved"} onClick={() => { if (source !== "saved") setLoading(true); setSource("saved"); }}>내 저장 문장</button>
      </fieldset>
      <p>한 번에 최대 5문제. {kind === "quiz" ? "첫 선택이 정답인 문제를 풀면 하루 한 번 20 XP를 받아요." : "정답을 보지 않고 퍼즐을 완성하면 하루 한 번 25 XP를 받아요."} 오늘의 AI 문제와 내 저장 문장은 같은 유형의 일일 한도를 공유합니다. 한국 시간 자정 이후 새 풀이부터 다시 적립됩니다.</p>
      {kind === "quiz" && <p className="practice-muted">어투는 상황에 따라 겹칠 수 있어요. 이 퀴즈는 예문 또는 저장된 어투 분류를 기준으로 채점합니다.</p>}
      {loading && <p role="status">문제와 풀이 기록을 불러오는 중…</p>}
      {error && <div className="inline-error" role="alert">{error} <button onClick={() => setReload((value) => value + 1)}>다시 조회</button></div>}
      {source === "saved" && <p className="practice-muted">최신 저장 문장 100개 중 최대 5개를 골라 오늘의 연습으로 보관합니다. 당일에는 같은 문제와 풀이 기록으로 이어갑니다. 퍼즐은 2~24개 단어 블록을 사용합니다.</p>}
      {daily && !loading && <p>오늘의 문제 {completed}/{daily.phrases.length} 완료 · 풀이 결과 저장됨</p>}
      <button className="practice-primary" disabled={generating || loading} onClick={() => void start()}>{generating ? "오늘의 문제 불러오는 중…" : daily && completed === daily.phrases.length ? "오늘의 결과 보기" : daily?.results.length ? "이어서 풀기" : "연습 시작"} <ArrowRight size={17} /></button>
    </> : !current ? <div className="practice-finish"><Check size={36} /><h3>연습을 마쳤어요!</h3><p>{deck.length}문제 중 {daily?.results.filter(r => r.outcome === "correct").length ?? 0}문제를 해결했어요.</p>{daily && <ol aria-label="오늘의 풀이 결과">{daily.phrases.map((phrase, questionIndex) => <li key={phrase.id}><strong>{daily.results.find(r => r.questionIndex === questionIndex)?.outcome === "correct" ? "정답" : daily.results.find(r => r.questionIndex === questionIndex)?.outcome === "revealed" ? "정답 확인" : "오답"}</strong> · {phrase.translatedText}<p>{phrase.contextNote}</p></li>)}</ol>}<button className="practice-primary" onClick={returnToStart}>다른 문장으로 연습</button></div> : <>
      <div className="practice-progress"><span>{source === "saved" ? "내 저장 문장" : "오늘의 AI 문제"}</span><strong>{index + 1} / {deck.length}</strong></div>
      {daily && (kind === "quiz" ? <QuizQuestion key={`${current.id}-${index}`} phrase={current} daily={dailyControls!} onNext={next} />
        : <PuzzleQuestion key={`${current.id}-${index}`} phrase={current} daily={dailyControls!} onNext={next} />)}
      {saving && <p role="status">답안과 포인트를 저장하고 있어요…</p>}
      {pendingAnswer && !saving && <div className="inline-error" role="alert">{error} 저장 여부를 확인할 때까지 다음 문제로 넘어가지 않습니다. <button type="button" onClick={() => void saveAnswer(pendingAnswer)}>같은 답안 다시 저장</button></div>}
    </>}
  </section>;
}


function ChatPractice({ onSaved }: { onSaved: () => void }) {
  const userId = useSessionUserId();
  const [scenario, setScenario] = useState<RoleplayRequest["scenario"]>("cafe");
  const [language, setLanguage] = useState<TargetLanguage>("ja");
  const [turns, setTurns] = useState<Array<{ user: string; response: RoleplayReply }>>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const sessionId = useRef("");
  const [unconfirmed, setUnconfirmed] = useState<ChatTurnInput | null>(null);
  const [responseLost, setResponseLost] = useState(false);
  const [confirmedTurns, setConfirmedTurns] = useState(0);
  const [completionPoints, setCompletionPoints] = useState<number | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [turns, pending]);
  const send = async () => {
    if (!draft.trim() || controller.current || confirmedTurns >= 4 || responseLost) return;
    const message = unconfirmed?.messages.at(-1)?.content ?? draft.trim();
    const abort = new AbortController();
    controller.current = abort;
    setPending(message);
    setError("");
    try {
      const headers = { "Content-Type": "application/json", [studyPointsAccountHeader]: userId };
      if (!sessionId.current) {
        const started = await readJson<{ sessionId: string }>(await fetch("/api/study/chat", {
          method: "PUT", headers, body: JSON.stringify({ scenario, language }), signal: abort.signal,
        }));
        if (abort.signal.aborted) return;
        sessionId.current = started.sessionId;
      }
      let submitted = unconfirmed;
      if (!submitted) {
        const messages: RoleplayRequest["messages"] = turns.flatMap((turn) => [{ role: "user" as const, content: turn.user }, { role: "assistant" as const, content: turn.response.reply }]);
        messages.push({ role: "user", content: message });
        submitted = { sessionId: sessionId.current, eventId: crypto.randomUUID(), scenario, language, messages };
        setUnconfirmed(submitted);
      }
      const response = await fetch("/api/study/chat", { method: "POST", headers, body: JSON.stringify(submitted), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(185_000)]) });
      const data = chatReceiptSchema.parse(await readJson(response));
      if (abort.signal.aborted) return;
      setUnconfirmed(null);
      setConfirmedTurns(data.turns);
      if (data.turns >= 4) setCompletionPoints(data.replayed ? null : data.points);
      onSaved();
      if (data.replayed || !data.response) {
        setResponseLost(true);
        setError("이 응답은 서버에서 이미 처리됐어요. 대화 원문을 저장하지 않아 답변을 복원할 수 없습니다. 완료 포인트는 유지되며 새 대화로 시작해 주세요.");
        return;
      }
      setTurns((value) => [...value, { user: message, response: data.response! }]);
      setDraft("");
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error && caught.name === "TimeoutError" ? "응답 시간이 초과됐어요. 다시 시도해 주세요." : caught instanceof Error ? caught.message : "답변을 받지 못했어요.");
    } finally {
      if (controller.current === abort) { controller.current = null; setPending(""); }
    }
  };
  const reset = () => { controller.current?.abort(); controller.current = null; setUnconfirmed(null); setResponseLost(false); setConfirmedTurns(0); setCompletionPoints(null); setPending(""); setTurns([]); setDraft(""); setError(""); sessionId.current = ""; onSaved(); };
  return <section className="practice-panel chat-practice">
    <div className="chat-settings"><label>상황<select value={scenario} disabled={Boolean(pending) || confirmedTurns > 0 || Boolean(unconfirmed)} onChange={(event) => setScenario(event.target.value as RoleplayRequest["scenario"])}>{Object.entries(scenarios).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label><label>연습 언어<select value={language} disabled={Boolean(pending) || confirmedTurns > 0 || Boolean(unconfirmed)} onChange={(event) => setLanguage(event.target.value as TargetLanguage)}>{languages.map((item) => <option key={item.code} value={item.code}>{item.nativeName}</option>)}</select></label><button className="practice-secondary" onClick={reset}><RotateCcw size={16} />새 대화</button></div>
    <div className="chat-goal"><strong>{scenarios[scenario].goal}</strong><span>4회 대화 완료 시 하루 한 번 +35 XP · {confirmedTurns}/4 완료</span></div>
    <p className="practice-muted">AI 피드백은 틀릴 수 있어요. 서버에는 완료 횟수와 변조 확인용 해시만 저장하며 대화 원문은 저장하지 않습니다. 학습 모드를 나가면 대화 화면은 초기화됩니다.</p>
    <div className="chat-transcript" ref={transcript} role="log" aria-label="롤플레이 대화" aria-live="polite">
      {turns.length === 0 && !pending && <div className="chat-welcome"><MessageSquare size={30} /><p>선택한 언어로 먼저 말을 걸어보세요.</p><span>짧은 한 문장이면 충분해요.</span></div>}
      {turns.map((turn, index) => <div key={index} className="chat-turn"><div className="chat-bubble chat-user"><small>나</small><p>{turn.user}</p></div><div className="chat-bubble chat-ai"><small>AI 연습 파트너</small><p lang={language}>{turn.response.reply}</p><div className="chat-coaching"><strong>어투 코칭</strong><p>{turn.response.feedback}</p><strong>추천 표현</strong><p lang={language}>{turn.response.suggestion}</p></div></div></div>)}
      {pending && <><div className="chat-bubble chat-user"><small>나</small><p>{pending}</p></div><div className="chat-pending" role="status"><LoaderCircle className="spin" size={18} />AI 응답과 저장 상태를 확인하고 있어요.</div></>}
    </div>
    {error && <div className="inline-error" role="alert">{error} 입력 내용은 유지했어요.</div>}
    {confirmedTurns >= 4 ? <div className="practice-feedback" role="status"><strong>대화 연습 완료!</strong><p>{completionPoints === null ? "완료 상태를 확인했어요. 적립 여부는 프로필의 적립 기록에서 확인해 주세요." : completionPoints > 0 ? `${completionPoints} XP를 적립했어요.` : "오늘 채팅 포인트는 이미 받았어요. 추가 적립 없이 대화 연습을 완료했습니다."}</p><button className="practice-primary" onClick={reset}>새 대화 시작</button></div> : responseLost ? <button className="practice-primary" onClick={reset}>새 대화 시작</button> : <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="chat-composer"><label htmlFor="practice-message" className="practice-muted">내 메시지 · {draft.length}/300</label><textarea id="practice-message" value={draft} maxLength={300} disabled={Boolean(pending) || Boolean(unconfirmed)} placeholder="연습할 외국어로 입력하세요…" onChange={(event) => setDraft(event.target.value)} /><div className="practice-actions"><button className="practice-primary" disabled={!draft.trim() || Boolean(pending)} type="submit"><Send size={16} />{unconfirmed ? "같은 요청 다시 확인" : "보내기"}</button>{pending && <button type="button" className="practice-secondary" onClick={() => { controller.current?.abort(); controller.current = null; setPending(""); setError("요청을 취소했어요. 같은 요청으로 저장 여부를 확인하거나 새 대화를 시작해 주세요."); }}>응답 취소</button>}</div></form>}
  </section>;
}
