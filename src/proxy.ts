import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { getAuthConfig } from "@/server/supabase-auth";

// Refresh page cookies only. APIs verify independently in withAuth, and data
// services resolve their owner independently: this proxy is not authorization.
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  response.headers.set("Cache-Control", "private, no-store");
  try {
    const { url, key } = getAuthConfig();
    const client = createServerClient(url, key, {
      cookieOptions: { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/" },
      global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000), cache: "no-store" }) },
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(values, headers) {
          values.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          values.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
          Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
          response.headers.set("Cache-Control", "private, no-store");
        },
      },
    });
    await client.auth.getClaims();
  } catch { /* ProtectedWorkspace fails closed and shows the login error. */ }
  return response;
}

export const config = { matcher: ["/", "/saved", "/study", "/study/mistakes", "/lyrics", "/profile", "/login"] };
