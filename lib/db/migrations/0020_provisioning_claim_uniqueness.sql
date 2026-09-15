-- Older databases may already contain these tables from an earlier schema
-- push, causing CREATE TABLE IF NOT EXISTS in migration 0005 to skip the
-- embedded constraints. Recovery claims depend on these unique indexes for
-- atomic, idempotent ON CONFLICT handling.
--
-- The 0005 table constraints already create equivalent unique indexes on a
-- fresh database. Do not add a second index there. Before repairing a legacy
-- database, report duplicate rows explicitly: otherwise PostgreSQL emits a
-- low-level CREATE UNIQUE INDEX error with no indication of how to repair the
-- data.
DO $migration$
DECLARE
  duplicate_count bigint;
BEGIN
  IF to_regclass('public.environment_resources') IS NULL
    OR to_regclass('public.provisioning_operations') IS NULL THEN
    RAISE EXCEPTION
      'Migration 0020 requires environment_resources and provisioning_operations from migration 0005'
      USING HINT = 'Run the provisioning control-plane migrations before migration 0020.';
  END IF;

  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT environment_id, resource_type
    FROM environment_resources
    GROUP BY environment_id, resource_type
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0020 cannot enforce environment resource claims: % duplicate (environment_id, resource_type) groups exist',
      duplicate_count
      USING HINT = 'Merge or remove duplicate environment_resources rows, then rerun migration 0020.';
  END IF;

  SELECT count(*) INTO duplicate_count
  FROM (
    SELECT environment_id, operation_type, idempotency_key
    FROM provisioning_operations
    GROUP BY environment_id, operation_type, idempotency_key
    HAVING count(*) > 1
  ) duplicates;
  IF duplicate_count > 0 THEN
    RAISE EXCEPTION
      'Migration 0020 cannot enforce provisioning operation claims: % duplicate (environment_id, operation_type, idempotency_key) groups exist',
      duplicate_count
      USING HINT = 'Merge or remove duplicate provisioning_operations rows, then rerun migration 0020.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'environment_resources'
      AND indexdef ILIKE 'CREATE UNIQUE%'
      AND indexdef ILIKE '%(environment_id, resource_type)%'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX environment_resources_environment_type_idx
      ON environment_resources(environment_id, resource_type)';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'provisioning_operations'
      AND indexdef ILIKE 'CREATE UNIQUE%'
      AND indexdef ILIKE '%(environment_id, operation_type, idempotency_key)%'
  ) THEN
    EXECUTE 'CREATE UNIQUE INDEX provisioning_operations_idempotency_idx
      ON provisioning_operations(environment_id, operation_type, idempotency_key)';
  END IF;
END
$migration$;