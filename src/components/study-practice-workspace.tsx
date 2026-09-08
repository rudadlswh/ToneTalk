"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, Layers, LoaderCircle, MessageSquare, RotateCcw, Send, Sparkles, Target } from "lucide-react";
import { StudyWorkspace } from "@/components/study-workspace";
import { readJson } from "@/lib/api";
import type { SavedPhraseDto } from "@/lib/dto";
import { getLanguage, languages, type TargetLanguage } from "@/lib/languages";
import { isPuzzleCorrect, practiceTones, puzzleWords, quizOptions, scenarios, shuffle, starterPhrases, type PracticePhrase, type RoleplayReply, type RoleplayRequest } from "@/lib/study-practice";
import type { Tone } from "@/lib/translation-contract";

const activities = [
  { id: "quiz", title: "어투 뉘앙스 퀴즈", english: "Tone Quiz", xp: 20, icon: Target, description: "외국어 문장을 읽고 5가지 어투 중 어떤 뉘앙스인지 맞추며 자연스러운 어감 감각을 기릅니다.", level: "초급 · 뉘앙스 식별", feature: "4지선다형 · 즉각 해설" },
  { id: "chat", title: "상황별 롤플레이 채팅", english: "Chat Practice", xp: 35, icon: MessageSquare, description: "비즈니스 회의, 카페 주문, 친구와의 대화. 원하는 상황에서 AI와 대화하며 어투와 공손도 피드백을 받아보세요.", level: "중급 · 실전 회화", feature: "어투 분석 & 표현 추천" },
  { id: "puzzle", title: "단어 나열 퍼즐", english: "Word Scramble", xp: 25, icon: Layers, description: "뒤섞인 단어 블록을 올바른 순서로 조립하며 각 어투에 어울리는 문장 구조와 표현을 익힙니다.", level: "초급/중급 · 어순 완성", feature: "내 저장 문장 연동" },
] as const;
type Mode = typeof activities[number]["id"] | "review";

export function StudyPracticeWorkspace() {
  const [mode, setMode] = useState<Mode | null>(null);
  const [xp, setXp] = useState(0);
  const awarded = useRef(new Set<string>());
  const award = (key: string, points: number) => {
    if (awarded.current.has(key)) return;
    awarded.current.add(key);
    setXp((value) => value + points);
  };
  return (
    <>
      <div className="page-wrap practice-page">
        <header className="page-header practice-header">
          <div><span className="eyebrow">A LITTLE PRACTICE, EVERY DAY</span><h1>Study</h1><p>뜻을 아는 것에서, 자연스럽게 말하는 것으로.</p></div>
          <div className="practice-xp" aria-live="polite"><Sparkles size={17} /><strong>{xp} XP</strong><small>이번 연습 · 페이지를 떠나면 초기화</small></div>
        </header>
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
                    <span className="practice-reward"><Sparkles size={14} />+{activity.xp} XP</span>
                    <span className="practice-description">{activity.description}</span>
                    <span className="practice-tags"><span>{activity.level}</span><span>{activity.feature}</span></span>
                  </span><span className="practice-chevron"><ChevronRight size={23} /></span>
                </button>;
              })}
            </div>
            <button className="practice-review-link" onClick={() => setMode("review")}><BookOpen size={21} /><span><strong>저장 표현 복습</strong><small>기존 플래시카드와 간격 반복 학습을 이어가세요.</small></span><ArrowRight size={18} /></button>
            <p className="practice-footnote">퀴즈·퍼즐은 즉시 실행 · 채팅은 로컬 AI 연결 필요 · XP는 연습용 점수이며 복습 통계와 별개입니다.</p>
          </>
        )}
        {(mode === "quiz" || mode === "puzzle") && <PhrasePractice key={mode} kind={mode} onAward={award} />}
        {mode === "chat" && <ChatPractice onAward={award} />}
      </div>
      {mode === "review" && <StudyWorkspace />}
    </>
  );
}

