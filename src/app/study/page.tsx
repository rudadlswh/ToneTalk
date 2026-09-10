import type { Metadata } from "next";
import { StudyPracticeWorkspace } from "@/components/study-practice-workspace";
import { ProtectedWorkspace } from "@/components/protected-workspace";

export const metadata: Metadata = { title: "Study" };

export default function StudyPage() {
  return <ProtectedWorkspace path="/study"><StudyPracticeWorkspace /></ProtectedWorkspace>;
}
