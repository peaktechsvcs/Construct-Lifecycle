import { createContext, useContext, useEffect, useCallback, ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetTenantContext,
  useGetPublishedBranding,
  useSwitchEnvironment,
  getGetTenantContextQueryKey,
  getGetPublishedBrandingQueryKey,
  Tenant,
  TenantMembershipSummary,
  Environment,
  PublishedBrandingContext,
  TenantContextEnvironmentLabel,
  EffectiveBillingAccess,
} from '@workspace/api-client-react';
import { BRANDING_COLOR_KEYS, hexToHsl, sanitizeBrandingColors } from '@/lib/color-utils';

interface TenantContextType {
  activeTenant?: Tenant;
  memberships: TenantMembershipSummary[];
  branding?: PublishedBrandingContext;
  activeEnvironment?: Environment;
  environments: Environment[];
  environmentLabel?: TenantContextEnvironmentLabel;
  effectiveAccess?: EffectiveBillingAccess;
  isPlatformAdmin: boolean;
  activeRole?: string;
  isLoading: boolean;
  isError: boolean;
  switchEnvironment: (environmentId: number) => void;
  isSwitchingEnvironment: boolean;
}

const TenantContext = createContext<TenantContextType>({
  memberships: [],
  environments: [],
  isLoading: true,
  switchEnvironment: () => {},
  isSwitchingEnvironment: false,
  isPlatformAdmin: false,
  isError: false,
});

export function useTenant() {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const qc = useQueryClient();

  const tenantQuery = useGetTenantContext({
    query: {
      queryKey: getGetTenantContextQueryKey(),
      enabled: isLoaded && !!isSignedIn,
      retry: false,
    },
  });

  const brandingQuery = useGetPublishedBranding({
    query: {
      queryKey: getGetPublishedBrandingQueryKey(),
      enabled: tenantQuery.data?.activeTenant?.customerBrandingEnabled === true,
    },
  });

  const switchEnvMutation = useSwitchEnvironment();

  const activeTenant = tenantQuery.data?.activeTenant;
  const memberships = tenantQuery.data?.memberships ?? [];
  const activeEnvironment = tenantQuery.data?.activeEnvironment;
  const environments = tenantQuery.data?.environments ?? [];
  const environmentLabel = tenantQuery.data?.environmentLabel;
  const effectiveAccess = tenantQuery.data?.effectiveAccess;
  const isPlatformAdmin = tenantQuery.data?.isPlatformAdmin ?? false;
  const activeRole = memberships.find((membership) => membership.id === activeTenant?.id)?.role;
  const branding = brandingQuery.data;

  // Apply published branding to CSS variables globally
  useEffect(() => {
    if (!branding || !Array.isArray(branding.published) || branding.published.length === 0) return;

    const latest = [...branding.published].sort((a, b) => b.version - a.version)[0];
    if (!latest || !latest.data || typeof latest.data !== 'object') return;

    const root = document.documentElement;
    const safeColors = sanitizeBrandingColors(latest.data);
    const appliedVariables = BRANDING_COLOR_KEYS.flatMap((key) => {
      const hsl = hexToHsl(safeColors[key]);
      if (!hsl) return [];
      const variable = `--${key.replace('Color', '')}`;
      root.style.setProperty(variable, hsl);
      return [variable];
    });

    return () => {
      for (const variable of appliedVariables) root.style.removeProperty(variable);
    };
  }, [branding]);

  const handleSwitchEnvironment = useCallback(
    (environmentId: number) => {
      switchEnvMutation.mutate(
        { data: { environmentId } },
        {
          onSuccess: (newContext) => {
            // Update tenant context cache directly with fresh data from switch response
            qc.setQueryData(getGetTenantContextQueryKey(), newContext);
            // Invalidate all environment-scoped queries so they refetch with new env
            qc.invalidateQueries({ predicate: (query) => {
              const key = query.queryKey[0];
              return typeof key === 'string' && (
                key.startsWith('/api/projects') ||
                key.startsWith('/api/follow-ups') ||
                key.startsWith('/api/dashboard') ||
                key.startsWith('/api/tenant/branding') ||
                  key.startsWith('/api/integrations') ||
                key.startsWith('/api/platform')
              );
            }});
          },
        }
      );
    },
    [qc, switchEnvMutation]
  );

  return (
    <TenantContext.Provider
      value={{
        activeTenant,
        memberships,
        branding,
        activeEnvironment,
        environments,
        environmentLabel,
        effectiveAccess,
        isPlatformAdmin,
        activeRole,
        isLoading: !isLoaded || tenantQuery.isLoading,
        isError: tenantQuery.isError,
        switchEnvironment: handleSwitchEnvironment,
        isSwitchingEnvironment: switchEnvMutation.isPending,
      }}
    >
      {children}
    </TenantContext.Provider>
  );
}
