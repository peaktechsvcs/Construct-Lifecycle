ALTER TABLE "supplier_deliveries"
  ADD COLUMN IF NOT EXISTS "proof_content_type" text,
  ADD COLUMN IF NOT EXISTS "proof_file_size" integer;

ALTER TABLE "supplier_delivery_lines"
  ADD COLUMN IF NOT EXISTS "quantity_received" numeric(14, 3) NOT NULL DEFAULT '0';