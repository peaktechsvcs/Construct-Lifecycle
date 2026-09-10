import { useState, ReactNode } from 'react';
import { useLocation, Link } from 'wouter';
import { 
  LayoutDashboard, BriefcaseBusiness, CalendarDays, Settings2, 
  Bell, Menu, Sparkles, LogOut, Paintbrush
} from 'lucide-react';
import { useTenant } from '@/providers/tenant-provider';
import { useListFollowUps, getListFollowUpsQueryKey, FollowUpStatus, useSwitchTenant } from '@workspace/api-client-react';
import { useUser, useClerk } from '@clerk/react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';

function OpenFollowUpDot() {
  const { data } = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey(), staleTime: 60000 } });
  const count = data?.filter((item) => item.status === FollowUpStatus.open).length ?? 0;
  return count > 0 ? <span className="mono ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-accent-foreground">{count}</span> : null;
}

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { activeTenant, memberships, branding } = useTenant();
  const { user } = useUser();
  const { signOut } = useClerk();
  const switchTenant = useSwitchTenant();
  const qc = useQueryClient();
  
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const nav = [
    { href: '/overview', label: 'Overview', icon: LayoutDashboard },
    { href: '/projects', label: 'Projects', icon: BriefcaseBusiness },
    { href: '/follow-ups', label: 'Follow-ups', icon: CalendarDays },
    { href: '/administration/organization/branding', label: 'Branding', icon: Paintbrush },
  ];

  const handleSwitchTenant = (tenantId: number) => {
    switchTenant.mutate({ data: { tenantId } }, {
      onSuccess: () => {
        qc.clear(); // Clear all tenant-scoped data
        qc.invalidateQueries(); // Force refetch of new tenant context and data
      }
    });
  };

  const getLogoUrl = () => {
    if (branding?.published && branding.published.length > 0) {
      const latest = [...branding.published].sort((a, b) => b.version - a.version)[0];
      const data = latest.data as Record<string, string>;
      if (data.logoUrl) return data.logoUrl;
    }
    return `${basePath}/logo-icon.png`;
  };

  return (
    <div className="min-h-[100dvh] bg-background">
      <aside className={`fixed inset-y-0 left-0 z-40 w-[246px] -translate-x-full border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : ''}`}>
        <div className="flex h-full flex-col">
          <div className="flex h-[86px] items-center border-b border-sidebar-border px-6">
            <Link href="/overview" className="flex items-center gap-3" data-testid="link-brand">
              <img src={getLogoUrl()} alt="Logo" className="h-9 w-9 rounded-lg object-contain bg-background" />
              <div className="min-w-0">
                <span className="block truncate text-[15px] font-bold tracking-tight">{activeTenant?.name || 'Construct LC'}</span>
                <span className="mono block text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/55">Command Center</span>
              </div>
            </Link>
          </div>
          
          <div className="px-4 pt-7">
            <div className="mb-3 px-3 flex items-center justify-between">
              <p className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">Workspace</p>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className="text-sidebar-foreground/45 hover:text-sidebar-foreground transition-colors"><Settings2 size={13} /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-48">
                  <DropdownMenuLabel>Switch Tenant</DropdownMenuLabel>
                  {memberships.map((m) => (
                    <DropdownMenuItem key={m.id} onClick={() => handleSwitchTenant(m.id)} disabled={m.id === activeTenant?.id}>
                      {m.name} {m.id === activeTenant?.id && '(Active)'}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            
            <nav className="space-y-1">
              {nav.map(({ href, label, icon: Icon }) => (
                <Link 
                  key={href} 
                  href={href} 
                  onClick={() => setMobileOpen(false)} 
                  data-testid={`link-nav-${label.toLowerCase()}`} 
                  className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${location.startsWith(href) && (href !== '/overview' || location === '/overview') ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground'}`}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                  {label === 'Follow-ups' && <OpenFollowUpDot />}
                </Link>
              ))}
            </nav>
          </div>
          
          <div className="mt-auto p-4">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/35 p-4">
              <div className="mb-3 flex items-center gap-2 text-accent">
                <Sparkles size={15} />
                <span className="mono text-[9px] uppercase tracking-[.14em]">Today's pulse</span>
              </div>
              <p className="text-xs leading-5 text-sidebar-foreground/65">Keep proposals warm and cash moving. Your next handoff is never more than a click away.</p>
            </div>
            
            <div className="mt-4 flex items-center gap-3 border-t border-sidebar-border pt-4">
              <img src={user?.imageUrl} alt={user?.fullName || 'User'} className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground object-cover" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{user?.fullName || 'User'}</p>
                <p className="truncate text-[10px] text-sidebar-foreground/50">{user?.primaryEmailAddress?.emailAddress}</p>
              </div>
              <button onClick={() => signOut({ redirectUrl: basePath || '/' })} className="ml-auto text-sidebar-foreground/45 hover:text-destructive transition-colors">
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>
      
      {mobileOpen && (
        <button aria-label="Close menu" data-testid="button-close-menu" className="fixed inset-0 z-30 bg-foreground/25 md:hidden" onClick={() => setMobileOpen(false)} />
      )}
      
      <main className="min-h-[100dvh] md:pl-[246px]">
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button data-testid="button-open-menu" className="inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-muted-foreground hover:bg-secondary md:hidden" onClick={() => setMobileOpen(true)}>
              <Menu size={19} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              <span>{activeTenant?.name || 'Construct LC'}</span>
              <span className="text-border">/</span>
              <span className="font-semibold text-foreground">
                {location === '/overview' ? 'Overview' : location.includes('follow-ups') ? 'Follow-ups' : location.includes('branding') ? 'Branding' : 'Projects'}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold">{new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())}</p>
            </div>
            <button data-testid="button-notifications" className="relative rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground">
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] px-4 py-7 md:px-9 md:py-9">
          {children}
        </div>
      </main>
    </div>
  );
}
