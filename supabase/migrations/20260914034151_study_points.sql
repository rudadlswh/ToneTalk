-- Additive only: no existing learning data is changed.
-- The server authenticates the user and scopes every query to its owner ID.
DO $migration$
DECLARE target_schema text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.study_point_events (
      id varchar(36) PRIMARY KEY,
      owner_id varchar(64) NOT NULL REFERENCES %I.app_users(id) ON DELETE CASCADE,
      activity varchar(12) NOT NULL,
      activity_id varchar(240) NOT NULL,
      reward_day integer NOT NULL,
      points integer NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      CONSTRAINT study_point_events_reward_check CHECK (
        (activity = ''quiz'' AND points = 20 AND reward_day > 0) OR
        (activity = ''puzzle'' AND points = 25 AND reward_day > 0) OR
        (activity = ''chat'' AND points = 35 AND reward_day = 0)
      )
    )', target_schema, target_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS study_point_events_completion_uidx ON %I.study_point_events (owner_id, activity, activity_id, reward_day)', target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS study_point_events_owner_created_idx ON %I.study_point_events (owner_id, created_at, id)', target_schema);
    EXECUTE format('ALTER TABLE %I.study_point_events ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON TABLE %I.study_point_events FROM PUBLIC, anon, authenticated', target_schema);
  END LOOP;
END
$migration$;
