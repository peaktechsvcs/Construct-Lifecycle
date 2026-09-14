CREATE TABLE IF NOT EXISTS itb_document_evidence_mappings (
  id serial PRIMARY KEY,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES environments(id) ON DELETE CASCADE,
  intake_id integer NOT NULL REFERENCES itb_intakes(id) ON DELETE CASCADE,
  document_id integer NOT NULL REFERENCES itb_documents(id) ON DELETE CASCADE,
  target_type text NOT NULL,
  target_id integer NOT NULL,
  finding_key text NOT NULL,
  target_field text NOT NULL,
  applied_value text NOT NULL,
  evidence text NOT NULL,
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS itb_evidence_mappings_scope_target_idx
  ON itb_document_evidence_mappings (tenant_id, environment_id, target_type, target_id);

CREATE INDEX IF NOT EXISTS itb_evidence_mappings_document_idx
  ON itb_document_evidence_mappings (tenant_id, environment_id, document_id);

CREATE UNIQUE INDEX IF NOT EXISTS itb_evidence_mappings_document_field_idx
  ON itb_document_evidence_mappings (
    tenant_id,
    environment_id,
    document_id,
    target_type,
    target_id,
    target_field
  );