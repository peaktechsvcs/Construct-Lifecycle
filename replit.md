# Cabinet Projects

Cabinet Projects is a responsive operations workspace for tracking cabinet, countertop, flooring, lighting, and hardware jobs from opportunity through collected cash and future-work follow-up.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/cabinet-projects` — responsive React/Vite application
- `artifacts/api-server/src/routes/projects.ts` — project, activity, follow-up, and dashboard routes
- `lib/api-spec/openapi.yaml` — API source of truth
- `lib/db/src/schema/projects.ts` — PostgreSQL schema for projects, activity, and follow-ups
- `scripts/src/seed-projects.ts` — development seed data

## Architecture decisions

- The lifecycle is represented as a single project stage plus structured fields for proposal, bid, contract, delivery, billing, closeout, and follow-up so each job has one operational home.
- Dashboard totals and activity are computed from the same project records used by the project book and detail workspace.
- The app uses the shared API server and PostgreSQL database; the generated OpenAPI client is the frontend data access layer.

## Product

- Overview dashboard with stage distribution, pipeline and cash totals, recent activity, and upcoming follow-ups.
- Searchable project book with create, edit, and delete flows.
- Project detail workspace with lifecycle rail, proposal/bid, contract and delivery, billing, closeout, activity, and follow-up scheduling.
- Follow-up queue with open/completed states and overdue treatment.

## User preferences

No additional preferences recorded.

## Gotchas

- Run `pnpm --filter @workspace/api-spec run codegen` after changing the OpenAPI contract.
- Development data can be reseeded with `pnpm --filter @workspace/scripts run seed-projects`; the seed is no-op when projects already exist.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
