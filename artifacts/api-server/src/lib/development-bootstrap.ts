export function shouldBootstrapDefaultTenant({
  appEnv,
  isPlatformAdmin,
  hasUserMemberships,
  membershipCount,
}: {
  appEnv: string;
  isPlatformAdmin: boolean;
  hasUserMemberships: boolean;
  membershipCount: number;
}) {
  return appEnv !== "production"
    && !hasUserMemberships
    && (isPlatformAdmin || membershipCount === 0);
}

export function shouldCreateDevelopmentEnvironment({
  appEnv,
  hasEnvironment,
}: {
  appEnv: string;
  hasEnvironment: boolean;
}) {
  return appEnv !== "production" && !hasEnvironment;
}