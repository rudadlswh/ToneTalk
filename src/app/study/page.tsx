import type { Metadata } from "next";
import { StudyPracticeWorkspace } from "@/components/study-practice-workspace";

export const metadata: Metadata = { title: "Study" };

export default function StudyPage() {
  return <StudyPracticeWorkspace />;
}
