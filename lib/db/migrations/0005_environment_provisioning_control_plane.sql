-- Application-level environment isolation and recovery control plane.
-- Provider calls are deliberately not performed by this migration.
ALTER TABLE customer_environments
  ALTER COLUMN provisioning_status SET DEFAULT 'requested';
ALTER TABLE customer_environments
  ADD COLUMN IF NOT EXISTS isolation_enforced boolean NOT NULL DEFAULT false;
UPDATE customer_environments SET provisioning_status = 'requested'
  WHERE provisioning_status IS NULL;
ALTER TABLE customer_environments
  ALTER COLUMN provisioning_status SET NOT NULL;
ALTER TABLE customer_environments
  ADD CONSTRAINT customer_environments_kind_check
  CHECK (kind IN ('production', 'dtd'));

CREATE UNIQUE INDEX IF NOT EXISTS customer_environments_one_production_idx
  ON customer_environments (tenant_id) WHERE kind = 'production';
CREATE UNIQUE INDEX IF NOT EXISTS customer_environments_one_dtd_idx
  ON customer_environments (tenant_id) WHERE kind = 'dtd';

CREATE TABLE IF NOT EXISTS environment_resources (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  resource_type text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  provider_key text NOT NULL,
  -- Opaque provider key identifier only; never raw signing key material.
  secret_reference text,
  external_id text,
  endpoint text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_error text,
  provisioned_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT environment_resources_environment_type_unique UNIQUE (environment_id, resource_type)
);
ALTER TABLE environment_resources ADD COLUMN IF NOT EXISTS secret_reference text;
CREATE INDEX IF NOT EXISTS environment_resources_tenant_idx ON environment_resources(tenant_id);
CREATE INDEX IF NOT EXISTS environment_resources_status_idx ON environment_resources(status);

CREATE TABLE IF NOT EXISTS provisioning_operations (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  resource_id integer REFERENCES environment_resources(id) ON DELETE CASCADE,
  operation_type text NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  provider_operation_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  error text,
  requested_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT provisioning_operations_idempotency_unique UNIQUE(environment_id, operation_type, idempotency_key)
);
ALTER TABLE provisioning_operations ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS provisioning_operations_environment_idx ON provisioning_operations(tenant_id, environment_id);
CREATE INDEX IF NOT EXISTS provisioning_operations_status_idx ON provisioning_operations(status);

CREATE TABLE IF NOT EXISTS provisioning_events (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  resource_id integer REFERENCES environment_resources(id) ON DELETE SET NULL,
  operation_id integer REFERENCES provisioning_operations(id) ON DELETE SET NULL,
  actor_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS provisioning_events_environment_idx ON provisioning_events(tenant_id, environment_id);
CREATE INDEX IF NOT EXISTS provisioning_events_occurred_idx ON provisioning_events(occurred_at);

CREATE TABLE IF NOT EXISTS environment_snapshots (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  source_environment_id integer REFERENCES customer_environments(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  kind text NOT NULL DEFAULT 'backup',
  status text NOT NULL DEFAULT 'requested',
  sanitized text NOT NULL DEFAULT 'not_applicable',
  sanitization_policy text,
  backup_reference text,
  checksum text,
  verification_details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS environment_snapshots_tenant_environment_idx ON environment_snapshots(tenant_id, environment_id);
CREATE INDEX IF NOT EXISTS environment_snapshots_status_idx ON environment_snapshots(status);
CREATE UNIQUE INDEX IF NOT EXISTS environment_snapshots_environment_idempotency_idx ON environment_snapshots(environment_id, idempotency_key);

CREATE TABLE IF NOT EXISTS environment_refreshes (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  source_environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE RESTRICT,
  target_environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE RESTRICT,
  snapshot_id integer REFERENCES environment_snapshots(id) ON DELETE SET NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'requested',
  sanitization_policy text NOT NULL,
  requested_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS environment_refreshes_tenant_idx ON environment_refreshes(tenant_id);
CREATE INDEX IF NOT EXISTS environment_refreshes_target_idx ON environment_refreshes(target_environment_id);
CREATE UNIQUE INDEX IF NOT EXISTS environment_refreshes_target_idempotency_idx ON environment_refreshes(target_environment_id, idempotency_key);

CREATE TABLE IF NOT EXISTS environment_health_checks (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  status text NOT NULL,
  checks jsonb NOT NULL DEFAULT '{}'::jsonb,
  checked_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  checked_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS environment_health_checks_environment_idx ON environment_health_checks(tenant_id, environment_id, checked_at);

CREATE TABLE IF NOT EXISTS environment_release_controls (
  id serial PRIMARY KEY,
  assignment_id integer NOT NULL UNIQUE REFERENCES environment_release_assignments(id) ON DELETE CASCADE,
  snapshot_id integer REFERENCES environment_snapshots(id) ON DELETE SET NULL,
  health_check_id integer REFERENCES environment_health_checks(id) ON DELETE SET NULL,
  rollback_snapshot_id integer REFERENCES environment_snapshots(id) ON DELETE SET NULL,
  rollback_status text,
  promoted_at timestamptz,
  rolled_back_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);