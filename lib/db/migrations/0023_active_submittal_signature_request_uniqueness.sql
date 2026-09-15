-- An assembly may have at most one active signature request in a tenant
-- environment. Terminal requests remain available for audit/history and may
-- be followed by a new request if the package is prepared again.
CREATE UNIQUE INDEX IF NOT EXISTS submittal_signature_requests_active_assembly_idx
  ON submittal_signature_requests (tenant_id, environment_id, assembly_id)
  WHERE status IN ('draft', 'ready', 'sending', 'sent', 'partially_signed');