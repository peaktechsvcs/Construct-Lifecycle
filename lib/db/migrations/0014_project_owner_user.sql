ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "owner_user_id" integer;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_owner_user_id_local_users_id_fk"
  FOREIGN KEY ("owner_user_id") REFERENCES "public"."local_users"("id")
  ON DELETE set null ON UPDATE no action;

CREATE INDEX IF NOT EXISTS "projects_tenant_environment_owner_idx"
  ON "projects" USING btree ("tenant_id", "environment_id", "owner_user_id");

-- Existing free-text owner values are intentionally not backfilled. They are
-- legacy display data and cannot safely be treated as authenticated identities
-- without an explicit tenant-member review.