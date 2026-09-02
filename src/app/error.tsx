"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="page-wrap">
      <div className="saved-empty">
        <span className="empty-orbit"><TriangleAlert size={28} /></span>
        <h2>화면을 불러오지 못했어요</h2>
        <p>잠시 후 다시 시도해 주세요. 저장된 데이터는 그대로 유지됩니다.</p>
        <button type="button" className="secondary-button" onClick={reset}>
          <RotateCcw size={15} /> 다시 시도
        </button>
      </div>
    </div>
  );
}
