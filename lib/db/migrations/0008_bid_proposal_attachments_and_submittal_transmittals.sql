CREATE TABLE IF NOT EXISTS bid_proposal_attachments (
  id serial PRIMARY KEY,
  bid_id integer REFERENCES bids(id) ON DELETE CASCADE,
  proposal_id integer REFERENCES proposals(id) ON DELETE CASCADE,
  purpose text NOT NULL DEFAULT 'other',
  title text NOT NULL,
  description text,
  document_name text,
  document_url text,
  integration_provider_key text,
  external_reference text,
  metadata text,
  conversion_status text NOT NULL DEFAULT 'open',
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_proposal_attachment_single_parent_check
    CHECK (((bid_id IS NOT NULL)::int + (proposal_id IS NOT NULL)::int = 1))
);

CREATE INDEX IF NOT EXISTS bid_proposal_attachments_bid_idx
  ON bid_proposal_attachments (tenant_id, environment_id, bid_id);
CREATE INDEX IF NOT EXISTS bid_proposal_attachments_proposal_idx
  ON bid_proposal_attachments (tenant_id, environment_id, proposal_id);
CREATE INDEX IF NOT EXISTS bid_proposal_attachments_purpose_idx
  ON bid_proposal_attachments (tenant_id, environment_id, purpose);

ALTER TABLE submittal_items
  ADD COLUMN IF NOT EXISTS source_bid_attachment_id integer;
ALTER TABLE submittal_items
  ADD COLUMN IF NOT EXISTS reviewer_name text;
ALTER TABLE submittal_items
  ADD COLUMN IF NOT EXISTS review_comments text;

CREATE TABLE IF NOT EXISTS submittal_transmittals (
  id serial PRIMARY KEY,
  package_id integer NOT NULL REFERENCES submittal_packages(id) ON DELETE CASCADE,
  revision_id integer REFERENCES submittal_revisions(id) ON DELETE SET NULL,
  transmittal_number text NOT NULL,
  purpose text NOT NULL DEFAULT 'review',
  sent_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  from_party text,
  to_party text,
  notes text,
  created_by_user_id integer REFERENCES local_users(id) ON DELETE SET NULL,
  tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  environment_id integer NOT NULL REFERENCES customer_environments(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submittal_transmittals_package_idx
  ON submittal_transmittals (package_id);
CREATE INDEX IF NOT EXISTS submittal_transmittals_tenant_environment_idx
  ON submittal_transmittals (tenant_id, environment_id);