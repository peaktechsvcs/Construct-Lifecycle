# Construct LC authentication and access administration

Construct LC uses the Replit-managed Clerk tenant for all authentication. The
application does not create a second auth system, store passwords, or store
Clerk credentials in the repository.

## Login methods

- Email and password are rendered by the Clerk sign-in and sign-up routes.
- Email verification is handled by Clerk when the managed tenant requires it.
- Google is controlled from the workspace Auth pane. When it is enabled there,
  the branded Clerk components render the Google button automatically.
- Microsoft 365 is not a managed social-login button in the Replit Clerk Auth
  pane. Microsoft sign-in must be configured as a Microsoft Entra ID enterprise
  SSO connection in the Clerk-managed settings before it can appear.

The sign-in and sign-up routes intentionally use optional wildcards so Clerk
OAuth and verification callbacks remain inside the app:

- `<artifact-base>/sign-in/*`
- `<artifact-base>/sign-up/*`

The base path must be included in the public redirect URLs. The same public
origin must be allowed by the provider configuration, and provider redirect
URLs must match the values shown in the workspace Auth configuration exactly.
Do not paste provider secrets, client secrets, or Clerk keys into this file or
into source control.

## Customer access

Clerk establishes identity. PostgreSQL establishes authorization:

1. Every authenticated Clerk user is upserted into `local_users`.
2. Customer memberships are resolved server-side from `tenant_memberships`.
3. Project, branding, integration, and environment requests use that resolved
   membership and never trust a client-supplied tenant or environment as an
   authorization decision.
4. Customer owners and admins can invite users, change roles, remove members,
   and revoke pending invitations.
5. Invitation tokens are returned once, stored only as SHA-256 hashes, expire
   after seven days, and are accepted only by an authenticated session.

## Platform administration

The first authenticated development user is bootstrapped as a platform admin
to preserve the populated demo workspace. Production platform admins must be
provisioned through the platform's controlled database/admin process. Platform
admins can create customer workspaces with the combined Development / Test /
Demo environment plus Production, optionally issue the initial owner
invitation, and suspend or reactivate a customer.