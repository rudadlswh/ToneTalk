"use client";
import { useState } from "react";
import { readJson } from "@/lib/api";

export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const signOut = async () => {
    setBusy(true); setError(null);
    try {
      await readJson(await fetch("/api/auth/logout", { method: "POST" }));
      if (typeof BroadcastChannel !== "undefined") {
        const channel = new BroadcastChannel("tonetalk-auth");
        channel.postMessage("signed-out"); channel.close();
      }
      window.location.replace("/login");
    } catch (error) { setError(error instanceof Error ? error.message : "로그아웃에 실패했습니다."); setBusy(false); }
  };
  return <div className="sign-out-control"><button type="button" onClick={signOut} disabled={busy}>{busy ? "로그아웃 중…" : "로그아웃"}</button>{error && <p role="alert">{error}</p>}</div>;
}
