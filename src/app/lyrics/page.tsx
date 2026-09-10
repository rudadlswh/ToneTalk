import type { Metadata } from "next";
import { LyricsWorkspace } from "@/components/lyrics-workspace";
import { ProtectedWorkspace } from "@/components/protected-workspace";

export const metadata: Metadata = { title: "Lyrics" };

export default function LyricsPage() {
  return <ProtectedWorkspace path="/lyrics"><LyricsWorkspace /></ProtectedWorkspace>;
}
