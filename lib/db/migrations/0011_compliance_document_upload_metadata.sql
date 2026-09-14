ALTER TABLE trade_partner_compliance_documents
  ADD COLUMN IF NOT EXISTS original_name text,
  ADD COLUMN IF NOT EXISTS content_type text,
  ADD COLUMN IF NOT EXISTS file_size integer,
  ADD COLUMN IF NOT EXISTS pending_object_path text,
  ADD COLUMN IF NOT EXISTS pending_original_name text,
  ADD COLUMN IF NOT EXISTS pending_content_type text,
  ADD COLUMN IF NOT EXISTS pending_file_size integer;