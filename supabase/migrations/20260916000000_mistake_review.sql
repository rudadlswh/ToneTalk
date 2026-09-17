-- Additive only. Narrow the target array to the approved schema before applying.
DO $migration$
DECLARE target_schema text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.mistake_review_answers (
      id varchar(36) PRIMARY KEY,
      set_id varchar(36) NOT NULL REFERENCES %I.daily_practice_sets(id) ON DELETE CASCADE,
      question_index integer NOT NULL,
      attempt_number integer NOT NULL,
      answer jsonb NOT NULL,
      outcome varchar(12) NOT NULL,
      created_at timestamptz(3) NOT NULL DEFAULT now(),
      CONSTRAINT mistake_review_answers_values_check CHECK (question_index BETWEEN 0 AND 4 AND attempt_number > 0 AND outcome IN (''correct'',''wrong'',''revealed''))
    )', target_schema, target_schema);
    EXECUTE format('CREATE UNIQUE INDEX IF NOT EXISTS mistake_review_answers_question_attempt_uidx ON %I.mistake_review_answers(set_id,question_index,attempt_number)', target_schema);
    EXECUTE format('ALTER TABLE %I.mistake_review_answers ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON TABLE %I.mistake_review_answers FROM PUBLIC, anon, authenticated', target_schema);
  END LOOP;
END
$migration$;
