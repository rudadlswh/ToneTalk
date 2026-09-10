import { AuthComplete } from "@/components/auth-complete";
import { safeAuthNext } from "@/lib/auth-navigation";

export default async function CompletePage({ searchParams }: PageProps<"/auth/complete">) {
  const params = await searchParams;
  return <AuthComplete next={safeAuthNext(typeof params.next === "string" ? params.next : null)} />;
}
