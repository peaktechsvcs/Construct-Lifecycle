-- Development-only, non-destructive transition for customer environments.
-- Run this migration explicitly with APP_ENV=development or APP_ENV=demo.
DO $$
BEGIN
  IF current_setting('app.env', true) = 'production' OR current_setting('APP_ENV', true) = 'production' THEN
    RAISE EXCEPTION 'customer environment backfill refuses to run in production';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS customer_environments (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  kind text NOT NULL DEFAULT 'dtd',
  status text NOT NULL DEFAULT 'active',
  provisioning_status text,
  provisioned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT customer_environments_tenant_slug UNIQUE (tenant_id, slug)
);

INSERT INTO customer_environments (tenant_id, name, slug, kind)
SELECT t.id, 'Development / Test / Demo', 'dtd', 'dtd' FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM customer_environments e WHERE e.tenant_id = t.id AND e.slug = 'dtd');
INSERT INTO customer_environments (tenant_id, name, slug, kind)
SELECT t.id, 'Production', 'production', 'production' FROM tenants t
WHERE NOT EXISTS (SELECT 1 FROM customer_environments e WHERE e.tenant_id = t.id AND e.slug = 'production');

ALTER TABLE user_tenant_context ADD COLUMN IF NOT EXISTS active_environment_id integer REFERENCES customer_environments(id) ON DELETE SET NULL;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS environment_id integer REFERENCES customer_environments(id) ON DELETE CASCADE;
ALTER TABLE project_activity ADD COLUMN IF NOT EXISTS environment_id integer REFERENCES customer_environments(id) ON DELETE CASCADE;
ALTER TABLE follow_ups ADD COLUMN IF NOT EXISTS environment_id integer REFERENCES customer_environments(id) ON DELETE CASCADE;
ALTER TABLE tenant_branding_drafts ADD COLUMN IF NOT EXISTS environment_id integer REFERENCES customer_environments(id) ON DELETE CASCADE;
ALTER TABLE tenant_branding_versions ADD COLUMN IF NOT EXISTS environment_id integer REFERENCES customer_environments(id) ON DELETE CASCADE;

UPDATE projects p SET environment_id = e.id FROM customer_environments e
WHERE e.tenant_id = p.tenant_id AND e.slug = 'dtd' AND p.environment_id IS NULL;
UPDATE project_activity a SET environment_id = p.environment_id FROM projects p
WHERE p.id = a.project_id AND a.environment_id IS NULL;
UPDATE follow_ups f SET environment_id = p.environment_id FROM projects p
WHERE p.id = f.project_id AND f.environment_id IS NULL;
UPDATE tenant_branding_drafts b SET environment_id = e.id FROM customer_environments e
WHERE e.tenant_id = b.tenant_id AND e.slug = 'dtd' AND b.environment_id IS NULL;
UPDATE tenant_branding_versions b SET environment_id = e.id FROM customer_environments e
WHERE e.tenant_id = b.tenant_id AND e.slug = 'dtd' AND b.environment_id IS NULL;
UPDATE user_tenant_context c SET active_environment_id = e.id FROM customer_environments e
WHERE e.tenant_id = c.active_tenant_id AND e.slug = 'dtd' AND c.active_environment_id IS NULL;

ALTER TABLE tenant_branding_drafts DROP CONSTRAINT IF EXISTS tenant_branding_drafts_pkey;
DROP INDEX IF EXISTS tenant_branding_versions_tenant_version_idx;
ALTER TABLE projects ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE project_activity ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE follow_ups ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE tenant_branding_drafts ALTER COLUMN environment_id SET NOT NULL;
ALTER TABLE tenant_branding_versions ALTER COLUMN environment_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenant_branding_drafts_tenant_environment_idx ON tenant_branding_drafts (tenant_id, environment_id);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_branding_versions_tenant_environment_version_idx ON tenant_branding_versions (tenant_id, environment_id, version);