-- Complete the protected, tenant/environment-scoped submittal document workflow.
-- All object bytes remain in App Storage; these tables only persist metadata,
-- screening state, version history, assembly plans, and coordination state.

CREATE TABLE IF NOT EXISTS submittal_documents (
  id serial PRIMARY KEY,
  item_id integer NOT NULL REFERENCES submittal_items(id) ON DELETE CASCADE,
  original_name text NOT NULL,
  object_path text NOT NULL UNIQUE,
  content_type text NOT NULL,
  size integer NOT NULL,
  page_count integer,
  page_order text,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  uploaded_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  uploaded_at timestamptz,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submittal_documents_item_idx
  ON submittal_documents (item_id);
CREATE INDEX IF NOT EXISTS submittal_documents_tenant_environment_idx
  ON submittal_documents (tenant_id, environment_id);
CREATE UNIQUE INDEX IF NOT EXISTS submittal_documents_item_version_idx
  ON submittal_documents (tenant_id, environment_id, item_id, version);

CREATE TABLE IF NOT EXISTS submittal_coordination (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES submittal_packages(id) ON DELETE CASCADE,
  revision_id integer REFERENCES submittal_revisions(id) ON DELETE SET NULL,
  coordination_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  owner_name text,
  external_reference text,
  notes text,
  due_date date,
  failure_reason text,
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submittal_coordination_package_idx
  ON submittal_coordination (package_id);
CREATE INDEX IF NOT EXISTS submittal_coordination_tenant_environment_idx
  ON submittal_coordination (tenant_id, environment_id);
CREATE INDEX IF NOT EXISTS submittal_coordination_status_idx
  ON submittal_coordination (tenant_id, environment_id, status);

CREATE TABLE IF NOT EXISTS submittal_package_assemblies (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES submittal_packages(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'ready',
  signature_ready boolean NOT NULL DEFAULT false,
  signature_ready_at timestamptz,
  signature_ready_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  original_file_name text NOT NULL,
  object_path text NOT NULL UNIQUE,
  content_type text NOT NULL DEFAULT 'application/pdf',
  size integer NOT NULL,
  item_order text NOT NULL,
  page_plan text NOT NULL,
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submittal_package_assemblies_package_idx
  ON submittal_package_assemblies (package_id);
CREATE INDEX IF NOT EXISTS submittal_package_assemblies_tenant_environment_idx
  ON submittal_package_assemblies (tenant_id, environment_id);

CREATE TABLE IF NOT EXISTS submittal_signature_requests (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES submittal_packages(id) ON DELETE CASCADE,
  assembly_id integer NOT NULL REFERENCES submittal_package_assemblies(id) ON DELETE CASCADE,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  provider_key text,
  provider_request_id text,
  external_metadata text NOT NULL DEFAULT '{}',
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submittal_signature_requests_package_idx
  ON submittal_signature_requests (package_id);
CREATE INDEX IF NOT EXISTS submittal_signature_requests_assembly_idx
  ON submittal_signature_requests (assembly_id);
CREATE INDEX IF NOT EXISTS submittal_signature_requests_tenant_environment_idx
  ON submittal_signature_requests (tenant_id, environment_id);

CREATE TABLE IF NOT EXISTS submittal_signature_signers (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES submittal_signature_requests(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  role text,
  signing_order integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS submittal_signature_signers_request_idx
  ON submittal_signature_signers (request_id);
CREATE INDEX IF NOT EXISTS submittal_signature_signers_tenant_environment_idx
  ON submittal_signature_signers (tenant_id, environment_id);

CREATE TABLE IF NOT EXISTS submittal_signature_events (
  id serial PRIMARY KEY,
  request_id integer NOT NULL REFERENCES submittal_signature_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  details text NOT NULL DEFAULT '{}',
  actor_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submittal_signature_events_request_idx
  ON submittal_signature_events (request_id);
CREATE INDEX IF NOT EXISTS submittal_signature_events_tenant_environment_idx
  ON submittal_signature_events (tenant_id, environment_id);
CREATE INDEX IF NOT EXISTS submittal_signature_events_created_at_idx
  ON submittal_signature_events (created_at);