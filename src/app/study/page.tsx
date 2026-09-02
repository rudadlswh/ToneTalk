import type { Metadata } from "next";
import { StudyWorkspace } from "@/components/study-workspace";

export const metadata: Metadata = { title: "Study" };

export default function StudyPage() {
  return <StudyWorkspace />;
}
