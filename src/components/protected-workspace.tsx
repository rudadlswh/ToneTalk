import { redirect } from "next/navigation";
import { AuthenticationError, verifyUser } from "@/server/auth";
import { safeAuthNext } from "@/lib/auth-navigation";
import { SessionBoundary } from "@/components/session-boundary";
import { isGuestMode } from "@/server/guest-mode";

export async function ProtectedWorkspace({ children, path }: { children: React.ReactNode; path: string }) {
  let user;
  try { user = await verifyUser(); }
  catch (error) {
    if (isGuestMode()) redirect(`/auth/guest?next=${encodeURIComponent(safeAuthNext(path))}`);
    const reason = error instanceof AuthenticationError ? "" : "&error=unavailable";
    redirect(`/login?next=${encodeURIComponent(safeAuthNext(path))}${reason}`);
  }
  return <SessionBoundary userId={user.id}>{children}</SessionBoundary>;
}
