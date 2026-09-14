CREATE TABLE IF NOT EXISTS "opportunity_activities" (
  "id" serial PRIMARY KEY NOT NULL,
  "opportunity_id" integer NOT NULL,
  "tenant_id" integer NOT NULL,
  "environment_id" integer NOT NULL,
  "activity_type" text DEFAULT 'note' NOT NULL,
  "subject" text NOT NULL,
  "body" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "next_action_date" date,
  "completed" boolean DEFAULT false NOT NULL,
  "created_by_user_id" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
DO $$ BEGIN
 ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_opportunity_id_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."opportunities"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_environment_id_customer_environments_id_fk" FOREIGN KEY ("environment_id") REFERENCES "public"."customer_environments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
 ALTER TABLE "opportunity_activities" ADD CONSTRAINT "opportunity_activities_created_by_user_id_local_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."local_users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
CREATE INDEX IF NOT EXISTS "opportunity_activities_tenant_environment_opportunity_idx" ON "opportunity_activities" USING btree ("tenant_id","environment_id","opportunity_id");
CREATE INDEX IF NOT EXISTS "opportunity_activities_tenant_environment_next_action_idx" ON "opportunity_activities" USING btree ("tenant_id","environment_id","next_action_date");