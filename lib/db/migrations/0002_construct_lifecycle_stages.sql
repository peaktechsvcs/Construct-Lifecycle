-- Normalize the legacy project stage values into Construct LC's eight-stage lifecycle.
-- This migration is additive and preserves every project record.
UPDATE projects
SET stage = CASE stage
  WHEN 'lead' THEN 'opportunity'
  WHEN 'proposal' THEN 'bid'
  WHEN 'awarded' THEN 'award'
  WHEN 'contracted' THEN 'contract'
  WHEN 'pre_construction' THEN 'procure'
  WHEN 'in_progress' THEN 'deliver'
  WHEN 'billing' THEN 'financial'
  WHEN 'closeout' THEN 'closeout'
  WHEN 'follow_up' THEN 'closeout'
  WHEN 'lost' THEN 'opportunity'
  ELSE 'opportunity'
END
WHERE stage NOT IN ('opportunity', 'bid', 'award', 'contract', 'procure', 'deliver', 'financial', 'closeout');

ALTER TABLE projects
  ALTER COLUMN stage SET DEFAULT 'opportunity';

ALTER TABLE projects
  DROP CONSTRAINT IF EXISTS projects_stage_check;

ALTER TABLE projects
  ADD CONSTRAINT projects_stage_check
  CHECK (stage IN ('opportunity', 'bid', 'award', 'contract', 'procure', 'deliver', 'financial', 'closeout'));