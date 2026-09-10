import type { Metadata } from "next";
import { LoginForm } from "@/components/login-form";
import { safeAuthNext } from "@/lib/auth-navigation";

export const metadata: Metadata = { title: "로그인", robots: { index: false, follow: false } };

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const params = await searchParams;
  return <LoginForm next={safeAuthNext(typeof params.next === "string" ? params.next : null)} error={typeof params.error === "string" ? params.error : null} />;
}
