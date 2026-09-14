-- Platform feature controls and tenant-user roadmap feedback.
-- Additive and idempotent so fresh and upgraded databases converge on the
-- same feature-control schema.
CREATE TABLE IF NOT EXISTS platform_feature_flags (
  key text PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  updated_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS feature_feedback_votes (
  id serial PRIMARY KEY,
  feature_key text NOT NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES local_users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS feature_feedback_votes_tenant_user_idx
  ON feature_feedback_votes (tenant_id, user_id);
CREATE INDEX IF NOT EXISTS feature_feedback_votes_feature_idx
  ON feature_feedback_votes (feature_key);