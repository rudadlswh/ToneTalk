import { SavedWorkspace } from "@/components/saved-workspace";
import { ProtectedWorkspace } from "@/components/protected-workspace";

export default function SavedPage() {
  return <ProtectedWorkspace path="/saved"><SavedWorkspace /></ProtectedWorkspace>;
}
