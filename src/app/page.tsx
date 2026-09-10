import { TranslateWorkspace } from "@/components/translate-workspace";
import { ProtectedWorkspace } from "@/components/protected-workspace";

export default function Home() {
  return <ProtectedWorkspace path="/"><TranslateWorkspace /></ProtectedWorkspace>;
}
