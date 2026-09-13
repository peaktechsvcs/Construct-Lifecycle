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
} from '@workspace/api-client-react';
import { hexToHsl } from '@/lib/color-utils';

interface TenantContextType {
  activeTenant?: Tenant;
  memberships: TenantMembershipSummary[];
  branding?: PublishedBrandingContext;
  activeEnvironment?: Environment;
  environments: Environment[];
  environmentLabel?: TenantContextEnvironmentLabel;
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
  const isPlatformAdmin = tenantQuery.data?.isPlatformAdmin ?? false;
  const activeRole = memberships.find((membership) => membership.id === activeTenant?.id)?.role;
  const branding = brandingQuery.data;

  // Apply published branding to CSS variables globally
  useEffect(() => {
    if (!branding || branding.published.length === 0) return;

    const latest = [...branding.published].sort((a, b) => b.version - a.version)[0];
    if (!latest || !latest.data) return;

    const root = document.documentElement;
    const data = latest.data as Record<string, string>;

    if (data.primaryColor) root.style.setProperty('--primary', hexToHsl(data.primaryColor) || '');
    if (data.secondaryColor) root.style.setProperty('--secondary', hexToHsl(data.secondaryColor) || '');
    if (data.accentColor) root.style.setProperty('--accent', hexToHsl(data.accentColor) || '');
    if (data.backgroundColor) root.style.setProperty('--background', hexToHsl(data.backgroundColor) || '');
    if (data.foregroundColor) root.style.setProperty('--foreground', hexToHsl(data.foregroundColor) || '');

    return () => {
      root.style.removeProperty('--primary');
      root.style.removeProperty('--secondary');
      root.style.removeProperty('--accent');
      root.style.removeProperty('--background');
      root.style.removeProperty('--foreground');
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
