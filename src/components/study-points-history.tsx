"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import { readJson } from "@/lib/api";
import { studyPointLabels, type StudyPointsResponse } from "@/lib/study-points";

const earnedAt = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul", year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
});

export function StudyPointsHistory() {
  const [data, setData] = useState<StudyPointsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const request = useRef<AbortController | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    request.current = controller;
    void fetch("/api/study/points", { cache: "no-store", signal: controller.signal })
      .then(readJson<StudyPointsResponse>)
      .then((result) => { if (!controller.signal.aborted) { setData(result); setError(""); } })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "적립 기록을 불러오지 못했어요."); })
      .finally(() => { if (!controller.signal.aborted) { setLoading(false); request.current = null; } });
    return () => { controller.abort(); request.current?.abort(); };
  }, [reload]);

  const more = async () => {
    if (!data?.nextCursor || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/study/points?${new URLSearchParams({ cursor: data.nextCursor })}`, { cache: "no-store", signal: controller.signal });
      const result = await readJson<StudyPointsResponse>(response);
      if (!controller.signal.aborted) setData((previous) => ({ ...result, items: [...(previous?.items ?? []), ...result.items] }));
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "적립 기록을 불러오지 못했어요.");
    } finally {
      if (!controller.signal.aborted) { request.current = null; setLoading(false); }
    }
  };

  return <section className="settings-panel points-history" aria-labelledby="points-history-title">
    <div className="panel-heading"><div><span className="section-label">STUDY POINTS</span><h2 id="points-history-title">포인트 적립 기록</h2></div><Sparkles size={21} /></div>
    <div className="points-total"><span>누적 포인트</span><strong>{data ? `${data.totalPoints.toLocaleString("ko-KR")} XP` : "—"}</strong></div>
    {data?.items.length === 0 && <p className="points-empty">아직 적립 기록이 없어요. 스터디에서 첫 포인트를 모아 보세요.</p>}
    {Boolean(data?.items.length) && <ul className="points-list" aria-label="적립 내역">
      {data!.items.map((item) => <li key={item.id}><div><strong>{studyPointLabels[item.activity]}</strong><time dateTime={item.createdAt}>{earnedAt.format(new Date(item.createdAt))}</time></div><span>+{item.points} XP</span></li>)}
    </ul>}
    {loading && <p role="status">적립 기록을 불러오는 중…</p>}
    {error && <p className="inline-error" role="alert">{error} {!data && <button type="button" disabled={loading} onClick={() => { setLoading(true); setReload((value) => value + 1); }}>다시 시도</button>}</p>}
    {data?.nextCursor && <button type="button" className="practice-secondary" disabled={loading} onClick={() => void more()}>{error ? "다시 불러오기" : "이전 기록 더 보기"}</button>}
  </section>;
}
