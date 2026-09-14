CREATE TABLE IF NOT EXISTS "project_accounting_syncs" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "resource_type" text NOT NULL,
  "resource_key" text NOT NULL,
  "provider_key" text NOT NULL,
  "integration_id" integer,
  "sync_status" text DEFAULT 'not_synced' NOT NULL,
  "external_id" text,
  "last_attempted_at" timestamp with time zone,
  "last_successful_sync_at" timestamp with time zone,
  "last_error" text,
  "metadata" text DEFAULT '{}' NOT NULL,
  "tenant_id" integer NOT NULL,
  "environment_id" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "project_accounting_syncs"
    ADD CONSTRAINT "project_accounting_syncs_project_id_projects_id_fk"
    FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_accounting_syncs"
    ADD CONSTRAINT "project_accounting_syncs_integration_id_integrations_id_fk"
    FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id")
    ON DELETE set null ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_accounting_syncs"
    ADD CONSTRAINT "project_accounting_syncs_tenant_id_tenants_id_fk"
    FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "project_accounting_syncs"
    ADD CONSTRAINT "project_accounting_syncs_environment_id_customer_environments_id_fk"
    FOREIGN KEY ("environment_id") REFERENCES "public"."customer_environments"("id")
    ON DELETE cascade ON UPDATE no action;
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "project_accounting_syncs_scope_resource_provider_idx"
  ON "project_accounting_syncs" USING btree
  ("tenant_id", "environment_id", "project_id", "resource_type", "resource_key", "provider_key");

CREATE INDEX IF NOT EXISTS "project_accounting_syncs_scope_project_idx"
  ON "project_accounting_syncs" USING btree
  ("tenant_id", "environment_id", "project_id");