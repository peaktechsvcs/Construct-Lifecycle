import { createContext, useContext, useEffect, ReactNode } from 'react';
import { useAuth } from '@clerk/react';
import {
  useGetTenantContext,
  useGetBranding,
  getGetTenantContextQueryKey,
  getGetBrandingQueryKey,
  Tenant,
  BrandingContext,
} from '@workspace/api-client-react';
import { hexToHsl } from '@/lib/color-utils';

interface TenantContextType {
  activeTenant?: Tenant;
  memberships: Tenant[];
  branding?: BrandingContext;
  isLoading: boolean;
}

const TenantContext = createContext<TenantContextType>({ memberships: [], isLoading: true });

export function useTenant() {
  return useContext(TenantContext);
}

export function TenantProvider({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();
  const tenantQuery = useGetTenantContext({
    query: {
      queryKey: getGetTenantContextQueryKey(),
      enabled: isLoaded && isSignedIn,
      retry: false,
    },
  });
  const brandingQuery = useGetBranding({ query: { queryKey: getGetBrandingQueryKey(), enabled: !!tenantQuery.data?.activeTenant } });

  const activeTenant = tenantQuery.data?.activeTenant;
  const memberships = tenantQuery.data?.memberships ?? [];
  const branding = brandingQuery.data;
  
  // Apply published branding to CSS variables globally
  useEffect(() => {
    if (!branding || branding.published.length === 0) return;
    
    // Sort to find the latest published version
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
      // Cleanup on unmount or tenant switch
      root.style.removeProperty('--primary');
      root.style.removeProperty('--secondary');
      root.style.removeProperty('--accent');
      root.style.removeProperty('--background');
      root.style.removeProperty('--foreground');
    };
  }, [branding]);

  return (
    <TenantContext.Provider value={{ activeTenant, memberships, branding, isLoading: !isLoaded || tenantQuery.isLoading }}>
      {children}
    </TenantContext.Provider>
  );
}
