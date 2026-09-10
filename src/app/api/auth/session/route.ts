import { getAuthenticatedUser, withAuth } from "@/server/auth";

export const GET = withAuth(async () => Response.json({ user: await getAuthenticatedUser() }));
