import { useState, ReactNode } from 'react';
import { useLocation, Link } from 'wouter';
import {
  LayoutDashboard, BriefcaseBusiness, CalendarDays, Settings2,
  Bell, Menu, Sparkles, LogOut, Paintbrush, ChevronDown, Check, Cable,
  FlaskConical, Globe,
} from 'lucide-react';
import { useTenant } from '@/providers/tenant-provider';
import { useListFollowUps, getListFollowUpsQueryKey, FollowUpStatus, useSwitchTenant } from '@workspace/api-client-react';
import { useUser, useClerk } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator, DropdownMenuLabel } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function OpenFollowUpDot() {
  const { data } = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey(), staleTime: 60000 } });
  const count = data?.filter((item) => item.status === FollowUpStatus.open).length ?? 0;
  return count > 0 ? (
    <span className="mono ml-auto rounded-full bg-sidebar-accent px-1.5 py-0.5 text-[9px] font-bold text-sidebar-foreground/80">
      {count}
    </span>
  ) : null;
}

/** Compact DTD badge — shown in nav sidebar and header whenever env kind is dtd */
function DtdBadge({ size = 'sm' }: { size?: 'sm' | 'xs' }) {
  if (size === 'xs') {
    return (
      <span className="mono inline-flex items-center gap-1 rounded-sm bg-status-warning/15 px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-[.12em] text-status-warning border border-status-warning/25">
        <FlaskConical size={8} />
        DTD
      </span>
    );
  }
  return (
    <span className="mono inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.1em] text-status-warning bg-status-warning/12 border border-status-warning/20">
      <FlaskConical size={9} />
      DTD
    </span>
  );
}

