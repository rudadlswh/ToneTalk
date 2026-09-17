"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Clipboard, LoaderCircle, Music2, Square, Volume2 } from "lucide-react";
import { LyricStudyCard } from "@/components/lyric-study-card";
import { parseLyricExplanation, type LyricExplanation } from "@/lib/lyric-explanation";
import { useSpeech } from "@/hooks/use-speech";
import { readJson } from "@/lib/api";
import { getLanguage, languages, sourceLanguages, type SourceLanguage, type TargetLanguage } from "@/lib/languages";
import { lyricsInputError, lyricsLimits, parseLyricsReply, splitLyrics, type LyricResult } from "@/lib/lyrics-contract";

// Original demonstration text, not lyrics retrieved from a song catalogue.
const example = "Morning light upon my window\nI will find a brand new way\n\nLittle steps will take me forward\nTo the dreams I chase today";

export function LyricsWorkspace() {
  const [text, setText] = useState("");
  const [sourceLanguage, setSourceLanguage] = useState<SourceLanguage>("auto");
  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("ko");
  const [results, setResults] = useState<Record<number, LyricResult>>({});
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showRomanization, setShowRomanization] = useState(true);
  const [showHangul, setShowHangul] = useState(true);
  const [explanations, setExplanations] = useState<Record<number, LyricExplanation>>({});
  const [explanationErrors, setExplanationErrors] = useState<Record<number, string>>({});
  const [explainingId, setExplainingId] = useState<number | null>(null);
  const locked = busy || explainingId !== null;
  const active = useRef<AbortController | null>(null);
  const { speak, stop, speakingId, speechError } = useSpeech();
  const lines = splitLyrics(text);
  const nonempty = lines.filter((line) => line.text);
  const completed = Object.keys(results).length;
  const finished = started && completed === nonempty.length && nonempty.length > 0;

  useEffect(() => () => { active.current?.abort(); active.current = null; }, []);

  const reset = () => {
    active.current?.abort();
    active.current = null;
    stop();
    setBusy(false);
    setResults({});
    setExplanations({});
    setExplanationErrors({});
    setExplainingId(null);
    setStarted(false);
    setError(null);
    setNotice(null);
  };

  const cancel = () => {
    active.current?.abort();
    active.current = null;
    setBusy(false);
    setExplainingId(null);
    setNotice(explainingId !== null ? "해설 생성을 중단했어요. 기본 번역은 유지되며 다시 요청할 수 있어요." : "중단했어요. 완료된 줄은 유지되며 이어서 번역할 수 있어요.");
  };

  const explain = async (id: number) => {
    if (active.current || explanations[id] || !results[id]) return;
    const controller = new AbortController();
    active.current = controller;
    setExplainingId(id);
    setExplanationErrors((previous) => ({ ...previous, [id]: "" }));
    setNotice(null);
    const input = { action: "explain" as const, text: lines[id].text, sourceLanguage: results[id].sourceLanguage };
    try {
      const response = await fetch("/api/lyrics", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
      });
      // Detail failures never discard the original translation or pronunciation.
      const body = await readJson<{ explanation: unknown }>(response);
      const explanation = parseLyricExplanation(body.explanation, input);
      if (active.current === controller) setExplanations((previous) => ({ ...previous, [id]: explanation }));
    } catch (error) {
      if (active.current === controller) setExplanationErrors((previous) => ({ ...previous, [id]: error instanceof Error && error.name === "TimeoutError" ? "응답 시간이 초과됐어요. 잠시 후 다시 시도해 주세요." : error instanceof Error ? error.message : "해설을 불러오지 못했어요." }));
    } finally {
      if (active.current === controller) { active.current = null; setExplainingId(null); }
    }
  };

  const translate = async () => {
    if (active.current) return;
    const validation = lyricsInputError(text);
    if (validation) { setError(validation); return; }
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setStarted(true);
    setError(null);
    setNotice(null);
    const pending = nonempty.filter((line) => !results[line.id]);
    try {
      for (let offset = 0; offset < pending.length; offset += lyricsLimits.batch) {
        const input = { sourceLanguage, targetLanguage, lines: pending.slice(offset, offset + lyricsLimits.batch) };
        const response = await fetch("/api/lyrics", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(input),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
        });
        const body = await readJson<unknown>(response);
        const batch = parseLyricsReply(body, input);
        if (active.current !== controller) return;
        setResults((previous) => ({ ...previous, ...Object.fromEntries(batch.map((line) => [line.id, line])) }));
      }
      if (active.current === controller) setNotice("모든 줄의 번역과 발음이 준비됐어요.");
    } catch (error) {
      if (active.current !== controller) return;
      setError(error instanceof Error && error.name === "TimeoutError"
        ? "응답 시간이 초과됐어요. 완료된 줄은 유지됩니다. 잠시 후 이어서 번역해 주세요."
        : error instanceof Error ? error.message : "번역하지 못했어요. 이어서 번역으로 다시 시도해 주세요.");
    } finally {
      if (active.current === controller) { active.current = null; setBusy(false); }
    }
  };

  const copy = async () => {
    const output = lines.map((line) => {
      if (!line.text) return "";
      const result = results[line.id];
      return [line.text, ...(result ? [result.translation,
        ...(showHangul ? [`한글 발음: ${result.hangulPronunciation}`] : []),
        ...(showRomanization ? [`로마자: ${result.romanization}`] : []),
        ...(explanations[line.id] ? ["단어 · 표현 풀이", ...explanations[line.id].words.map((word) => `${word.text} (${word.reading}${showHangul ? ` · ${word.hangulPronunciation}` : ""}) — ${word.meaning}\n${word.grammar}`), explanations[line.id].nuance] : []),
      ] : ["(미번역)"])].join("\n");
    }).join("\n\n");
    try { await navigator.clipboard.writeText(output); setNotice("현재 표시 중인 번역과 발음을 복사했어요."); }
    catch { setNotice("복사 권한이 없어요. 결과를 직접 선택해 복사해 주세요."); }
  };

  return (
    <div className="page-wrap lyrics-page">
      <header className="page-header">
        <div><span className="eyebrow">LEARN THROUGH MUSIC</span><h1>Lyrics</h1><p>노래 가사의 뜻을 이해하고, 원문 발음을 따라 읽어 보세요.</p></div>
        <span className="lyrics-mark" aria-hidden="true"><Music2 size={27} /></span>
      </header>
      <div className="lyrics-grid">
        <section className="composer-panel lyrics-composer" aria-label="가사 입력">
          <div className="lyrics-language-controls">
            <label>가사 언어<select value={sourceLanguage} disabled={locked} onChange={(event) => { reset(); setSourceLanguage(event.target.value as SourceLanguage); }}>
              {sourceLanguages.map((language) => <option key={language.code} value={language.code}>{language.nativeName}</option>)}
            </select></label>
            <label>번역 언어<select value={targetLanguage} disabled={locked} onChange={(event) => { reset(); setTargetLanguage(event.target.value as TargetLanguage); }}>
              {languages.map((language) => <option key={language.code} value={language.code}>{language.nativeName}</option>)}
            </select></label>
          </div>
          <label className="section-label" htmlFor="lyrics-input">가사 붙여 넣기</label>
          <textarea id="lyrics-input" value={text} disabled={locked} maxLength={lyricsLimits.characters} placeholder={"가사를 줄바꿈 그대로 붙여 넣어 주세요.\n빈 줄과 반복되는 후렴도 유지돼요."}
            onChange={(event) => { reset(); setText(event.target.value); }} />
          <div className="lyrics-input-meta"><span>{text.length.toLocaleString()} / 6,000자 · 최대 80줄</span><button type="button" disabled={locked} onClick={() => { reset(); setText(example); setSourceLanguage("en"); }}>창작 예문 넣기</button></div>
          <p className="lyrics-note">직접 입력한 가사만 번역합니다. 노래 검색·가사 자동 수집은 지원하지 않아요. 입력과 결과는 DB에 저장되지 않으며 탭을 떠나면 사라집니다.</p>
          {busy ? <button className="primary-button" type="button" onClick={cancel}><Square size={16} />번역 중단</button>
            : <button className="primary-button" type="button" disabled={!text.trim() || finished || locked} onClick={() => void translate()}><Music2 size={18} />{finished ? "번역 완료" : started ? "이어서 번역" : "번역 · 발음 보기"}</button>}
          {error && <p className="inline-error" role="alert">{error}</p>}
        </section>
        <section className="results-panel lyrics-results" aria-label="가사 번역 결과" aria-busy={busy}>
          <div className="lyrics-result-header"><h2>한 줄씩 깊이 읽기</h2><button type="button" className="icon-button" disabled={!completed} aria-label="가사 번역과 발음 복사" onClick={() => void copy()}><Clipboard size={18} /></button></div>
          <div className="lyrics-display-options">
            <label><input type="checkbox" checked={showHangul} onChange={(event) => setShowHangul(event.target.checked)} />한글 발음</label>
            <label><input type="checkbox" checked={showRomanization} onChange={(event) => setShowRomanization(event.target.checked)} />로마자 발음</label>
          </div>
          <p className="lyrics-note">발음은 번역문이 아닌 <strong>원문 가사</strong>의 읽는 법입니다. AI 번역과 발음은 부정확할 수 있고, 실제 노래의 발음·박자와 다를 수 있어요.</p>
          <p className="lyrics-note">번역 후 각 줄의 <strong>단어 · 문법 자세히 보기</strong>를 누르면 일본어 후리가나와 한국어 학습 해설을 추가로 불러옵니다.</p>
          {!started ? <div className="lyrics-empty"><Music2 size={36} /><h3>좋아하는 가사로 시작하세요</h3><p>원문 → 번역 → 발음을 함께 볼 수 있어요.</p></div> : <>
            <div className="lyrics-progress" role="status">{busy ? <LoaderCircle size={16} className="spin" /> : finished ? <Check size={16} /> : null}{completed} / {nonempty.length}줄 완료{busy && " · 최대 10줄씩 번역 중"}</div>
            {busy && <p className="lyrics-note">로컬 AI 성능에 따라 한 묶음에 1분 이상 걸릴 수 있어요.</p>}
            <div className="lyrics-lines">{lines.map((line) => {
              if (!line.text) return <div className="lyrics-stanza-break" aria-hidden="true" key={line.id} />;
              const result = results[line.id];
              return <article className="lyric-line" key={line.id}>
                <div className="lyric-line-heading"><span>{line.id + 1}{result && ` · ${getLanguage(result.sourceLanguage)?.nativeName}`}</span>
                  {result && <button type="button" className={`icon-button compact ${speakingId === `lyric-${line.id}` ? "is-speaking" : ""}`} aria-label={`${line.id + 1}줄 원문 ${speakingId === `lyric-${line.id}` ? "읽기 중지" : "듣기"}`} onClick={() => speak({ id: `lyric-${line.id}`, text: line.text, language: result.sourceLanguage })}>{speakingId === `lyric-${line.id}` ? <Square size={14} /> : <Volume2 size={16} />}</button>}
                </div>
                {result ? <>
                  <LyricStudyCard text={line.text} result={result} targetLanguage={targetLanguage} explanation={explanations[line.id]} showRomanization={showRomanization} showHangul={showHangul} />
                  {!explanations[line.id] && <div className="lyric-detail-action">
                    {explainingId === line.id ? <><p className="lyrics-note" role="status"><LoaderCircle size={14} className="spin" /> 단어와 문법을 분석하고 있어요. 1분 이상 걸릴 수 있어요.</p><button type="button" onClick={cancel}>해설 생성 중단</button></>
                      : <button type="button" disabled={locked} onClick={() => void explain(line.id)}>{explanationErrors[line.id] ? "상세 해설 다시 시도" : "단어 · 문법 자세히 보기"}</button>}
                    {explanationErrors[line.id] && <p className="inline-error" role="alert">{explanationErrors[line.id]}</p>}
                  </div>}
                </> : <><p className="lyric-original" lang={sourceLanguage === "auto" ? undefined : sourceLanguage}>{line.text}</p><p className="lyrics-note">번역 대기 중</p></>}
              </article>;
            })}</div>
          </>}
        </section>
      </div>
      {(notice || speechError) && <div className="toast" role="status">{speechError ?? notice}</div>}
    </div>
  );
}