function PhrasePractice({ kind, onAward }: { kind: "quiz" | "puzzle"; onAward: (key: string, points: number) => void }) {
  const [source, setSource] = useState("demo");
  const [saved, setSaved] = useState<PracticePhrase[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [deck, setDeck] = useState<PracticePhrase[] | null>(null);
  const [index, setIndex] = useState(0);
  const [correct, setCorrect] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch("/api/saved-phrases?limit=100", { signal: controller.signal, cache: "no-store" });
        const data = await readJson<{ items: SavedPhraseDto[] }>(response);
        setSaved(data.items);
      } catch (caught) {
        if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "저장 문장을 불러오지 못했어요.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [reload]);
  const all = source === "saved" ? saved : starterPhrases;
  const eligible = all.filter((item) => {
    if (kind !== "puzzle") return true;
    const length = puzzleWords(item.translatedText, item.targetLanguage).length;
    return length >= 2 && length <= 24;
  });
  const start = () => { setDeck(shuffle(eligible).slice(0, 5)); setIndex(0); setCorrect(0); };
  const current = deck?.[index];
  return <section className="practice-panel">
    {!deck ? <>
      <h3>어떤 문장으로 연습할까요?</h3>
      <div className="practice-source-picker" role="group" aria-label="문제 출처">
        <button aria-pressed={source === "demo"} onClick={() => setSource("demo")}>기본 예문 · 영어</button>
        <button aria-pressed={source === "saved"} onClick={() => setSource("saved")}>내 저장 문장 {loading ? "…" : `(${saved.length})`}</button>
      </div>
      <p>한 번에 최대 5문제. {kind === "quiz" ? "첫 선택이 정답이면 문제당 20 XP를 받아요." : "정답을 보지 않고 완성하면 문제당 25 XP를 받아요."} 같은 문제의 XP는 이번 연습에서 한 번만 지급됩니다.</p>
      {kind === "quiz" && <p className="practice-muted">어투는 상황에 따라 겹칠 수 있어요. 이 퀴즈는 예문 또는 저장된 어투 분류를 기준으로 채점합니다.</p>}
      {source === "saved" && loading && <p role="status">저장 문장을 불러오는 중…</p>}
      {source === "saved" && error && <div className="inline-error" role="alert">{error} <button onClick={() => setReload((value) => value + 1)}>다시 시도</button></div>}
      {source === "saved" && !loading && !error && eligible.length === 0 && <p>사용 가능한 문장이 없어요. 번역 문장을 저장하거나 기본 예문으로 시작해 보세요.{kind === "puzzle" && " 퍼즐은 2~24개 단어 블록의 문장을 사용합니다."}</p>}
      <button className="practice-primary" disabled={!eligible.length || (source === "saved" && (loading || Boolean(error)))} onClick={start}>연습 시작 <ArrowRight size={17} /></button>
    </> : !current ? <div className="practice-finish" role="status"><Check size={36} /><h3>연습을 마쳤어요!</h3><p>{deck.length}문제 중 {correct}문제를 해결했어요.</p><button className="practice-primary" onClick={() => setDeck(null)}>다른 문장으로 연습</button></div> : <>
      <div className="practice-progress"><span>{source === "saved" ? "내 저장 문장" : "기본 예문"}</span><strong>{index + 1} / {deck.length}</strong></div>
      {kind === "quiz" ? <QuizQuestion key={`${current.id}-${index}`} phrase={current} onResult={(success) => { if (success) { setCorrect((value) => value + 1); onAward(`quiz:${current.id}`, 20); } }} onNext={() => setIndex((value) => value + 1)} />
        : <PuzzleQuestion key={`${current.id}-${index}`} phrase={current} onResult={() => { setCorrect((value) => value + 1); onAward(`puzzle:${current.id}`, 25); }} onNext={() => setIndex((value) => value + 1)} />}
    </>}
  </section>;
}

function QuizQuestion({ phrase, onResult, onNext }: { phrase: PracticePhrase; onResult: (correct: boolean) => void; onNext: () => void }) {
  const [options] = useState(() => quizOptions(phrase.tone));
  const [chosen, setChosen] = useState<Tone | null>(null);
  return <>
    <p className="practice-muted">{getLanguage(phrase.targetLanguage)?.nativeName} · 이 문장에 가장 어울리는 어투는?</p>
    <h3 className="practice-sentence" lang={phrase.targetLanguage}>{phrase.translatedText}</h3>
    <div className="practice-options">{options.map((tone, index) => <button key={tone} disabled={chosen !== null} className={chosen !== null && tone === phrase.tone ? "is-correct" : chosen === tone ? "is-wrong" : ""} onClick={() => { if (chosen !== null) return; setChosen(tone); onResult(tone === phrase.tone); }}><span>{index + 1}</span>{practiceTones[tone].label}</button>)}</div>
    {chosen !== null && <div className="practice-feedback" role="status"><strong>{chosen === phrase.tone ? "정답이에요!" : `이번 문제의 정답은 ${practiceTones[phrase.tone].label}예요.`}</strong><p>{phrase.contextNote || practiceTones[phrase.tone].explanation}</p><p className="practice-muted">원문: {phrase.sourceText}</p><button className="practice-primary" onClick={onNext}>다음 <ArrowRight size={16} /></button></div>}
  </>;
}

function PuzzleQuestion({ phrase, onResult, onNext }: { phrase: PracticePhrase; onResult: () => void; onNext: () => void }) {
  const [answer] = useState(() => puzzleWords(phrase.translatedText, phrase.targetLanguage));
  const [pool] = useState(() => {
    const shuffled = shuffle(answer.map((word, id) => ({ word, id })));
    if (shuffled.every((item, index) => item.id === index)) shuffled.push(shuffled.shift()!);
    return shuffled;
  });
  const [selected, setSelected] = useState<number[]>([]);
  const [result, setResult] = useState<"correct" | "wrong" | "revealed" | null>(null);
  const done = result === "correct" || result === "revealed";
  const check = () => {
    if (done) return;
    const success = isPuzzleCorrect(selected.map((id) => answer[id]), answer);
    setResult(success ? "correct" : "wrong");
    if (success) onResult();
  };
  return <>
    <p className="practice-muted">{getLanguage(phrase.targetLanguage)?.nativeName} · {practiceTones[phrase.tone].label}로 완성해 보세요.</p>
    <h3 className="practice-sentence">{phrase.sourceText}</h3>
    <p className="practice-muted">단어를 눌러 순서대로 배치하세요. 선택한 단어를 다시 누르면 돌아갑니다.</p>
    <div className="puzzle-answer" role="group" aria-label="내가 만든 문장">{selected.length === 0 && <span>여기에 문장을 만들어 주세요</span>}{selected.map((id, position) => <button key={id} disabled={done} lang={phrase.targetLanguage} aria-label={`${position + 1}번째 ${answer[id]} 제거`} onClick={() => { setSelected((value) => value.filter((item) => item !== id)); setResult(null); }}>{answer[id]}</button>)}</div>
    <div className="puzzle-bank" role="group" aria-label="단어 블록">{pool.map(({ word, id }) => <button key={id} lang={phrase.targetLanguage} disabled={done || selected.includes(id)} onClick={() => { setSelected((value) => value.includes(id) ? value : [...value, id]); setResult(null); }}>{word}</button>)}</div>
    {!done && <div className="practice-actions"><button className="practice-primary" disabled={selected.length !== answer.length} onClick={check}>정답 확인</button><button className="practice-secondary" onClick={() => { setSelected([]); setResult(null); }}><RotateCcw size={15} />초기화</button><button className="practice-secondary" onClick={() => setResult("revealed")}>정답 보기</button></div>}
    {result && <div className="practice-feedback" role="status"><strong>{result === "correct" ? "정확하게 완성했어요!" : result === "wrong" ? "저장된 문장과 순서가 달라요. 다시 조립해 보세요." : "정답을 확인했어요. 이번 문제는 XP가 지급되지 않아요."}</strong>{done && <><p lang={phrase.targetLanguage}>{phrase.translatedText}</p><p>{phrase.contextNote || practiceTones[phrase.tone].explanation}</p><button className="practice-primary" onClick={onNext}>다음 <ArrowRight size={16} /></button></>}</div>}
  </>;
}

function ChatPractice({ onAward }: { onAward: (key: string, points: number) => void }) {
  const [scenario, setScenario] = useState<RoleplayRequest["scenario"]>("cafe");
  const [language, setLanguage] = useState<TargetLanguage>("ja");
  const [turns, setTurns] = useState<Array<{ user: string; response: RoleplayReply }>>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const transcript = useRef<HTMLDivElement | null>(null);
  const sessionId = useRef("");
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { if (transcript.current) transcript.current.scrollTop = transcript.current.scrollHeight; }, [turns, pending]);
  const send = async () => {
    if (!draft.trim() || controller.current || turns.length >= 4) return;
    const message = draft.trim();
    const abort = new AbortController();
    controller.current = abort;
    if (!sessionId.current) sessionId.current = crypto.randomUUID();
    setPending(message);
    setError("");
    try {
      const messages: RoleplayRequest["messages"] = turns.flatMap((turn) => [{ role: "user" as const, content: turn.user }, { role: "assistant" as const, content: turn.response.reply }]);
      messages.push({ role: "user", content: message });
      const response = await fetch("/api/study/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario, language, messages }), signal: AbortSignal.any([abort.signal, AbortSignal.timeout(185_000)]) });
      const data = await readJson<RoleplayReply>(response);
      if (abort.signal.aborted) return;
      setTurns((value) => [...value, { user: message, response: data }]);
      setDraft("");
      if (turns.length === 3) onAward(`chat:${sessionId.current}`, 35);
    } catch (caught) {
      if (!abort.signal.aborted) setError(caught instanceof Error && caught.name === "TimeoutError" ? "응답 시간이 초과됐어요. 다시 시도해 주세요." : caught instanceof Error ? caught.message : "답변을 받지 못했어요.");
    } finally {
      if (controller.current === abort) { controller.current = null; setPending(""); }
    }
  };
  const reset = () => { controller.current?.abort(); controller.current = null; setPending(""); setTurns([]); setDraft(""); setError(""); sessionId.current = ""; };
  return <section className="practice-panel chat-practice">
    <div className="chat-settings"><label>상황<select value={scenario} disabled={Boolean(pending) || turns.length > 0} onChange={(event) => setScenario(event.target.value as RoleplayRequest["scenario"])}>{Object.entries(scenarios).map(([id, item]) => <option key={id} value={id}>{item.label}</option>)}</select></label><label>연습 언어<select value={language} disabled={Boolean(pending) || turns.length > 0} onChange={(event) => setLanguage(event.target.value as TargetLanguage)}>{languages.map((item) => <option key={item.code} value={item.code}>{item.nativeName}</option>)}</select></label><button className="practice-secondary" onClick={reset}><RotateCcw size={16} />새 대화</button></div>
    <div className="chat-goal"><strong>{scenarios[scenario].goal}</strong><span>4회 대화 완료 시 +35 XP · {turns.length}/4 완료</span></div>
    <p className="practice-muted">AI 연습 파트너입니다. 피드백은 틀릴 수 있어요. 대화는 DB에 저장하지 않으며 학습 모드를 나가면 초기화됩니다.</p>
    <div className="chat-transcript" ref={transcript} role="log" aria-label="롤플레이 대화" aria-live="polite">
      {turns.length === 0 && !pending && <div className="chat-welcome"><MessageSquare size={30} /><p>선택한 언어로 먼저 말을 걸어보세요.</p><span>짧은 한 문장이면 충분해요.</span></div>}
      {turns.map((turn, index) => <div key={index} className="chat-turn"><div className="chat-bubble chat-user"><small>나</small><p>{turn.user}</p></div><div className="chat-bubble chat-ai"><small>AI 연습 파트너</small><p lang={language}>{turn.response.reply}</p><div className="chat-coaching"><strong>어투 코칭</strong><p>{turn.response.feedback}</p><strong>추천 표현</strong><p lang={language}>{turn.response.suggestion}</p></div></div></div>)}
      {pending && <><div className="chat-bubble chat-user"><small>나</small><p>{pending}</p></div><div className="chat-pending" role="status"><LoaderCircle className="spin" size={18} />로컬 AI가 답변 중이에요. CPU에서는 1분 이상 걸릴 수 있어요.</div></>}
    </div>
    {error && <div className="inline-error" role="alert">{error} 입력 내용은 유지했어요.</div>}
    {turns.length >= 4 ? <div className="practice-feedback" role="status"><strong>대화 연습 완료! +35 XP</strong><p>추천 표현을 읽고 새 상황에서도 연습해 보세요.</p><button className="practice-primary" onClick={reset}>새 대화 시작</button></div> : <form onSubmit={(event) => { event.preventDefault(); void send(); }} className="chat-composer"><label htmlFor="practice-message" className="practice-muted">내 메시지 · {draft.length}/300</label><textarea id="practice-message" value={draft} maxLength={300} disabled={Boolean(pending)} placeholder="연습할 외국어로 입력하세요…" onChange={(event) => setDraft(event.target.value)} /><div className="practice-actions"><button className="practice-primary" disabled={!draft.trim() || Boolean(pending)} type="submit"><Send size={16} />보내기</button>{pending && <button type="button" className="practice-secondary" onClick={() => { controller.current?.abort(); controller.current = null; setPending(""); setError("요청을 취소했어요."); }}>응답 취소</button>}</div></form>}
  </section>;
}
