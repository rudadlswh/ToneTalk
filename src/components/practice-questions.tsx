"use client";
import { useState } from "react";
import { ArrowRight, RotateCcw } from "lucide-react";
import { getLanguage } from "@/lib/languages";
import { practiceTones, puzzleWords, quizOptions, shuffle, type PracticePhrase } from "@/lib/study-practice";
import type { DailyAnswer, DailyResult } from "@/lib/daily-ai-practice";

export type DailyQuestionControls = { result?: DailyResult; locked: boolean; submit: (answer: DailyAnswer) => void };

export function QuizQuestion({ phrase, onNext, daily }: { phrase: PracticePhrase; onNext: () => void; daily: DailyQuestionControls }) {
  const [options] = useState(() => quizOptions(phrase.tone));
  const chosen = daily.result?.answer.type === "quiz" ? daily.result.answer.tone : null;
  return <>
    <p className="practice-muted">{getLanguage(phrase.targetLanguage)?.nativeName} · 이 문장에 가장 어울리는 어투는?</p>
    <h3 className="practice-sentence" lang={phrase.targetLanguage}>{phrase.translatedText}</h3>
    <div className="practice-options">{options.map((tone, index) => <button key={tone} disabled={chosen !== null || daily.locked} className={chosen !== null && tone === phrase.tone ? "is-correct" : chosen === tone ? "is-wrong" : ""} onClick={() => { if (chosen === null && !daily.locked) daily.submit({ type: "quiz", tone }); }}><span>{index + 1}</span>{practiceTones[tone].label}</button>)}</div>
    {chosen !== null && <div className="practice-feedback" role="status"><strong>{chosen === phrase.tone ? "정답이에요!" : `이번 문제의 정답은 ${practiceTones[phrase.tone].label}예요.`}</strong><p>{phrase.contextNote || practiceTones[phrase.tone].explanation}</p><p className="practice-muted">원문: {phrase.sourceText}</p><button className="practice-primary" onClick={onNext}>다음 <ArrowRight size={16} /></button></div>}
  </>;
}

export function PuzzleQuestion({ phrase, onNext, daily }: { phrase: PracticePhrase; onNext: () => void; daily: DailyQuestionControls }) {
  const [answer] = useState(() => puzzleWords(phrase.translatedText, phrase.targetLanguage));
  const [pool] = useState(() => {
    const shuffled = shuffle(answer.map((word, id) => ({ word, id })));
    if (shuffled.every((item, index) => item.id === index)) shuffled.push(shuffled.shift()!);
    return shuffled;
  });
  const [localSelected, setSelected] = useState<number[]>(() => daily?.result?.answer.type === "puzzle" ? daily.result.answer.order : []);
  const [dismissedResult, setDismissedResult] = useState<string>();
  const result = daily.result?.eventId === dismissedResult ? null : daily.result?.outcome ?? null;
  const done = result === "correct" || result === "revealed";
  const selected = done && daily?.result?.answer.type === "puzzle" ? daily.result.answer.order : localSelected;
  const clearFeedback = () => setDismissedResult(daily.result?.eventId);
  const check = () => {
    if (done || daily?.locked) return;
    daily.submit({ type: "puzzle", order: selected });
  };
  return <>
    <p className="practice-muted">{getLanguage(phrase.targetLanguage)?.nativeName} · {practiceTones[phrase.tone].label}을 사용해 완성해 보세요.</p>
    <h3 className="practice-sentence">{phrase.sourceText}</h3>
    <p className="practice-muted">단어를 눌러 순서대로 배치하세요. 선택한 단어를 다시 누르면 돌아갑니다.</p>
    <div className="puzzle-answer" role="group" aria-label="내가 만든 문장">{selected.length === 0 && <span>여기에 문장을 만들어 주세요</span>}{selected.map((id, position) => <button key={id} disabled={done || daily?.locked} lang={phrase.targetLanguage} aria-label={`${position + 1}번째 ${answer[id]} 제거`} onClick={() => { setSelected((value) => value.filter((item) => item !== id)); clearFeedback(); }}>{answer[id]}</button>)}</div>
    <div className="puzzle-bank" role="group" aria-label="단어 블록">{pool.map(({ word, id }) => <button key={id} lang={phrase.targetLanguage} disabled={done || daily?.locked || selected.includes(id)} onClick={() => { setSelected((value) => value.includes(id) ? value : [...value, id]); clearFeedback(); }}>{word}</button>)}</div>
    {!done && <div className="practice-actions"><button className="practice-primary" disabled={selected.length !== answer.length || daily.locked} onClick={check}>정답 확인</button><button className="practice-secondary" disabled={daily.locked} onClick={() => { setSelected([]); clearFeedback(); }}><RotateCcw size={15} />초기화</button><button className="practice-secondary" disabled={daily.locked} onClick={() => daily.submit({ type: "reveal" })}>정답 보기</button></div>}
    {result && <div className="practice-feedback" role="status"><strong>{result === "correct" ? "정확하게 완성했어요!" : result === "wrong" ? "저장된 문장과 순서가 달라요. 다시 조립해 보세요." : "정답을 확인했어요. 이번 문제는 XP가 지급되지 않아요."}</strong>{done && <><p lang={phrase.targetLanguage}>{phrase.translatedText}</p><p>{phrase.contextNote || practiceTones[phrase.tone].explanation}</p><button className="practice-primary" onClick={onNext}>다음 <ArrowRight size={16} /></button></>}</div>}
  </>;
}
