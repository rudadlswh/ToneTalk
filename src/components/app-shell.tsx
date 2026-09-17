"use client";

import Link from "next/link";
import { AiProviderContext } from "@/components/ai-provider";
import { usePathname } from "next/navigation";
import {
  BookMarked,
  Brain,
  Languages,
  Music2,
  Sparkles,
  UserRound,
} from "lucide-react";

const navigation = [
  { href: "/", label: "번역", icon: Languages, enabled: true },
  { href: "/saved", label: "저장 문장", icon: BookMarked, enabled: true },
  { href: "/study", label: "학습", icon: Brain, enabled: true },
  { href: "/lyrics", label: "가사", icon: Music2, enabled: true },
  { href: "/profile", label: "프로필", icon: UserRound, enabled: true },
];

export function AppShell({ children, provider = "ollama" }: { children: React.ReactNode; provider?: "ollama" | "gemini" }) {
  const pathname = usePathname();

  if (pathname === "/login" || pathname.startsWith("/auth/")) return children;

  return (
    <AiProviderContext.Provider value={provider}>
    <div className="app-shell">
      <aside className="side-nav" aria-label="주요 메뉴">
        <Link href="/" className="brand-lockup" aria-label="ToneTalk 홈">
          <span className="brand-mark"><Sparkles size={20} /></span>
          <span>ToneTalk</span>
        </Link>
        <nav className="nav-list">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            if (!item.enabled) {
              return (
                <span className="nav-item is-disabled" key={item.href} aria-disabled="true">
                  <Icon size={20} />
                  <span>{item.label}</span>
                  <span className="soon-badge">Soon</span>
                </span>
              );
            }
            return (
              <Link className={`nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href}>
                <Icon size={20} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="local-model-card">
          <span className="status-dot" />
          <div>
            <strong>{provider === "gemini" ? "Gemini API" : "Local & private"}</strong>
            <span>{provider === "gemini" ? "Google cloud" : "Private Ollama"}</span>
          </div>
        </div>
      </aside>

      <main className="main-content">{children}</main>

      <nav className="bottom-nav" aria-label="모바일 주요 메뉴">
        {navigation.map((item) => {
          const Icon = item.icon;
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          if (!item.enabled) {
            return (
              <span className="bottom-nav-item is-disabled" key={item.href} aria-disabled="true">
                <Icon size={20} />
                <span>{item.label}</span>
              </span>
            );
          }
          return (
            <Link className={`bottom-nav-item ${active ? "is-active" : ""}`} href={item.href} key={item.href}>
              <Icon size={20} />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </div>
    </AiProviderContext.Provider>
  );
}
