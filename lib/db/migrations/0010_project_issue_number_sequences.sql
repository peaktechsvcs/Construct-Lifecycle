CREATE TABLE IF NOT EXISTS project_issue_number_sequences (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  issue_type text NOT NULL,
  last_number integer NOT NULL DEFAULT 0,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS project_issue_number_sequences_scope_type_idx
  ON project_issue_number_sequences (tenant_id, environment_id, project_id, issue_type);

INSERT INTO project_issue_number_sequences (
  project_id,
  issue_type,
  last_number,
  tenant_id,
  environment_id
)
SELECT
  project_id,
  issue_type,
  COALESCE(MAX(NULLIF(substring(issue_number FROM '[0-9]+$'), '')::integer), 0),
  tenant_id,
  environment_id
FROM project_issues
GROUP BY project_id, issue_type, tenant_id, environment_id
ON CONFLICT (tenant_id, environment_id, project_id, issue_type)
DO UPDATE SET last_number = GREATEST(
  project_issue_number_sequences.last_number,
  EXCLUDED.last_number
);