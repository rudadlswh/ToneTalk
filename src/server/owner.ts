import "server-only";

import { appUsers } from "@/db/schema";
import { db } from "@/server/db";
import { getEnv } from "@/server/env";

// Bootstrap only, NOT an authentication/session cache. Replace this owner resolver
// when introducing email login. Coalesce parallel startup reads in one instance.
let initialization: Promise<void> | undefined;

export async function getCurrentOwnerId() {
  const ownerId = getEnv().SINGLE_USER_ID;
  initialization ??= db.insert(appUsers)
    .values({ id: ownerId, displayName: "ToneTalk Learner" })
    .onConflictDoNothing({ target: appUsers.id })
    .then(() => {}).catch((error) => { initialization = undefined; throw error; });
  await initialization;
  return ownerId;
}
