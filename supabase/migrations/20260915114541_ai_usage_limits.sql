-- Apply dev first. Narrow the array to one schema for staged deployments.
DO $migration$
DECLARE target_schema text;
BEGIN
  FOREACH target_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.ai_usage_state (
      id varchar(160) PRIMARY KEY,
      minute integer NOT NULL DEFAULT 0,
      day integer NOT NULL DEFAULT 0,
      minute_calls integer NOT NULL DEFAULT 0,
      day_calls integer NOT NULL DEFAULT 0,
      blocked_until timestamptz,
      block_code varchar(40),
      CONSTRAINT ai_usage_state_counts_check CHECK (minute_calls >= 0 AND day_calls >= 0)
    )', target_schema);
    EXECUTE format('ALTER TABLE %I.ai_usage_state ENABLE ROW LEVEL SECURITY', target_schema);
    EXECUTE format('REVOKE ALL ON TABLE %I.ai_usage_state FROM PUBLIC, anon, authenticated', target_schema);
  END LOOP;
END
$migration$;
