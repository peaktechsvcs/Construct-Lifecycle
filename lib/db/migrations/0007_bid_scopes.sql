CREATE TABLE IF NOT EXISTS bid_scopes (
  id serial PRIMARY KEY,
  bid_id integer NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  owner_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'draft',
  takeoff_provider text,
  takeoff_coverage text NOT NULL DEFAULT 'none',
  estimating_provider text,
  estimating_coverage text NOT NULL DEFAULT 'none',
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS bid_scopes_tenant_environment_bid_idx
  ON bid_scopes (tenant_id, environment_id, bid_id);
CREATE INDEX IF NOT EXISTS bid_scopes_owner_idx
  ON bid_scopes (tenant_id, environment_id, owner_user_id);