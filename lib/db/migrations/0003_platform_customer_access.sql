-- Platform customer access controls. Additive and safe for existing tenants.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS customer_branding_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE tenant_memberships
  ADD COLUMN IF NOT EXISTS environment_access_configured boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS tenant_environment_access (
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  granted_by_user_id integer NOT NULL REFERENCES local_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tenant_environment_access_tenant_environment_user_idx UNIQUE (tenant_id, environment_id, user_id)
);

CREATE INDEX IF NOT EXISTS tenant_environment_access_tenant_user_idx
  ON tenant_environment_access (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS tenant_environment_access_environment_idx
  ON tenant_environment_access (environment_id);

INSERT INTO tenant_environment_access (tenant_id, environment_id, user_id, granted_by_user_id)
SELECT m.tenant_id, e.id, m.user_id, m.user_id
FROM tenant_memberships m
JOIN customer_environments e ON e.tenant_id = m.tenant_id AND e.status = 'active'
WHERE NOT EXISTS (
  SELECT 1 FROM tenant_environment_access a
  WHERE a.tenant_id = m.tenant_id
    AND a.environment_id = e.id
    AND a.user_id = m.user_id
);

UPDATE tenant_memberships m
SET environment_access_configured = true
WHERE EXISTS (
  SELECT 1
  FROM tenant_environment_access a
  WHERE a.tenant_id = m.tenant_id
    AND a.user_id = m.user_id
);
