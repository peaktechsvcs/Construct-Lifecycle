# Construct Lifecycle

Construct Lifecycle — The Construction Lifecycle Platform is a responsive, multi-tenant workspace for construction suppliers and teams managing work from opportunity through closeout.

## Scope boundaries — read before making any change

This project is developed across two surfaces. Replit Agent handles new
surfaces and exploratory work. Claude Code handles shared packages,
data, auth, and infrastructure. Once an area moves to Claude Code it
does not move back.

### Do not modify these paths

Agent must not create, edit, delete, or refactor anything under:

- `lib/db/**` — Drizzle schema, migrations, and database client
- `lib/db/migrations/**` — hand-written SQL, applied in version order.
  Never add, edit, renumber, or delete a migration file
- `lib/db/drizzle.config.ts`
- `artifacts/api-server/src/middlewares/**` — authentication, tenant
  context, and the runtime signing boundary
- The shared design-system package
- The generated API client under `lib/`
- `scripts/*.mjs` — release gates and clean-database validation
- `replit.md` itself

If a requested change requires touching any of these, stop and say so
rather than proceeding. Describe what would need to change and wait.

### Do not touch configuration

- Never modify `DATABASE_URL` or `DIRECT_URL`. The database is external
  (Neon). `DATABASE_URL` is a pooled endpoint; `DIRECT_URL` is direct and
  is required for DDL
- Never re-add a Replit-managed database, or suggest one
- Never add new `@replit/*` packages or Replit connectors. Existing ones
  are being removed, not extended
- Never run `push-force`. It is used only by
  `scripts/validate-clean-database.mjs`
- Never modify Secrets

### Schema changes

The schema is `drizzle-kit push` plus hand-written SQL migrations applied
in order. Both are required for a correct database. Agent does not make
schema changes. If a feature needs one, describe the change and stop.

### Drafts

Do not generate speculative task drafts. Propose work only when asked.

### Architecture facts, so they are not re-derived

- Multi-tenant. Nearly every table carries `tenant_id` and
  `environment_id`. New tables follow the same pattern
- Each tenant has exactly one `production` and one `dtd` customer
  environment. These are database rows, not deployments
- Clerk provides authentication only. No Clerk Organizations. All
  tenancy, roles, and access live in Postgres, keyed to
  `local_users.clerk_user_id`
- `APP_ENV` describes where the process runs and is unrelated to
  customer environments
- Brand and UI conventions live in `/docs` and are authoritative

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` plus the Replit-managed Clerk variables provisioned through the Auth integration

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/clc-projects` — Construct Lifecycle responsive React/Vite application
- `artifacts/cabinet-projects` — legacy rollback copy, served only at `/legacy-cabinet-projects/`
- `artifacts/api-server/src/routes/projects.ts` — tenant-scoped project, activity, follow-up, and dashboard routes
- `artifacts/api-server/src/routes/tenant.ts` — active workspace and branding lifecycle routes
- `artifacts/api-server/src/middlewares/tenantContext.ts` — authenticated user and tenant authorization boundary
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/projects.ts` — PostgreSQL schema for projects, activity, and follow-ups
- `lib/db/src/schema/tenants.ts` — tenants, memberships, active context, branding drafts, and published theme versions
- `scripts/src/seed-projects.ts` — development seed data

## Architecture decisions

- The lifecycle is represented as a single project stage plus structured fields for proposal, bid, contract, delivery, billing, closeout, and follow-up so each job has one operational home.
- Dashboard totals and activity are computed from the same project records used by the project book and detail workspace.
- The app uses the shared API server and PostgreSQL database; the generated OpenAPI client is the frontend data access layer.
- Clerk authenticates users; PostgreSQL memberships and the validated active-tenant context authorize every tenant-owned request.
- Construct Lifecycle defaults and published tenant branding are applied through semantic CSS tokens. Draft themes remain inactive until publish.

## Product

- Overview dashboard with stage distribution, pipeline and cash totals, recent activity, and upcoming follow-ups.
- Searchable project book with create, edit, and delete flows.
- Project detail workspace with lifecycle rail, proposal/bid, contract and delivery, billing, closeout, activity, and follow-up scheduling.
- Follow-up queue with open/completed states and overdue treatment.
- Tenant workspace switching for users with more than one authorized membership.
- Administration → Organization → Branding with live component preview, WCAG checks, draft, publish, reset, and rollback.

## User preferences

No additional preferences recorded.

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after changing the OpenAPI contract.
- Development data can be migrated/reseeded with `pnpm --filter @workspace/scripts run seed-projects`; it creates the default demo tenant and backfills existing records without deleting them.
- Only the first authenticated user in an empty development user store claims the demo tenant. Later users require an explicit membership.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
