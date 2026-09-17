-- Preserve every historical XP row and amount. Only one row per historical
-- KST date becomes the daily claim; other old rows intentionally stay NULL.
-- Apply within one transaction; ALTER TABLE holds the write lock throughout.
DO $migration$
DECLARE target_schema text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('ALTER TABLE %I.study_point_events ADD COLUMN IF NOT EXISTS credited_on date', target_schema);
    EXECUTE format($sql$
      WITH first_rewards AS (
        SELECT DISTINCT ON (owner_id, activity, (created_at AT TIME ZONE 'Asia/Seoul')::date)
          id, owner_id, activity, (created_at AT TIME ZONE 'Asia/Seoul')::date AS day
        FROM %1$I.study_point_events
        ORDER BY owner_id, activity, (created_at AT TIME ZONE 'Asia/Seoul')::date, created_at, id
      )
      UPDATE %1$I.study_point_events AS event SET credited_on = first_rewards.day
      FROM first_rewards
      WHERE event.id = first_rewards.id AND event.credited_on IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM %1$I.study_point_events AS claimed
          WHERE claimed.owner_id = first_rewards.owner_id AND claimed.activity = first_rewards.activity
            AND claimed.credited_on = first_rewards.day
        )
    $sql$, target_schema);
    EXECUTE format('ALTER TABLE %I.study_point_events ALTER COLUMN credited_on SET DEFAULT (now() AT TIME ZONE ''Asia/Seoul'')::date', target_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS study_point_events_daily_uidx ON %I.study_point_events (owner_id, activity, credited_on)', target_schema);
  END LOOP;
END
$migration$;
