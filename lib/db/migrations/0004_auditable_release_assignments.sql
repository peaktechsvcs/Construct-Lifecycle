-- Additive release metadata and auditable customer environment transitions.
-- This migration deliberately preserves NULL actors for legacy rows created
-- before the local user bridge existed. New API writes always include an actor.
-- On a fresh database the schema push creates these tables after the scaffold;
-- this migration safely becomes a no-op until that scaffold exists.
DO $migration$
DECLARE
  release_row record;
  app_metadata jsonb;
  config_metadata jsonb;
  metadata_valid boolean;
BEGIN
  IF to_regclass('public.customer_environments') IS NULL
     OR to_regclass('public.local_users') IS NULL
     OR to_regclass('public.tenants') IS NULL THEN
    RAISE NOTICE 'Skipping release migration until tenant scaffold tables exist';
    RETURN;
  END IF;

  EXECUTE $sql$
    CREATE TABLE IF NOT EXISTS platform_releases (
      id serial PRIMARY KEY,
      release_type text NOT NULL,
      status text NOT NULL DEFAULT 'draft',
      version text NOT NULL,
      notes text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS platform_releases_type_version_idx
      ON platform_releases (release_type, version);

    CREATE TABLE IF NOT EXISTS environment_release_assignments (
      id serial PRIMARY KEY,
      environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
      release_id integer NOT NULL REFERENCES platform_releases(id) ON DELETE CASCADE,
      approval_status text NOT NULL DEFAULT 'pending',
      approved_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
      approved_at timestamptz,
      assigned_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS environment_release_assignment_idx
      ON environment_release_assignments (environment_id, release_id);

    ALTER TABLE platform_releases
      ADD COLUMN IF NOT EXISTS app_payload text NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS config_payload text NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS mandatory boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS created_by_user_id integer;

    ALTER TABLE environment_release_assignments
      ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'assigned',
      ADD COLUMN IF NOT EXISTS assigned_by_user_id integer,
      ADD COLUMN IF NOT EXISTS rejection_reason text,
      ADD COLUMN IF NOT EXISTS rejected_by_user_id integer,
      ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
      ADD COLUMN IF NOT EXISTS validation_status text NOT NULL DEFAULT 'not_required',
      ADD COLUMN IF NOT EXISTS validated_by_user_id integer,
      ADD COLUMN IF NOT EXISTS validated_at timestamptz,
      ADD COLUMN IF NOT EXISTS deployment_status text NOT NULL DEFAULT 'pending',
      ADD COLUMN IF NOT EXISTS deployed_by_user_id integer,
      ADD COLUMN IF NOT EXISTS deployed_at timestamptz,
      ADD COLUMN IF NOT EXISTS source_dtd_assignment_id integer,
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
    ALTER TABLE platform_releases ALTER COLUMN created_by_user_id DROP NOT NULL;
    ALTER TABLE environment_release_assignments ALTER COLUMN assigned_by_user_id DROP NOT NULL;

    CREATE TABLE IF NOT EXISTS release_assignment_events (
      id serial PRIMARY KEY,
      release_id integer NOT NULL REFERENCES platform_releases(id) ON DELETE CASCADE,
      assignment_id integer REFERENCES environment_release_assignments(id) ON DELETE CASCADE,
      actor_user_id integer,
      action text NOT NULL,
      from_status text,
      to_status text,
      details text NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now()
    );
    ALTER TABLE release_assignment_events ALTER COLUMN actor_user_id DROP NOT NULL;
    CREATE INDEX IF NOT EXISTS release_assignment_events_release_idx
      ON release_assignment_events (release_id);
    CREATE INDEX IF NOT EXISTS release_assignment_events_assignment_idx
      ON release_assignment_events (assignment_id);
    CREATE INDEX IF NOT EXISTS release_assignment_events_occurred_idx
      ON release_assignment_events (occurred_at);
  $sql$;

  -- Preserve legacy history even when an old actor was removed or the bridge
  -- was populated before local users existed.
  UPDATE platform_releases
  SET created_by_user_id = NULL
  WHERE created_by_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM local_users u WHERE u.id = created_by_user_id);
  UPDATE environment_release_assignments
  SET assigned_by_user_id = NULL
  WHERE assigned_by_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM local_users u WHERE u.id = assigned_by_user_id);
  UPDATE release_assignment_events
  SET actor_user_id = NULL
  WHERE actor_user_id IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM local_users u WHERE u.id = actor_user_id);

  -- Releases created before the artifact metadata contract may contain '{}',
  -- malformed JSON, or transactional/unknown fields. They remain auditable
  -- but cannot be promoted.
  FOR release_row IN
    SELECT id, app_payload, config_payload FROM platform_releases
  LOOP
    metadata_valid := true;
    BEGIN
      app_metadata := release_row.app_payload::jsonb;
      config_metadata := release_row.config_payload::jsonb;
      metadata_valid := jsonb_typeof(app_metadata) = 'object'
        AND jsonb_typeof(config_metadata) = 'object'
        AND app_metadata ? 'artifactName'
        AND app_metadata ? 'artifactVersion'
        AND app_metadata ? 'digest'
        AND jsonb_typeof(app_metadata->'artifactName') = 'string'
        AND jsonb_typeof(app_metadata->'artifactVersion') = 'string'
        AND jsonb_typeof(app_metadata->'digest') = 'string'
        AND length(coalesce(app_metadata->>'artifactName', '')) BETWEEN 1 AND 160
        AND length(coalesce(app_metadata->>'artifactVersion', '')) BETWEEN 1 AND 120
        AND length(coalesce(app_metadata->>'digest', '')) BETWEEN 8 AND 256
        AND app_metadata->>'digest' ~ '^[A-Za-z0-9:_./+=-]{8,256}$'
        AND config_metadata ? 'configName'
        AND config_metadata ? 'configVersion'
        AND config_metadata ? 'digest'
        AND jsonb_typeof(config_metadata->'configName') = 'string'
        AND jsonb_typeof(config_metadata->'configVersion') = 'string'
        AND jsonb_typeof(config_metadata->'digest') = 'string'
        AND length(coalesce(config_metadata->>'configName', '')) BETWEEN 1 AND 160
        AND length(coalesce(config_metadata->>'configVersion', '')) BETWEEN 1 AND 120
        AND length(coalesce(config_metadata->>'digest', '')) BETWEEN 8 AND 256
        AND config_metadata->>'digest' ~ '^[A-Za-z0-9:_./+=-]{8,256}$'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(app_metadata) AS metadata_key(name)
          WHERE name NOT IN ('artifactName', 'artifactVersion', 'digest', 'sourceCommit', 'buildId', 'entrypoint')
        )
        AND (NOT app_metadata ? 'sourceCommit'
          OR (jsonb_typeof(app_metadata->'sourceCommit') = 'string'
            AND length(app_metadata->>'sourceCommit') <= 120))
        AND (NOT app_metadata ? 'buildId'
          OR (jsonb_typeof(app_metadata->'buildId') = 'string'
            AND length(app_metadata->>'buildId') <= 160))
        AND (NOT app_metadata ? 'entrypoint'
          OR (jsonb_typeof(app_metadata->'entrypoint') = 'string'
            AND length(app_metadata->>'entrypoint') <= 300))
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_object_keys(config_metadata) AS metadata_key(name)
          WHERE name NOT IN ('configName', 'configVersion', 'digest', 'schemaVersion', 'sourceCommit', 'buildId')
        )
        AND (NOT config_metadata ? 'schemaVersion'
          OR (jsonb_typeof(config_metadata->'schemaVersion') = 'string'
            AND length(config_metadata->>'schemaVersion') <= 120))
        AND (NOT config_metadata ? 'sourceCommit'
          OR (jsonb_typeof(config_metadata->'sourceCommit') = 'string'
            AND length(config_metadata->>'sourceCommit') <= 120))
        AND (NOT config_metadata ? 'buildId'
          OR (jsonb_typeof(config_metadata->'buildId') = 'string'
            AND length(config_metadata->>'buildId') <= 160));
    EXCEPTION WHEN others THEN
      metadata_valid := false;
    END;
    IF NOT metadata_valid THEN
      UPDATE platform_releases
      SET status = 'deprecated', updated_at = now()
      WHERE id = release_row.id;
    END IF;
  END LOOP;

  -- Constraint creation is guarded because this migration may be replayed by
  -- a restore/bootstrap process.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'platform_releases_created_by_user_fk'
  ) THEN
    ALTER TABLE platform_releases
      ADD CONSTRAINT platform_releases_created_by_user_fk
      FOREIGN KEY (created_by_user_id) REFERENCES local_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_release_assignments_assigned_by_user_fk'
  ) THEN
    ALTER TABLE environment_release_assignments
      ADD CONSTRAINT environment_release_assignments_assigned_by_user_fk
      FOREIGN KEY (assigned_by_user_id) REFERENCES local_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_release_assignments_rejected_by_user_fk'
  ) THEN
    ALTER TABLE environment_release_assignments
      ADD CONSTRAINT environment_release_assignments_rejected_by_user_fk
      FOREIGN KEY (rejected_by_user_id) REFERENCES local_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_release_assignments_validated_by_user_fk'
  ) THEN
    ALTER TABLE environment_release_assignments
      ADD CONSTRAINT environment_release_assignments_validated_by_user_fk
      FOREIGN KEY (validated_by_user_id) REFERENCES local_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_release_assignments_deployed_by_user_fk'
  ) THEN
    ALTER TABLE environment_release_assignments
      ADD CONSTRAINT environment_release_assignments_deployed_by_user_fk
      FOREIGN KEY (deployed_by_user_id) REFERENCES local_users(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'environment_release_assignments_source_dtd_fk'
  ) THEN
    ALTER TABLE environment_release_assignments
      ADD CONSTRAINT environment_release_assignments_source_dtd_fk
      FOREIGN KEY (source_dtd_assignment_id) REFERENCES environment_release_assignments(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'release_assignment_events_actor_user_fk'
  ) THEN
    ALTER TABLE release_assignment_events
      ADD CONSTRAINT release_assignment_events_actor_user_fk
      FOREIGN KEY (actor_user_id) REFERENCES local_users(id) ON DELETE SET NULL;
  END IF;
END
$migration$;