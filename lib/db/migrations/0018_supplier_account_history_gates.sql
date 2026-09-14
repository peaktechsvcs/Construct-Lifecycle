ALTER TABLE "supplier_customer_terms"
  ADD COLUMN IF NOT EXISTS "waiver_required" boolean NOT NULL DEFAULT false;

ALTER TABLE "supplier_invoices"
  ADD COLUMN IF NOT EXISTS "waiver_status" text NOT NULL DEFAULT 'not_required',
  ADD COLUMN IF NOT EXISTS "waiver_reference" text;