-- A mailbox source message may be imported once per tenant and environment.
-- The partial index preserves manual and non-mailbox intakes with null source IDs.
CREATE UNIQUE INDEX IF NOT EXISTS itb_intakes_mailbox_source_idx
  ON itb_intakes (tenant_id, environment_id, source_provider, source_message_id)
  WHERE source_message_id IS NOT NULL;