import type { Metadata } from "next";
import { ProtectedWorkspace } from "@/components/protected-workspace";
import { MistakeReviewWorkspace } from "@/components/mistake-review-workspace";

export const metadata: Metadata = { title: "오답 복습" };
export default function MistakesPage() {
  return <ProtectedWorkspace path="/study/mistakes"><MistakeReviewWorkspace /></ProtectedWorkspace>;
}
