import { passwordAuth } from "@/server/password-auth";
export const runtime = "nodejs";
export const POST = (request: Request) => passwordAuth(request, false);
