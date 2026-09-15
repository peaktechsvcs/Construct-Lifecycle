-- Ensure one managed connector authorization can be attached to only one
-- customer environment. Tokens remain outside PostgreSQL; this index protects
-- the non-secret reference that grants Construct Lifecycle permission to use it.
DO $migration$
BEGIN
  IF to_regclass('public.integrations') IS NULL THEN
    RAISE NOTICE 'Skipping integration credential isolation until integrations exists';
    RETURN;
  END IF;

  -- Fail closed for legacy duplicate references before enforcing uniqueness.
  WITH ranked AS (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY credentials_reference
        ORDER BY updated_at DESC, id DESC
      ) AS reference_rank
    FROM integrations
    WHERE credentials_reference IS NOT NULL
  )
  UPDATE integrations
  SET
    status = 'not_connected',
    connection_type = 'not_configured',
    credentials_reference = NULL,
    last_error = 'Connection was detached because its authorization reference was shared across customer environments',
    updated_at = now()
  WHERE id IN (
    SELECT id FROM ranked WHERE reference_rank > 1
  );

  CREATE UNIQUE INDEX IF NOT EXISTS integrations_credentials_reference_idx
    ON integrations (credentials_reference);
END
$migration$;