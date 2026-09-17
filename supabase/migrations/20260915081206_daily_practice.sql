-- Additive, private schemas only. Apply dev first; review before prod.
DO $migration$
DECLARE target_schema text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.daily_practice_sets (
      id varchar(36) PRIMARY KEY,
      owner_id varchar(64) NOT NULL REFERENCES %I.app_users(id) ON DELETE CASCADE,
      day integer NOT NULL,
      kind varchar(12) NOT NULL,
      phrases jsonb,
      generation_token varchar(36),
      generation_expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT daily_practice_sets_kind_day_check CHECK (kind IN (''quiz'', ''puzzle'') AND day > 0),
      CONSTRAINT daily_practice_sets_phrases_check CHECK (phrases IS NULL OR (jsonb_typeof(phrases) = ''array'' AND jsonb_array_length(phrases) = 5))
    )', target_schema, target_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS daily_practice_sets_owner_day_kind_uidx ON %I.daily_practice_sets (owner_id, day, kind)', target_schema);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.daily_practice_answers (
      id varchar(36) PRIMARY KEY,
      set_id varchar(36) NOT NULL REFERENCES %I.daily_practice_sets(id) ON DELETE CASCADE,
      question_index integer NOT NULL,
      attempt_number integer NOT NULL,
      answer jsonb NOT NULL,
      outcome varchar(12) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      CONSTRAINT daily_practice_answers_values_check CHECK (question_index BETWEEN 0 AND 4 AND attempt_number > 0 AND outcome IN (''correct'', ''wrong'', ''revealed''))
    )', target_schema, target_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS daily_practice_answers_question_attempt_uidx ON %I.daily_practice_answers (set_id, question_index, attempt_number)', target_schema);
    EXECUTE format('ALTER TABLE %I.daily_practice_sets ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('ALTER TABLE %I.daily_practice_answers ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON TABLE %I.daily_practice_sets, %I.daily_practice_answers FROM PUBLIC, anon, authenticated', target_schema, target_schema);
  END LOOP;
END
$migration$;
