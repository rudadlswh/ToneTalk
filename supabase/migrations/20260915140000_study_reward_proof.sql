-- Dev first; narrow target array to the approved schema before applying.
DO $migration$
DECLARE target_schema text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('ALTER TABLE %I.daily_practice_sets ADD COLUMN IF NOT EXISTS source varchar(12) NOT NULL DEFAULT ''daily''', target_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS daily_practice_sets_owner_day_kind_source_uidx ON %I.daily_practice_sets (owner_id,day,kind,source)', target_schema);
    EXECUTE format('DROP INDEX IF EXISTS %I.daily_practice_sets_owner_day_kind_uidx', target_schema);
    EXECUTE format('ALTER TABLE %I.daily_practice_sets DROP CONSTRAINT IF EXISTS daily_practice_sets_phrases_check', target_schema);
    EXECUTE format('ALTER TABLE %I.daily_practice_sets DROP CONSTRAINT IF EXISTS daily_practice_sets_source_check', target_schema);
    EXECUTE format('ALTER TABLE %I.daily_practice_sets ADD CONSTRAINT daily_practice_sets_source_check CHECK (source IN (''daily'',''saved'')),
      ADD CONSTRAINT daily_practice_sets_phrases_check CHECK (phrases IS NULL OR (jsonb_typeof(phrases)=''array'' AND jsonb_array_length(phrases) BETWEEN 1 AND 5 AND (source=''saved'' OR jsonb_array_length(phrases)=5)))', target_schema);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.study_chat_sessions (
      id varchar(36) PRIMARY KEY,
      owner_id varchar(64) NOT NULL REFERENCES %I.app_users(id) ON DELETE CASCADE,
      scenario varchar(12) NOT NULL, language varchar(10) NOT NULL,
      turns integer NOT NULL DEFAULT 0 CHECK (turns BETWEEN 0 AND 4),
      transcript_hash varchar(64) NOT NULL, last_event_id varchar(36), last_request_hash varchar(64),
      generation_token varchar(36), generation_expires_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now()
    )', target_schema, target_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS study_chat_sessions_owner_created_idx ON %I.study_chat_sessions (owner_id,created_at)', target_schema);
    EXECUTE format('ALTER TABLE %I.study_chat_sessions ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON TABLE %I.study_chat_sessions FROM PUBLIC, anon, authenticated', target_schema);
  END LOOP;
END
$migration$;
