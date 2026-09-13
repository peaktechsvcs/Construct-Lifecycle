# Environment provisioning and recovery

Construct Lifecycle has one Production environment and one combined
Development/Test/Demo (D/T/D) environment per customer. They share a customer
identity, but never share execution resources. The control plane tracks seven
separate resources for every environment: runtime, database, storage, queue,
secrets, jobs, and logs.

## Provisioning

1. Apply the database schema through the normal development migration/publish
   flow, including migration `0005_environment_provisioning_control_plane.sql`.
   Existing environments have `isolation_enforced = false`, so this is
   non-disruptive.
2. Configure `PROVISIONING_PROVIDER_URL`,
   `PROVISIONING_PROVIDER_TOKEN`, and optionally
   `PROVISIONING_PROVIDER_TIMEOUT_MS`. The provider URL must use HTTPS in
   normal operation; HTTP requires both explicit
   `PROVISIONING_PROVIDER_ALLOW_INSECURE_HTTP=true` and
   `PROVISIONING_PROVIDER_LOCAL_ONLY=true`, and is rejected when
   `NODE_ENV`/`APP_ENV` is production. The HTTP adapter calls the provider's
   `/v1/resources`, `/v1/resources/{externalId}/verify`,
    `/v1/snapshots`, `/v1/snapshots/verify`, `/v1/snapshots/restore`,
    `/v1/snapshots/restore/status`, and `/v1/snapshots/restore/verify`
    endpoints, plus `/v1/runtime-signing-keys/resolve`. The provider returns
   only an opaque `secretReference`/key identifier in resource provisioning;
   raw signing key material is returned only to the control-plane provider
   client for the immediate HMAC operation and is never stored in the
   database or API response. The application ships with an explicit
   unavailable adapter when either required variable is missing; it never
   reports a resource as ready when a provider is not configured.
3. A platform administrator starts
   `POST /api/platform/environments/{environmentId}/provision` with a unique
   `idempotencyKey`. Each resource operation and transition is recorded in
   `provisioning_operations` and `provisioning_events`.
4. Verify the context with
   `POST /api/platform/environments/{environmentId}/verify`. A context is
   selectable only when all seven resource rows are `ready` and the latest
   health check is healthy. Provider resource and snapshot verification
   responses must contain `verified: true`; an absent, false, or ambiguous
   verification result degrades/fails the resource or snapshot and never
   creates a healthy/verified record.
5. After confirming traffic and rollback readiness, explicitly call
   `POST /api/platform/environments/{environmentId}/enforce-isolation`.
   Before that call, existing environments retain their legacy operation
   path; after it, switching requires all resources and a recent successful
   health check. Runtime dispatch always applies the stricter checks.

Repeated requests with the same environment, operation, and idempotency key
are safe. Invalid resource transitions fail rather than silently repairing
state. Provider outages leave an auditable failed operation and an unavailable
environment.

Provision claims lock the resource row and atomically create the unique
operation claim before calling the provider. A second request with a succeeded
key returns the existing success; a request observing a running claim returns
`202` and never changes the resource state. Environment provisioning status is
recomputed from the current resource rows and operation claims after every
completion, rather than trusting a request-local result.

## Environment switching

`POST /api/tenant/environments` changes only the user's active environment
context. It does not change `tenantId`, membership, or customer identity.
When isolation is enforced, the request is rejected unless the target belongs
to the current customer, the user has environment access, and its complete
isolated execution context has a recent successful health check. During
rollout, the legacy local execution path remains available. After isolation is
enforced, normal operational API requests are automatically dispatched to the
selected runtime endpoint only after the stricter readiness and health checks;
clients do not change URLs.

Each runtime deployment receives only its own signing key from the runtime
secret manager as `RUNTIME_FORWARDING_SIGNING_SECRET`; the control plane does
not use one process-wide forwarding key. Runtime deployments set the
environment-specific
`RUNTIME_TENANT_ID` and `RUNTIME_ENVIRONMENT_ID`,
`RUNTIME_DATABASE_URL`, `RUNTIME_FORWARDING_SIGNING_SECRET`,
`RUNTIME_REPLAY_GUARD_MODE`, and (for `http` mode)
`RUNTIME_REPLAY_GUARD_URL`. They mount `requireSignedRuntimeContext` before
execution handlers. `single-process` replay mode is explicitly limited to one
runtime process; horizontally scaled deployments must use the shared
provider-backed `http` replay guard, which atomically consumes nonces and
fails closed when unavailable. The middleware validates the short-lived HMAC
envelope, exact path+query, cryptographically random nonce, tenant/user
identity, environment binding, and one-hop limit.

The control plane also requires `RUNTIME_ALLOWED_HOSTS`, a comma-separated
exact hostname allowlist for runtime providers. Runtime endpoints must be
HTTPS on port 443, have no credentials, and resolve only to globally routable
addresses; loopback, private, link-local, multicast, documentation, and
reserved IPv4/IPv6 addresses are rejected. The dispatcher resolves the
allowlisted hostname immediately before an HTTPS request, pins that resolved
address for the request, uses the provider hostname for TLS SNI/certificate
validation, and never follows redirects. Provider contracts must therefore
use stable allowlisted DNS names and preserve the signed forwarded path+query
exactly (the provider endpoint's base path plus the dispatched operational
path); DNS changes require an updated provider configuration and health check.
The provider must terminate TLS for the allowlisted hostname and must not
redirect. Forwarding secrets are never returned in API payloads or logs.

In runtime mode the shared database package connects with
`RUNTIME_DATABASE_URL`, Stripe initialization, `/api/stripe/webhook`, Clerk
proxying, and platform/control-plane routes are not mounted. Health and
signed operational handlers run only after the signed context has populated
the fixed tenant and environment IDs.

## Production-to-D/T/D refresh

Refresh is explicit: `POST
/api/platform/environments/{dtdEnvironmentId}/refresh` must name the same
customer's Production environment and one of the approved sanitization
policies (`redact-secrets`, `replace-identifiers`, or `full`). Cross-customer,
D/T/D-to-Production, and implicit/no-policy refreshes are rejected.

The control plane creates a snapshot and refresh record before calling the
provider, verifies the sanitized snapshot, and then restores it into D/T/D.
The restore is tracked as a provisioning operation. A `202` response means the
provider accepted the restore and the operation is still pending; the control
plane polls provider status and verifies the restored target before marking the
refresh completed. Provider failure or failed target verification marks the
operation and refresh failed instead. Both records retain failure details,
timestamps, actor, source, target, and policy. Providers must sanitize secrets
and customer identifiers while creating the refresh snapshot. Transactional
D/T/D data is never a source for a Production release.

## Backups, restore, and rollback

Before Production promotion:

* all seven Production resources must be ready;
* a recent healthy environment check must exist; and
* a provider-verified `backup` snapshot must exist.

Promotion records those snapshot and health-check IDs in
`environment_release_controls`, making the rollback snapshot part of the
release audit trail. Restore accepts only a verified snapshot with a provider
backup reference. Restore and rollback create tracked operations and expose
their status at `GET /api/platform/provisioning-operations/{operationId}`.
The operation is completed only after the provider reports success and target
verification returns `verified: true`; provider failure or verification failure
remains visible and does not mark the release as recovered.

The shipped provider-neutral adapter intentionally fails with HTTP 503 until a
real resource/backup adapter is configured. This is a deployment prerequisite,
not a mock environment.