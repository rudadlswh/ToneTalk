"use client";
import { useEffect, useState } from "react";
import { useSessionUserId } from "@/components/session-boundary";
import { readJson } from "@/lib/api";
import { aiUsageSchema, type AiUsage } from "@/lib/ai-usage";
import { studyPointsAccountHeader } from "@/lib/study-points";

export function AiUsagePanel() {
  const userId = useSessionUserId();
  const [usage, setUsage] = useState<AiUsage | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/ai/usage", { signal: controller.signal, cache: "no-store", headers: { [studyPointsAccountHeader]: userId } })
      .then(readJson).then(data => { if (!controller.signal.aborted) setUsage(aiUsageSchema.parse(data)); })
      .catch(error => { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "사용량을 불러오지 못했어요."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [userId, reload]);
  return <section className="system-panel" aria-label="AI 사용량">
    <div className="panel-heading"><h2>오늘의 AI 사용량</h2><button type="button" className="practice-secondary" disabled={loading} onClick={() => { setLoading(true); setError(""); setReload(value => value + 1); }}>새로고침</button></div>
    {loading ? <p role="status">사용량 확인 중…</p> : error ? <p className="inline-error" role="alert">{error}</p> : usage && <>
      <p><strong>{usage.used} / {usage.limit}회</strong> · 내 계정 {usage.remaining}회 남음</p>
      {!usage.enabled ? <p role="status">관리자가 새 AI 생성을 일시 중단했어요.</p> : !usage.available && <p role="status">서비스 한도 또는 장애로 대기 중 · 약 {Math.ceil(usage.retryAfterSeconds / 60)}분 후 다시 확인해 주세요.</p>}
      <p className="practice-muted">한국 시간 자정에 초기화됩니다. 실패·취소된 전송 시도도 포함하며 캐시 재사용은 제외합니다. Gemini의 실제 잔여 한도가 아니라 앱 자체 제한입니다. 전체 서비스 한도·동시 처리 상황에 따라 더 일찍 제한될 수 있어요.</p>
    </>}
  </section>;
}
