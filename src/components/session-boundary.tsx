"use client";
import { createContext, useContext, useEffect } from "react";

const SessionUserId = createContext<string | null>(null);
export function useSessionUserId() {
  const userId = useContext(SessionUserId);
  if (!userId) throw new Error("A verified session is required");
  return userId;
}

// Clear mounted results/router state when another tab changes accounts, or when
// returning to a previously cached page after logout. No data is persisted here.
export function SessionBoundary({ userId, children }: { userId: string; children: React.ReactNode }) {
  useEffect(() => {
    const controller = new AbortController();
    let checking = false;
    const check = async () => {
      if (checking || document.visibilityState === "hidden") return;
      checking = true;
      try {
        const response = await fetch("/api/auth/session", { cache: "no-store", signal: controller.signal });
        if (response.status === 401) { window.location.replace("/login"); return; }
        if (response.ok && (await response.json()).user.id !== userId) window.location.replace("/login");
      } catch { /* Transient network failures do not sign the user out. */ }
      finally { checking = false; }
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("tonetalk-auth") : null;
    if (channel) channel.onmessage = () => { window.location.replace("/login"); };
    const onPageShow = (event: PageTransitionEvent) => { if (event.persisted) window.location.reload(); };
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", check);
    document.addEventListener("visibilitychange", check);
    return () => {
      controller.abort(); channel?.close();
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", check);
      document.removeEventListener("visibilitychange", check);
    };
  }, [userId]);
  return <SessionUserId.Provider value={userId} key={userId}>{children}</SessionUserId.Provider>;
}
