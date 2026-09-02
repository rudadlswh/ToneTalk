import type { Metadata } from "next";
import { ProfileWorkspace } from "@/components/profile-workspace";

export const metadata: Metadata = { title: "Profile" };

export default function ProfilePage() {
  return <ProfileWorkspace />;
}
