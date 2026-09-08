import "server-only";
import { eq } from "drizzle-orm";
import { appUsers } from "@/db/schema";
import { db } from "@/server/db";
import { getCurrentOwnerId } from "@/server/owner";

export async function getSettings() {
  const ownerId = await getCurrentOwnerId();
  const [settings] = await db.select({ defaultTargetLanguage: appUsers.defaultTargetLanguage })
    .from(appUsers).where(eq(appUsers.id, ownerId)).limit(1);
  if (!settings) throw new Error("Settings not found");
  return settings;
}
