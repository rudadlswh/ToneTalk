import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { safeAuthNext } from "@/lib/auth-navigation";
import { isGuestMode } from "@/server/guest-mode";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  const next = safeAuthNext(typeof params.next === "string" ? params.next : null);
  if (isGuestMode()) redirect(`/auth/guest?next=${encodeURIComponent(next)}`);
  return <LoginForm next={next} error={typeof params.error === "string" ? params.error : null} />;
}