/** Environment switcher dropdown — placed in the sidebar under the workspace section */
function EnvironmentSwitcher() {
  const { activeEnvironment, environments, switchEnvironment, isSwitchingEnvironment } = useTenant();
  const isDtd = activeEnvironment?.kind === 'dtd';

  if (!activeEnvironment || environments.length <= 1) return null;

  return (
    <div className="px-4 pt-3 pb-1">
      <div className="mb-1 px-3">
        <p className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">Environment</p>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-testid="button-environment-switcher"
            disabled={isSwitchingEnvironment}
            className={`w-full flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
              isDtd
                ? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/15 border border-status-warning/20'
                : 'bg-sidebar-accent/35 text-sidebar-foreground hover:bg-sidebar-accent/55 border border-sidebar-border/60'
            }`}
            aria-label="Switch environment"
          >
            {isDtd ? (
              <FlaskConical size={14} className="shrink-0" />
            ) : (
              <Globe size={14} className="shrink-0 text-status-success" />
            )}
            <span className="min-w-0 flex-1 truncate text-left text-xs font-semibold">
              {activeEnvironment.name}
            </span>
            {isDtd && <DtdBadge size="xs" />}
            <ChevronDown size={12} className="shrink-0 opacity-50" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" sideOffset={4} className="w-56">
          <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold">
            Switch Environment
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {environments.map((env) => {
            const isActive = env.id === activeEnvironment.id;
            const isEnvDtd = env.kind === 'dtd';
            return (
              <DropdownMenuItem
                key={env.id}
                data-testid={`environment-option-${env.id}`}
                disabled={isActive || isSwitchingEnvironment}
                onClick={() => !isActive && switchEnvironment(env.id)}
                className="flex items-center gap-2 py-2"
              >
                {isEnvDtd ? (
                  <FlaskConical size={13} className="shrink-0 text-status-warning" />
                ) : (
                  <Globe size={13} className="shrink-0 text-status-success" />
                )}
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{env.name}</span>
                  {isEnvDtd && (
                    <span className="mono block text-[9px] uppercase tracking-[.1em] text-status-warning/80">
                      Design / Test / Demo
                    </span>
                  )}
                  {!isEnvDtd && (
                    <span className="mono block text-[9px] uppercase tracking-[.1em] text-status-success/70">
                      Production
                    </span>
                  )}
                </div>
                {isActive && <Check size={13} className="shrink-0 text-primary" aria-label="Active" />}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** Header environment indicator pill — unobtrusive, shown when DTD is active */
function HeaderEnvironmentPill() {
  const { activeEnvironment } = useTenant();
  if (!activeEnvironment || activeEnvironment.kind !== 'dtd') return null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          data-testid="header-dtd-indicator"
          className="mono hidden items-center gap-1.5 rounded-md border border-status-warning/30 bg-status-warning/10 px-2 py-1 text-[10px] font-bold uppercase tracking-[.1em] text-status-warning sm:inline-flex"
        >
          <FlaskConical size={10} />
          {activeEnvironment.name}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[200px] text-center text-xs">
        You are viewing Design / Test / Demo data. Changes here do not affect Production.
      </TooltipContent>
    </Tooltip>
  );
}

const PAGE_LABELS: Record<string, string> = {
  '/overview': 'Overview',
  '/projects': 'Projects',
  '/follow-ups': 'Follow-ups',
};

function getBreadcrumbLabel(location: string): string {
  if (location === '/overview') return 'Overview';
  if (location.startsWith('/follow-ups')) return 'Follow-ups';
  if (location.includes('/administration/organization/branding')) return 'Customer Branding';
  if (location.includes('/administration/organization/integrations')) return 'Integrations';
  if (location.includes('/administration/organization/access')) return 'Organization Access';
  if (location.includes('/administration/platform/customers')) return 'Platform Customers';
  if (location.startsWith('/projects')) return 'Projects';
  return '';
}

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { activeTenant, memberships, branding, activeEnvironment, isPlatformAdmin } = useTenant();
  const { user } = useUser();
  const { signOut } = useClerk();
  const switchTenant = useSwitchTenant();
  const qc = useQueryClient();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const isDtdEnv = activeEnvironment?.kind === 'dtd';

  const nav = [
    { href: '/overview', label: 'Overview', icon: LayoutDashboard },
    { href: '/projects', label: 'Projects', icon: BriefcaseBusiness },
    { href: '/follow-ups', label: 'Follow-ups', icon: CalendarDays },
    { href: '/administration/organization/branding', label: 'Customer Branding', icon: Paintbrush },
    { href: '/administration/organization/integrations', label: 'Integrations', icon: Cable },
    { href: '/administration/organization/access', label: 'Organization Access', icon: Settings2 },
    ...(isPlatformAdmin ? [{ href: '/administration/platform/customers', label: 'Platform Customers', icon: Globe }] : []),
  ];

  const handleSwitchTenant = (tenantId: number) => {
    switchTenant.mutate(
      { data: { tenantId } },
      {
        onSuccess: () => {
          qc.clear();
          qc.invalidateQueries();
        },
      }
    );
  };

  const getLogoUrl = () => {
    if (branding?.published && branding.published.length > 0) {
      const latest = [...branding.published].sort((a, b) => b.version - a.version)[0];
      const data = latest.data as Record<string, string>;
      if (data.logoUrl) return data.logoUrl;
    }
    return `${basePath}/logo-icon.png`;
  };

  const breadcrumbLabel = getBreadcrumbLabel(location);

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* DTD environment banner — full-width, subtle top strip */}
      {isDtdEnv && (
        <div
          data-testid="dtd-env-banner"
          className="fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2 bg-status-warning/10 border-b border-status-warning/25 py-1 text-center md:pl-[246px]"
          role="status"
          aria-live="polite"
        >
          <FlaskConical size={11} className="text-status-warning shrink-0" />
          <span className="mono text-[10px] font-bold uppercase tracking-[.12em] text-status-warning">
            Design / Test / Demo &mdash; {activeEnvironment?.name}
          </span>
        </div>
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-[246px] -translate-x-full border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : ''} ${isDtdEnv ? 'top-[28px]' : ''}`}
      >
        <div className="flex h-full flex-col">
          {/* Brand / tenant header */}
          <div className="flex h-[86px] items-center border-b border-sidebar-border px-6">
            <Link href="/overview" className="flex items-center gap-3" data-testid="link-brand">
              <img
                src={getLogoUrl()}
                alt="Logo"
                className="h-9 w-9 rounded-lg object-contain bg-background"
              />
              <div className="min-w-0">
                <span className="block truncate text-[15px] font-bold tracking-tight">
                  {activeTenant?.name || 'Construct LC'}
                </span>
                <span className="mono block text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/55">
                  Command Center
                </span>
              </div>
            </Link>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Customer (tenant) switcher */}
            <div className="px-4 pt-7">
              <div className="mb-3 px-3 flex items-center justify-between">
                <p className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">
                  Customer
                </p>
                {memberships.length > 1 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        data-testid="button-customer-switcher"
                        className="text-sidebar-foreground/45 hover:text-sidebar-foreground transition-colors"
                        aria-label="Switch customer"
                      >
                        <Settings2 size={13} />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="w-48">
                      <DropdownMenuLabel>Switch Customer</DropdownMenuLabel>
                      <DropdownMenuSeparator />
                      {memberships.map((m) => (
                        <DropdownMenuItem
                          key={m.id}
                          data-testid={`customer-option-${m.id}`}
                          onClick={() => handleSwitchTenant(m.id)}
                          disabled={m.id === activeTenant?.id}
                          className="flex items-center gap-2"
                        >
                          <span className="flex-1 truncate">{m.name}</span>
                          {m.id === activeTenant?.id && (
                            <Check size={13} className="shrink-0 text-primary" />
                          )}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <p className="px-3 text-xs font-semibold text-sidebar-foreground/75 truncate mb-4">
                {activeTenant?.name || 'Loading...'}
              </p>
            </div>

            {/* Environment switcher */}
            <EnvironmentSwitcher />

            {/* Navigation */}
            <div className="px-4 pt-5">
              <div className="mb-3 px-3">
                <p className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">
                  Workspace
                </p>
              </div>
              <nav className="space-y-1" aria-label="Primary navigation">
                {nav.map(({ href, label, icon: Icon }) => {
                  const isActive =
                    location.startsWith(href) &&
                    (href !== '/overview' || location === '/overview');
                  return (
                    <Link
                      key={href}
                      href={href}
                      onClick={() => setMobileOpen(false)}
                      data-testid={`link-nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
                      aria-current={isActive ? 'page' : undefined}
                      className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-foreground'
                          : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground'
                      }`}
                    >
                      <Icon size={17} />
                      <span>{label}</span>
                      {label === 'Follow-ups' && <OpenFollowUpDot />}
                    </Link>
                  );
                })}
              </nav>
            </div>
          </div>

          {/* User footer */}
          <div className="p-4 border-t border-sidebar-border">
            <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/35 p-4 mb-4">
              <div className="mb-3 flex items-center gap-2 text-accent">
                <Sparkles size={15} />
                <span className="mono text-[9px] uppercase tracking-[.14em]">Today's pulse</span>
              </div>
              <p className="text-xs leading-5 text-sidebar-foreground/65">
                Keep proposals warm and cash moving. Your next handoff is never more than a click away.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <img
                src={user?.imageUrl}
                alt={user?.fullName || 'User'}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground object-cover"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs font-semibold">{user?.fullName || 'User'}</p>
                <p className="truncate text-[10px] text-sidebar-foreground/50">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
              </div>
              <button
                onClick={() => signOut({ redirectUrl: basePath || '/' })}
                className="ml-auto text-sidebar-foreground/45 hover:text-destructive transition-colors"
                aria-label="Sign out"
                data-testid="button-sign-out"
              >
                <LogOut size={15} />
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile backdrop */}
      {mobileOpen && (
        <button
          aria-label="Close menu"
          data-testid="button-close-menu"
          className="fixed inset-0 z-30 bg-foreground/25 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <main className={`min-h-[100dvh] md:pl-[246px] ${isDtdEnv ? 'pt-[28px]' : ''}`}>
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button
              data-testid="button-open-menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-muted-foreground hover:bg-secondary md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={19} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              <span>{activeTenant?.name || 'Construct LC'}</span>
              <span className="text-border">/</span>
              <span className="font-semibold text-foreground">{breadcrumbLabel}</span>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <HeaderEnvironmentPill />
            <div className="hidden text-right sm:block">
              <p className="text-xs font-semibold">
                {new Intl.DateTimeFormat('en-US', {
                  weekday: 'long',
                  month: 'long',
                  day: 'numeric',
                }).format(new Date())}
              </p>
            </div>
            <button
              data-testid="button-notifications"
              className="relative rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
              aria-label="Notifications"
            >
              <Bell size={18} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" />
            </button>
          </div>
        </header>
        <div className="mx-auto max-w-[1500px] px-4 py-7 md:px-9 md:py-9">{children}</div>
      </main>
    </div>
  );
}
