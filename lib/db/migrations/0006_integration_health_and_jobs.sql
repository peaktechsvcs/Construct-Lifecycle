-- Preserve the distinction between a sync attempt and a successful sync, and
-- give connector workers a tenant/environment-scoped place to record retries
-- and dead letters.
DO $migration$
BEGIN
  IF to_regclass('public.integrations') IS NULL THEN
    RAISE NOTICE 'Skipping integration health migration until integrations exists';
    RETURN;
  END IF;

  ALTER TABLE integrations
    ADD COLUMN IF NOT EXISTS last_successful_sync_at timestamptz,
    ADD COLUMN IF NOT EXISTS last_failure_at timestamptz;

  CREATE TABLE IF NOT EXISTS integration_jobs (
    id serial PRIMARY KEY,
    tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
    integration_id integer REFERENCES integrations(id) ON DELETE SET NULL,
    provider_key text NOT NULL,
    job_type text NOT NULL,
    status text NOT NULL DEFAULT 'queued',
    attempts integer NOT NULL DEFAULT 0,
    max_attempts integer NOT NULL DEFAULT 3,
    next_retry_at timestamptz,
    last_error text,
    dead_lettered_at timestamptz,
    completed_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );

  CREATE INDEX IF NOT EXISTS integration_jobs_tenant_environment_provider_idx
    ON integration_jobs (tenant_id, environment_id, provider_key);
  CREATE INDEX IF NOT EXISTS integration_jobs_status_idx
    ON integration_jobs (status);
  CREATE INDEX IF NOT EXISTS integration_jobs_updated_at_idx
    ON integration_jobs (updated_at);
END
$migration$;