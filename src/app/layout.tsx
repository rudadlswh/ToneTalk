import type { Metadata } from "next";
import { AppShell } from "@/components/app-shell";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "ToneTalk — Translate with nuance",
    template: "%s · ToneTalk",
  },
  description:
    "한 문장을 상황에 맞는 다섯 가지 말투로 번역하고 저장하는 로컬 AI 언어 학습 앱",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
