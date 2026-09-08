-- Additive migration for the existing Supabase environment schemas.
-- Does not move or recreate the six existing application tables.
DO $migration$
DECLARE environment_schema text;
BEGIN
  FOREACH environment_schema IN ARRAY ARRAY['tonetalk_dev', 'tonetalk_prod'] LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.inference_leases (
      id varchar(40) PRIMARY KEY,
      token varchar(36) NOT NULL,
      expires_at timestamptz NOT NULL
    )', environment_schema);
    EXECUTE format('CREATE TABLE IF NOT EXISTS %I.translation_cache (
      key varchar(64) PRIMARY KEY,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )', environment_schema);
    EXECUTE format('CREATE INDEX IF NOT EXISTS translation_cache_expires_idx ON %I.translation_cache (expires_at)', environment_schema);
    EXECUTE format('ALTER TABLE %I.inference_leases ENABLE ROW LEVEL SECURITY', environment_schema);
    EXECUTE format('ALTER TABLE %I.translation_cache ENABLE ROW LEVEL SECURITY', environment_schema);
    EXECUTE format('REVOKE ALL ON %I.inference_leases, %I.translation_cache FROM PUBLIC, anon, authenticated', environment_schema, environment_schema);
  END LOOP;
END
$migration$;
