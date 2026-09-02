import "server-only";

import { appUsers } from "@/db/schema";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";

export async function getCurrentOwnerId() {
  const ownerId = getEnv().SINGLE_USER_ID;
  await db
    .insert(appUsers)
    .values({ id: ownerId, displayName: "ToneTalk Learner" })
    .onConflictDoNothing({ target: appUsers.id });
  return ownerId;
}
