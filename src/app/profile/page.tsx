import type { Metadata } from "next";
import { ProfileWorkspace } from "@/components/profile-workspace";
import { ProtectedWorkspace } from "@/components/protected-workspace";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <ProtectedWorkspace path="/profile"><ProfileWorkspace /></ProtectedWorkspace>;
}
