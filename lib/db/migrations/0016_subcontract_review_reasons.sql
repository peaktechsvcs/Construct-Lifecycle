ALTER TABLE "subcontract_change_orders"
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;

ALTER TABLE "subcontract_closeout_items"
  ADD COLUMN IF NOT EXISTS "rejection_reason" text;