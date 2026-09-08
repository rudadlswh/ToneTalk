import type { LyricResult } from "@/lib/lyrics-contract";
import type { LyricExplanation } from "@/lib/lyric-explanation";

type Props = {
  text: string;
  result: LyricResult;
  targetLanguage: string;
  explanation?: LyricExplanation;
  showRomanization: boolean;
  showHangul: boolean;
};

export function LyricStudyCard({ text, result, targetLanguage, explanation, showRomanization, showHangul }: Props) {
  return <div className="lyric-study-content">
    <div className="lyric-reading-hero">
      {showRomanization && <p className="lyric-romanization" aria-label="원문 로마자 발음">{result.romanization}</p>}
      <p className="lyric-original" lang={result.sourceLanguage}>
        {explanation ? explanation.segments.map((segment, index) =>
          result.sourceLanguage === "ja" && segment.reading
            ? <ruby key={index}>{segment.text}<rp>(</rp><rt>{segment.reading}</rt><rp>)</rp></ruby>
            : <span key={index}>{segment.text}</span>,
        ) : text}
      </p>
      <p className="lyric-translation" lang={targetLanguage}><span>{result.translation}</span></p>
      {showHangul && <p className="lyric-hangul" lang="ko" aria-label="원문 한글 발음">{result.hangulPronunciation}</p>}
    </div>
    {explanation && <div className="lyric-explanation">
      <h3>단어 · 표현 풀이 <span>문장 속 의미</span></h3>
      <dl className="lyric-vocabulary">{explanation.words.map((word) => <div className="lyric-vocabulary-row" key={word.text}>
        <dt><strong lang={result.sourceLanguage}>{word.text}</strong><span className="word-reading">{word.reading}</span>{showHangul && <span className="word-hangul">{word.hangulPronunciation}</span>}</dt>
        <dd><strong>{word.meaning}</strong><p>{word.grammar}</p></dd>
      </div>)}</dl>
      <div className="lyric-nuance"><h3>이 문장은 이렇게 이해해요</h3><p>{explanation.nuance}</p></div>
      <p className="lyrics-note">AI 학습 해설 · 후리가나와 문법 해석은 문맥에 따라 달라질 수 있어요.</p>
    </div>}
  </div>;
}
