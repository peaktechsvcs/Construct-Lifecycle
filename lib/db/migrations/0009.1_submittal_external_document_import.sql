ALTER TABLE submittal_documents
  ADD COLUMN IF NOT EXISTS provider_key text;
ALTER TABLE submittal_documents
  ADD COLUMN IF NOT EXISTS external_id text;
ALTER TABLE submittal_documents
  ADD COLUMN IF NOT EXISTS source_url text;
ALTER TABLE submittal_documents
  ADD COLUMN IF NOT EXISTS import_status text NOT NULL DEFAULT 'not_imported';
ALTER TABLE submittal_documents
  ADD COLUMN IF NOT EXISTS failure_reason text;

CREATE INDEX IF NOT EXISTS submittal_documents_provider_external_idx
  ON submittal_documents (tenant_id, environment_id, provider_key, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS submittal_documents_item_provider_external_idx
  ON submittal_documents (item_id, provider_key, external_id)
  WHERE provider_key IS NOT NULL AND external_id IS NOT NULL;