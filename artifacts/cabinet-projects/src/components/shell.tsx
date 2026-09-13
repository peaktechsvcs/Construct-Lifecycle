import { useState, type ReactNode } from 'react';
import { useLocation, Link } from 'wouter';
import {
  LayoutDashboard, BriefcaseBusiness, Building2,
  Bell, Menu, Sparkles, LogOut, ChevronDown, Check, Settings,
  FlaskConical, Globe, PanelLeftClose, PanelLeftOpen, X,
  Lightbulb, Gavel, Calculator, FileText, FolderKanban, FileCheck2, Milestone,
  Package, ListChecks, ShoppingCart, ClipboardList, Truck, PackageCheck,
  Rocket,
  TrendingUp, HandCoins, Receipt, BadgeDollarSign, FilePenLine, Percent,
  Files, ReceiptText, Archive, BarChart3, LineChart, type LucideIcon,
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
function EnvironmentSwitcher({ collapsed = false }: { collapsed?: boolean }) {
  const { activeEnvironment, environments, switchEnvironment, isSwitchingEnvironment } = useTenant();
  const isDtd = activeEnvironment?.kind === 'dtd';

  if (!activeEnvironment || environments.length <= 1) return null;

  return (
    <div className={`pt-3 pb-1 ${collapsed ? 'px-2' : 'px-4'}`}>
      <div className={`mb-1 ${collapsed ? 'px-0 text-center' : 'px-3'}`}>
        {!collapsed && <p className="mono text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">Environment</p>}
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            data-testid="button-environment-switcher"
            disabled={isSwitchingEnvironment}
            className={`w-full flex items-center gap-2 rounded-lg ${collapsed ? 'justify-center px-2' : 'px-3'} py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 ${
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
            {!collapsed && <span className="min-w-0 flex-1 truncate text-left text-xs font-semibold">{activeEnvironment.name}</span>}
            {!collapsed && isDtd && <DtdBadge size="xs" />}
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
  '/overview': 'Dashboard',
  '/projects': 'Projects',
  '/customers': 'Customers',
  '/follow-ups': 'Follow-ups',
};

type NavigationItem = { href: string; label: string; icon: LucideIcon; badge?: boolean };
type NavigationGroup = { label: string; items: NavigationItem[] };

const NAVIGATION_GROUPS: NavigationGroup[] = [
  {
    label: 'Home',
    items: [
      { href: '/overview', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/follow-ups', label: 'My Work', icon: BriefcaseBusiness, badge: true },
      { href: '/coming-soon/notifications', label: 'Notifications', icon: Bell },
    ],
  },
  {
    label: 'Pipeline',
    items: [
      { href: '/coming-soon/opportunities', label: 'Opportunities', icon: Lightbulb },
      { href: '/coming-soon/bids', label: 'Bids', icon: Gavel },
      { href: '/coming-soon/estimates', label: 'Estimates', icon: Calculator },
      { href: '/coming-soon/proposals', label: 'Proposals', icon: FileText },
    ],
  },
  {
    label: 'Projects',
    items: [
      { href: '/customers', label: 'Customers', icon: BriefcaseBusiness },
      { href: '/projects', label: 'All Projects', icon: FolderKanban },
      { href: '/coming-soon/active-projects', label: 'Active Projects', icon: BriefcaseBusiness },
      { href: '/coming-soon/contracts', label: 'Contracts', icon: FileCheck2 },
      { href: '/coming-soon/milestones', label: 'Milestones', icon: Milestone },
    ],
  },
  {
    label: 'Operations',
    items: [
      { href: '/coming-soon/vendors', label: 'Vendors', icon: Building2 },
      { href: '/coming-soon/products', label: 'Products', icon: Package },
      { href: '/coming-soon/selections', label: 'Selections', icon: ListChecks },
      { href: '/coming-soon/procurement', label: 'Procurement', icon: ShoppingCart },
      { href: '/coming-soon/purchase-orders', label: 'Purchase Orders', icon: ClipboardList },
      { href: '/coming-soon/deliveries', label: 'Deliveries', icon: Truck },
      { href: '/coming-soon/receiving', label: 'Receiving', icon: PackageCheck },
    ],
  },
  {
    label: 'Financial',
    items: [
      { href: '/coming-soon/revenue', label: 'Revenue', icon: TrendingUp },
      { href: '/coming-soon/commitments', label: 'Commitments', icon: HandCoins },
      { href: '/coming-soon/costs', label: 'Costs', icon: Receipt },
      { href: '/coming-soon/billing', label: 'Billing', icon: BadgeDollarSign },
      { href: '/coming-soon/change-orders', label: 'Change Orders', icon: FilePenLine },
      { href: '/coming-soon/margin', label: 'Margin', icon: Percent },
    ],
  },
  {
    label: 'Closeout',
    items: [
      { href: '/coming-soon/open-items', label: 'Open Items', icon: ListChecks },
      { href: '/coming-soon/documentation', label: 'Documentation', icon: Files },
      { href: '/coming-soon/final-billing', label: 'Final Billing', icon: ReceiptText },
      { href: '/coming-soon/closed-projects', label: 'Closed Projects', icon: Archive },
    ],
  },
  {
    label: 'Insights',
    items: [
      { href: '/coming-soon/dashboards', label: 'Dashboards', icon: BarChart3 },
      { href: '/coming-soon/reports', label: 'Reports', icon: FileText },
      { href: '/coming-soon/analytics', label: 'Analytics', icon: LineChart },
      { href: '/coming-soon/construct-intelligence', label: 'Construct Intelligence', icon: Sparkles },
    ],
  },
  {
    label: 'Release safety',
    items: [
      { href: '/administration/platform/releases', label: 'Releases', icon: Rocket },
    ],
  },
];

function getBreadcrumbLabel(location: string): string {
  if (location === '/overview') return 'Dashboard';
  if (location.startsWith('/follow-ups')) return 'My Work';
  if (location.startsWith('/settings/administration')) return 'Administration';
  if (location === '/settings' || location.startsWith('/settings/')) return 'Settings';
  if (location.includes('/administration/platform/customers')) return 'Platform Customers';
  if (location.includes('/administration/platform/releases')) return 'Release management';
  if (location.startsWith('/projects')) return 'All Projects';
  if (location.startsWith('/customers')) return 'Customers';
  if (location.startsWith('/coming-soon/')) {
    return location.slice('/coming-soon/'.length).replace(/-/g, ' ');
  }
  return '';
}

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const { activeTenant, memberships, branding, activeEnvironment, activeRole } = useTenant();
  const { user } = useUser();
  const { signOut } = useClerk();
  const switchTenant = useSwitchTenant();
  const qc = useQueryClient();

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
  const isDtdEnv = activeEnvironment?.kind === 'dtd';

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
  const canManageSettings = activeRole === 'owner' || activeRole === 'admin';

  return (
    <div className="min-h-[100dvh] bg-background">
      {/* DTD environment banner — full-width, subtle top strip */}
      {isDtdEnv && (
        <div
          data-testid="dtd-env-banner"
          className={`fixed left-0 right-0 top-0 z-50 flex items-center justify-center gap-2 border-b border-status-warning/25 bg-status-warning/10 py-1 text-center ${sidebarCollapsed ? 'md:pl-[78px]' : 'md:pl-[286px]'}`}
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
        aria-label="Primary navigation"
        className={`fixed inset-y-0 left-0 z-40 w-[286px] -translate-x-full border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width,transform] duration-200 md:translate-x-0 ${sidebarCollapsed ? 'md:w-[78px]' : 'md:w-[286px]'} ${mobileOpen ? 'translate-x-0' : ''} ${isDtdEnv ? 'top-[28px]' : ''}`}
      >
        <div className="flex h-full flex-col">
          {/* Brand / tenant header */}
          <div className={`flex h-[86px] items-center border-b border-sidebar-border ${sidebarCollapsed ? 'justify-center px-2' : 'justify-between px-5'}`}>
            <Link href="/overview" className={`flex min-w-0 items-center gap-3 ${sidebarCollapsed ? 'justify-center' : ''}`} data-testid="link-brand">
              <img
                src={getLogoUrl()}
                alt="Logo"
                className="h-9 w-9 rounded-lg object-contain bg-background"
              />
              <div className={`min-w-0 ${sidebarCollapsed ? 'hidden' : ''}`}>
                <span className="block truncate text-[15px] font-bold tracking-tight">
                  {activeTenant?.name || 'Construct Lifecycle'}
                </span>
                <span className="mono block text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/55">
                   From Bid to Closeout
                </span>
              </div>
            </Link>
            <button
              type="button"
              className="hidden rounded-lg p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:inline-flex"
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              onClick={() => setSidebarCollapsed((value) => !value)}
            >
              {sidebarCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
            </button>
            <button
              type="button"
              className="rounded-lg p-2 text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              aria-label="Close menu"
              onClick={() => setMobileOpen(false)}
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Environment switcher */}
            <EnvironmentSwitcher collapsed={sidebarCollapsed} />

            {/* Navigation */}
            <nav className={`space-y-4 pb-5 ${sidebarCollapsed ? 'px-2 pt-4' : 'px-4 pt-5'}`} aria-label="Primary navigation">
              {NAVIGATION_GROUPS.map((group) => (
                <div key={group.label}>
                  {!sidebarCollapsed && (
                    <p className="mb-2 px-3 mono text-[9px] font-bold uppercase tracking-[.18em] text-sidebar-foreground/45">
                      {group.label}
                    </p>
                  )}
                  <div className="space-y-0.5">
                    {group.items.map(({ href, label, icon: Icon, badge }) => {
                      const isActive = href === '/overview'
                        ? location === '/overview' || location.startsWith('/dashboard')
                        : location === href || location.startsWith(`${href}/`);
                      const link = (
                        <Link
                          key={href}
                          href={href}
                          onClick={() => setMobileOpen(false)}
                          data-testid={`link-nav-${label.toLowerCase().replace(/\s+/g, '-')}`}
                          aria-current={isActive ? 'page' : undefined}
                          className={`flex items-center gap-3 rounded-lg py-2 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                            sidebarCollapsed ? 'justify-center px-2' : 'px-3'
                          } ${
                            isActive
                              ? 'bg-sidebar-accent text-sidebar-foreground'
                              : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground'
                          }`}
                        >
                          <Icon size={17} className="shrink-0" />
                          <span className={sidebarCollapsed ? 'hidden' : 'min-w-0 flex-1 truncate'}>{label}</span>
                          {!sidebarCollapsed && badge && <OpenFollowUpDot />}
                        </Link>
                      );
                      return sidebarCollapsed ? (
                        <Tooltip key={href}>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right" className="bg-popover text-popover-foreground">{label}</TooltipContent>
                        </Tooltip>
                      ) : link;
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </div>

          {/* Workspace and user footer */}
          <div className={`border-t border-sidebar-border ${sidebarCollapsed ? 'p-2' : 'p-4'}`}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  data-testid="button-customer-switcher"
                  aria-label="Switch workspace"
                  className={`mb-2 flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-accent/35 py-2.5 text-left text-sidebar-foreground hover:bg-sidebar-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? 'justify-center px-2' : 'px-3'}`}
                >
                  <Building2 size={15} className="shrink-0 text-accent" />
                  {!sidebarCollapsed && <span className="min-w-0 flex-1 truncate text-xs font-semibold">{activeTenant?.name || 'Workspace'}</span>}
                  {!sidebarCollapsed && memberships.length > 1 && <ChevronDown size={13} className="shrink-0 opacity-60" />}
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" side="top" className="w-56">
                <DropdownMenuLabel>Switch workspace</DropdownMenuLabel>
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
                    {m.id === activeTenant?.id && <Check size={13} className="shrink-0 text-primary" />}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            <div className="flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    data-testid="button-user-menu"
                    aria-label="Open user menu"
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 hover:bg-sidebar-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${sidebarCollapsed ? 'justify-center' : ''}`}
                  >
                    <img
                      src={user?.imageUrl}
                      alt={user?.fullName || 'User'}
                      className="h-8 w-8 shrink-0 rounded-full bg-accent object-cover"
                    />
                    {!sidebarCollapsed && (
                      <span className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-xs font-semibold">{user?.fullName || 'User'}</span>
                        <span className="block truncate text-[10px] text-sidebar-foreground/50">{user?.primaryEmailAddress?.emailAddress}</span>
                      </span>
                    )}
                    {!sidebarCollapsed && <ChevronDown size={14} className="shrink-0 text-sidebar-foreground/50" />}
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" side="top" className="w-52">
                  <DropdownMenuLabel>{user?.fullName || 'User account'}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => signOut({ redirectUrl: basePath || '/' })}>
                    <LogOut size={14} /> Sign out
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {canManageSettings && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Link
                      href="/settings"
                      aria-label="Open settings"
                      data-testid="link-settings"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Settings size={16} />
                    </Link>
                  </TooltipTrigger>
                  <TooltipContent side="right" className="bg-popover text-popover-foreground">Settings</TooltipContent>
                </Tooltip>
              )}
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

      <main className={`min-h-[100dvh] ${sidebarCollapsed ? 'md:pl-[78px]' : 'md:pl-[286px]'} ${isDtdEnv ? 'pt-[28px]' : ''}`}>
        <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:px-9">
          <div className="flex items-center gap-3">
            <button
              data-testid="button-open-menu"
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg p-0 text-muted-foreground hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={19} />
            </button>
            <div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex">
              <span>{activeTenant?.name || 'Construct Lifecycle'}</span>
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
              className="relative rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
