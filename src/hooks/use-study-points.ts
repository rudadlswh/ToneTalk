"use client";
import { useEffect, useRef, useState } from "react";
import { readJson } from "@/lib/api";
import { practiceDay } from "@/lib/study-practice";
import { readQueuedPoints, removeQueuedPoint, saveQueuedPoint, type QueuedStudyPoint } from "@/lib/study-point-outbox";
import { studyPointAwardResponseSchema, studyPointsAccountHeader, type StudyPointActivity, type StudyPointsResponse } from "@/lib/study-points";

type Award = QueuedStudyPoint & { status: "waiting" | "failed" | "sending" | "saved" | "unverified"; durable: boolean };
type PointsState = { totalPoints: number | null; loadError: string; saveError: string; storageError: string; notice: string; pending: number; failed: number; unverified: number };
type Actions = { award: (activity: StudyPointActivity, activityId: string) => void; retry: () => void; refresh: () => void };
const storageWarning = "브라우저 보관에 문제가 있어요. 미저장 포인트가 있다면 이 페이지를 나가기 전에 다시 저장해 주세요.";

export function useStudyPoints(userId: string) {
  const [state, setState] = useState<PointsState>({ totalPoints: null, loadError: "", saveError: "", storageError: "", notice: "", pending: 0, failed: 0, unverified: 0 });
  const actions = useRef<Actions | null>(null);

  useEffect(() => {
    let alive = true, running = false, reading = false, blockedUntil = 0;
    const lifetime = new AbortController();
    const awards = new Map<string, Award>();
    const accountHeaders = { [studyPointsAccountHeader]: userId };
    const publish = (patch: Partial<PointsState> = {}) => {
      if (!alive) return;
      const entries = [...awards.values()];
      setState((previous) => ({ ...previous, ...patch,
        totalPoints: patch.totalPoints == null ? previous.totalPoints : Math.max(previous.totalPoints ?? 0, patch.totalPoints),
        pending: entries.filter((entry) => entry.status === "waiting" || entry.status === "sending").length,
        failed: entries.filter((entry) => entry.status === "failed").length,
        unverified: entries.filter((entry) => entry.status === "unverified").length,
      }));
    };
    const persist = (entry: Award) => {
      try {
        saveQueuedPoint(userId, { input: entry.input, day: entry.day }, window.localStorage);
        entry.durable = true;
      } catch { publish({ storageError: storageWarning }); }
    };
    const restore = () => {
      try {
        const restored = readQueuedPoints(userId, window.localStorage);
        for (const entry of restored.entries) {
          if (!awards.has(entry.input.eventId)) awards.set(entry.input.eventId, { ...entry, status: "waiting", durable: true });
        }
        if (restored.invalid) publish({ storageError: "읽을 수 없는 미저장 포인트 기록이 있어요. 기록을 삭제하지 않고 보관했습니다." });
      } catch { publish({ storageError: storageWarning }); }
    };

    const flush = async () => {
      if (!alive || running) return;
      if (Date.now() < blockedUntil) {
        for (const entry of awards.values()) if (entry.status === "waiting") entry.status = "failed";
        publish({ saveError: "요청이 많아요. 잠시 후 포인트 다시 저장을 눌러 주세요." });
        return;
      }
      running = true;
      try {
        restore();
        if (![...awards.values()].some((entry) => entry.status !== "saved" && entry.status !== "unverified")) return;
        if (!navigator.onLine) throw new Error("인터넷 연결이 끊겼어요. 연결되면 포인트 저장을 다시 시도합니다.");
        // Check before replay, AND assert the same identity on each POST. Never
        // replay A's local queue using B's cookie, even across a concurrent login.
        const session = await readJson<{ user: { id: string } }>(await fetch("/api/auth/session", {
          cache: "no-store", signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(10_000)]),
        }));
        if (!alive) return;
        if (session.user.id !== userId) throw new Error("학습한 계정으로 다시 로그인해 주세요. 미저장 포인트는 보관됩니다.");
        for (const entry of awards.values()) {
          if (!alive) break;
          if (entry.status === "saved" || entry.status === "unverified") continue;
          if (!entry.durable) persist(entry);
          entry.status = "sending";
          publish({ saveError: "", notice: "" });
          // Serial replay avoids a burst of retries. A committed but lost reply
          // keeps its eventId in the outbox; the DB handles duplicate requests.
          const response = await fetch("/api/study/points", {
            method: "POST", headers: { ...accountHeaders, "Content-Type": "application/json" },
            body: JSON.stringify(entry.input), keepalive: true, signal: AbortSignal.timeout(20_000),
          });
          if (response.status === 429) {
            const seconds = Number(response.headers.get("Retry-After") ?? 60);
            blockedUntil = Date.now() + (Number.isFinite(seconds) ? Math.max(1, seconds) : 60) * 1000;
          }
          if (response.status === 409 && (await response.clone().json()).error?.code === "POINTS_PROOF_REQUIRED") {
            entry.status = "unverified"; // Preserve old evidence; do not retry forever or block later acknowledgements.
            publish();
            continue;
          }
          const result = studyPointAwardResponseSchema.parse(await readJson(response));
          entry.status = "saved";
          // A late reply may safely acknowledge only its captured account/event,
          // never another tab's array or the currently logged-in user's queue.
          try { removeQueuedPoint(userId, entry.input.eventId, window.localStorage); }
          catch { publish({ storageError: storageWarning }); }
          publish({ totalPoints: result.totalPoints, saveError: "", notice: result.awarded ? `포인트를 저장했어요. +${result.points} XP` : "이미 적립된 포인트의 저장을 확인했어요." });
        }
      } catch (error) {
        for (const entry of awards.values()) if (entry.status !== "saved" && entry.status !== "unverified") entry.status = "failed";
        publish({ saveError: error instanceof Error ? error.message : "포인트 저장에 실패했어요.", notice: "" });
      } finally { running = false; publish(); }
    };
    const load = async () => {
      if (reading || !alive) return;
      reading = true;
      try {
        const data = await readJson<StudyPointsResponse>(await fetch("/api/study/points", {
          headers: accountHeaders, cache: "no-store", signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(20_000)]),
        }));
        publish({ totalPoints: data.totalPoints, loadError: "" });
      } catch (error) { publish({ loadError: error instanceof Error ? error.message : "포인트를 불러오지 못했어요." }); }
      finally { reading = false; }
    };
    const retry = () => { void flush(); };
    actions.current = {
      award: (activity, activityId) => {
        const day = practiceDay();
        if ([...awards.values()].some((entry) => entry.input.activity === activity && entry.input.activityId === activityId && (activity === "chat" || entry.day === day))) return;
        const entry: Award = { input: { eventId: crypto.randomUUID(), activity, activityId }, day, status: "waiting", durable: false };
        awards.set(entry.input.eventId, entry);
        persist(entry); // Persist BEFORE the first network request, not on error.
        publish({ notice: "" });
        void flush();
      },
      retry,
      refresh: () => { void load(); },
    };
    void load(); void flush();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    return () => {
      alive = false; lifetime.abort(); actions.current = null;
      window.removeEventListener("online", retry); window.removeEventListener("focus", retry);
      // Pending POSTs keep running; persisted requests survive failed replies.
    };
  }, [userId]);

  return { ...state,
    award: (activity: StudyPointActivity, activityId: string) => actions.current?.award(activity, activityId),
    retry: () => actions.current?.retry(), refresh: () => actions.current?.refresh(),
  };
}
