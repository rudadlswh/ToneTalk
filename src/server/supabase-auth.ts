import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export class AuthConfigurationError extends Error {
  constructor() { super("Supabase Auth is not configured"); this.name = "AuthConfigurationError"; }
}

export function getAuthConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key || !key.startsWith("sb_publishable_")) throw new AuthConfigurationError();
  return { url, key };
}

// Server-only authentication: no service-role key, client-supplied user ID,
// or browser localStorage session. Each request gets its own client.
export async function createAuthClient() {
  const { url, key } = getAuthConfig();
  const store = await cookies();
  return createServerClient(url, key, {
    cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
    global: { fetch: (input, init) => fetch(input, {
      ...init, cache: "no-store",
      signal: init?.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
    }) },
    cookies: {
      getAll: () => store.getAll(),
      setAll(values) {
        try { values.forEach(({ name, value, options }) => store.set(name, value, options)); }
        catch {
          // Server Component reads cannot write; the page proxy refreshes cookies.
          // All Route Handler responses are explicitly private/no-store.
        }
      },
    },
  });
}
