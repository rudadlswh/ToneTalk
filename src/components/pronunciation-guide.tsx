type PronunciationGuideProps = {
  romanization: string | null;
  hangulPronunciation: string | null;
};

export function PronunciationGuide({
  romanization,
  hangulPronunciation,
}: PronunciationGuideProps) {
  if (!romanization && !hangulPronunciation) return null;

  return (
    <div className="pronunciation-guide" aria-label="발음 표기">
      {romanization && (
        <p>
          <span>로마자</span>
          <span lang="en">{romanization}</span>
        </p>
      )}
      {hangulPronunciation && (
        <p>
          <span>한글 발음</span>
          <span lang="ko">{hangulPronunciation}</span>
        </p>
      )}
    </div>
  );
}
