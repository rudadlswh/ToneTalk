"use client";
import { useState, type FormEvent } from "react";
import { Sparkles } from "lucide-react";
import { safeAuthNext } from "@/lib/auth-navigation";

export function LoginForm({ next, error }: { next: string; error: string | null }) {
  const [signup, setSignup] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(error ? "아이디와 비밀번호로 다시 로그인해 주세요." : null);
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    if (signup && password !== form.get("confirm")) { setMessage("비밀번호가 일치하지 않습니다."); return; }
    setPending(true); setMessage(null);
    try {
      const response = await fetch(`/api/auth/${signup ? "signup" : "login"}`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: form.get("username"), password }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "로그인에 실패했습니다.");
      window.location.replace(`/auth/complete?next=${encodeURIComponent(safeAuthNext(next))}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "잠시 후 다시 시도해 주세요."); }
    finally { setPending(false); }
  };
  return <main className="auth-page"><section className="auth-card" aria-labelledby="login-title">
    <span className="brand-mark"><Sparkles size={24} /></span><p className="section-label">ToneTalk</p>
    <h1 id="login-title">{signup ? "나만의 계정 만들기" : "나만의 표현장으로 시작하세요"}</h1>
    <p>이메일 인증 없이 아이디와 비밀번호로 시작하세요. 저장 문장과 학습 기록은 계정별로 보관됩니다.</p>
    <form onSubmit={submit} key={String(signup)}>
      <label htmlFor="username">아이디</label>
      <input id="username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} pattern="[A-Za-z0-9_]{4,24}" minLength={4} maxLength={24} required placeholder="영문·숫자·밑줄 4~24자" disabled={pending} />
      <label htmlFor="password">비밀번호</label>
      <input id="password" name="password" type="password" autoComplete={signup ? "new-password" : "current-password"} minLength={8} maxLength={128} required disabled={pending} />
      {signup && <><label htmlFor="confirm">비밀번호 확인</label><input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={8} maxLength={128} required disabled={pending} /></>}
      <button type="submit" disabled={pending}>{pending ? "처리 중…" : signup ? "가입하고 시작하기" : "로그인"}</button>
      <button type="button" disabled={pending} onClick={() => { setSignup(!signup); setMessage(null); }}>{signup ? "이미 계정이 있나요? 로그인" : "처음이신가요? 회원가입"}</button>
    </form>
    {message && <div className="inline-error" role="alert">{message}</div>}
    <small>아이디는 대소문자를 구분하지 않습니다. 이메일을 수집하지 않아 비밀번호 자동 찾기는 제공하지 않습니다. 기존 이메일 계정 기록은 새 계정으로 자동 이전되지 않습니다.</small>
  </section></main>;
}
