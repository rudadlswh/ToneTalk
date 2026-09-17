import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));

it.skipIf(process.env.STUDY_POINTS_DB_TEST !== "1")("upgrades legacy XP without loss, backfills KST days and rejects a second daily reward", async () => {
  if (process.env.DATABASE_SCHEMA !== "tonetalk_dev") throw new Error("Explicit dev connection required");
  const { pool } = await import("@/server/db");
  const schema = `reward_test_${randomUUID().replaceAll("-", "")}`;
  const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, "utf8")
    .replace("ARRAY['tonetalk_dev', 'tonetalk_prod']", `ARRAY['${schema}']`);
  const upgrade = migration("20260916033055_study_daily_reward_limit");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`CREATE SCHEMA "${schema}"; CREATE TABLE "${schema}".app_users(id varchar(64) primary key); INSERT INTO "${schema}".app_users VALUES ('a'),('b')`);
    await client.query(migration("20260914034151_study_points"));
    await client.query(`INSERT INTO "${schema}".study_point_events(id,owner_id,activity,activity_id,reward_day,points,created_at) VALUES
      ('old-1','a','quiz','q1',20000,20,'2026-09-14T14:59:59Z'),
      ('old-2','a','quiz','q2',20000,20,'2026-09-14T15:00:00Z'),
      ('old-3','a','quiz','q3',20000,20,'2026-09-14T15:00:01Z'),
      ('old-chat','a','chat','c1',0,35,now())`);
    const before = (await client.query(`SELECT id,owner_id,activity,activity_id,reward_day,points,created_at FROM "${schema}".study_point_events ORDER BY id`)).rows;
    await client.query(upgrade);
    await client.query(upgrade); // Safe re-application must not claim the other old duplicate.
    expect((await client.query(`SELECT id,owner_id,activity,activity_id,reward_day,points,created_at FROM "${schema}".study_point_events ORDER BY id`)).rows).toEqual(before);
    expect((await client.query(`SELECT id,credited_on::text FROM "${schema}".study_point_events WHERE activity='quiz' ORDER BY id`)).rows).toEqual([
      { id: "old-1", credited_on: "2026-09-14" }, { id: "old-2", credited_on: "2026-09-15" }, { id: "old-3", credited_on: null },
    ]);
    const insert = (id: string, owner = "a", activity = "chat") => client.query(`INSERT INTO "${schema}".study_point_events(id,owner_id,activity,activity_id,reward_day,points)
      VALUES($1,$2,$3,$1,$4,$5) ON CONFLICT DO NOTHING RETURNING credited_on=(now() AT TIME ZONE 'Asia/Seoul')::date AS today`,
      [id, owner, activity, activity === "chat" ? 0 : 20000, activity === "chat" ? 35 : 25]);
    expect((await insert("new-chat")).rows).toHaveLength(0); // Existing today's XP counts immediately.
    expect((await insert("new-puzzle", "a", "puzzle")).rows).toEqual([{ today: true }]);
    expect((await insert("repeat-puzzle", "a", "puzzle")).rows).toHaveLength(0);
    expect((await insert("other-account", "b")).rows).toEqual([{ today: true }]);
    await client.query("SAVEPOINT unique_test");
    await expect(client.query(`INSERT INTO "${schema}".study_point_events(id,owner_id,activity,activity_id,reward_day,points)
      VALUES ('must-fail','a','chat','different-session',0,35)`)).rejects.toMatchObject({ code: "23505", constraint: "study_point_events_daily_uidx" });
    await client.query("ROLLBACK TO SAVEPOINT unique_test");
    expect((await client.query(`SELECT relrowsecurity,has_table_privilege('anon',c.oid,'SELECT') AS anon_read,has_table_privilege('authenticated',c.oid,'INSERT') AS user_write FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname='study_point_events'`, [schema])).rows).toEqual([{ relrowsecurity: true, anon_read: false, user_write: false }]);
  } finally {
    await client.query("ROLLBACK"); client.release(); await pool.end();
  }
});
