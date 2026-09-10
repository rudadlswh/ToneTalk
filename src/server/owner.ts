import "server-only";
import { sql } from "drizzle-orm";

import { appUsers } from "@/db/schema";
import { db } from "@/server/db";
import { getAuthenticatedUser, requestOwner } from "@/server/auth";

export async function getCurrentOwnerId() {
  return requestOwner(async () => {
    const user = await getAuthenticatedUser();
    // Auth UUID is the only identity. Never claim legacy rows by email.
    // Email is read from Auth, not duplicated in app_users (email can change).
    // Existing users take the indexed read branch, without a speculative insert.
    // ON CONFLICT still protects two simultaneous first requests.
    await db.execute(sql`insert into ${appUsers} (id, display_name)
      select ${user.id}, 'ToneTalk Learner'
      where not exists (select 1 from ${appUsers} where id = ${user.id})
      on conflict (id) do nothing`);
    return user.id;
  });
}
