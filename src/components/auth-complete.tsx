"use client";
import { useEffect } from "react";

export function AuthComplete({ next }: { next: string }) {
  useEffect(() => {
    if (typeof BroadcastChannel !== "undefined") {
      const channel = new BroadcastChannel("tonetalk-auth");
      channel.postMessage("signed-in"); channel.close();
    }
    window.location.replace(next);
  }, [next]);
  return <main className="auth-page"><p role="status">로그인한 계정으로 이동하고 있어요…</p></main>;
}
