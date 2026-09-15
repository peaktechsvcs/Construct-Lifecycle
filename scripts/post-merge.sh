#!/bin/bash
set -e

# Post-merge setup is development-only. Production schema changes must go
# through Replit Publish so the schema diff and rename/data-loss warnings are
# shown before anything is applied.
if [ "${APP_ENV:-development}" = "production" ]; then
  echo "Refusing post-merge schema push with APP_ENV=production." >&2
  exit 1
fi

pnpm install --frozen-lockfile
pnpm --filter @workspace/db exec drizzle-kit push --config ./drizzle.config.ts --force
