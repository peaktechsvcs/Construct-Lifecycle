import { Building2, Cable, ShieldCheck, Paintbrush, Layers3 } from 'lucide-react';
import { Link, useLocation, Redirect } from 'wouter';
import { BrandingAdmin } from '@/pages/branding-admin';
import { IntegrationsAdmin } from '@/pages/integrations-admin';
import { OrganizationAccess } from '@/pages/organization-access';
import { LoadingPanel, PageTitle } from '@/components/app-ui';
import { useTenant } from '@/providers/tenant-provider';

type SettingsSection = 'profile' | 'branding' | 'integrations' | 'access';

const settingsSections: Array<{ key: SettingsSection; label: string; description: string; icon: typeof Building2 }> = [
  { key: 'profile', label: 'Organization Profile', description: 'Workspace identity and environment context', icon: Building2 },
  { key: 'branding', label: 'Branding', description: 'Theme, live preview, and publishing', icon: Paintbrush },
  { key: 'integrations', label: 'Integrations', description: 'Connected systems and activity', icon: Cable },
  { key: 'access', label: 'Access', description: 'Users, roles, and memberships', icon: ShieldCheck },
];

function OrganizationProfile() {
  const { activeTenant, activeEnvironment, activeRole, memberships } = useTenant();

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Settings / Organization Profile"
        title="Organization Profile"
        description="Review the active workspace identity, membership role, and environment context."
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Building2 size={16} /></span>
            <h2 className="text-base font-bold">Workspace profile</h2>
          </div>
          <dl className="space-y-4 text-sm">
            <div><dt className="text-xs font-semibold text-muted-foreground">Organization</dt><dd className="mt-1 font-semibold">{activeTenant?.name || 'Loading…'}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Workspace slug</dt><dd className="mt-1 font-mono text-xs">{activeTenant?.slug || '—'}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Workspace status</dt><dd className="mt-1 font-semibold capitalize">{activeTenant?.status || '—'}</dd></div>
          </dl>
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Layers3 size={16} /></span>
            <h2 className="text-base font-bold">Access and environment</h2>
          </div>
          <dl className="space-y-4 text-sm">
            <div><dt className="text-xs font-semibold text-muted-foreground">Your role</dt><dd className="mt-1 font-semibold capitalize">{activeRole || '—'}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Active environment</dt><dd className="mt-1 font-semibold">{activeEnvironment?.name || '—'}</dd></div>
            <div><dt className="text-xs font-semibold text-muted-foreground">Workspace memberships</dt><dd className="mt-1 font-semibold">{memberships.length}</dd></div>
          </dl>
        </section>
      </div>
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <ShieldCheck size={17} className="mt-0.5 shrink-0 text-primary" />
        <p className="leading-6 text-muted-foreground">Tenant configuration is restricted to workspace owners and administrators. Operational users continue to access customers, vendors, projects, and day-to-day work from the main navigation.</p>
      </div>
    </div>
  );
}

export function SettingsPage() {
  const [location] = useLocation();
  const { activeRole, isLoading } = useTenant();
  const requested = location.split('/')[2] as SettingsSection | undefined;
  const section: SettingsSection = settingsSections.some((item) => item.key === requested) ? requested! : 'profile';
  const canManageSettings = activeRole === 'owner' || activeRole === 'admin';

  if (isLoading) return <LoadingPanel lines={6} />;
  if (!canManageSettings) return <Redirect to="/overview" />;

  const content = section === 'profile'
    ? <OrganizationProfile />
    : section === 'branding'
      ? <BrandingAdmin />
      : section === 'integrations'
        ? <IntegrationsAdmin />
        : <OrganizationAccess />;

  return (
    <div className="animate-rise">
      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-border bg-card p-2" aria-label="Settings navigation">
          <nav className="space-y-1">
            {settingsSections.map(({ key, label, description, icon: Icon }) => {
              const href = key === 'profile' ? '/settings' : `/settings/${key}`;
              const isActive = section === key;
              return (
                <Link
                  key={key}
                  href={href}
                  aria-current={isActive ? 'page' : undefined}
                  className={`flex items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary'}`}
                >
                  <Icon size={17} className="mt-0.5 shrink-0" />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className={`mt-0.5 block text-[11px] leading-4 ${isActive ? 'text-primary/75' : 'text-muted-foreground'}`}>{description}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
          <div className="mt-2 border-t border-border px-3 py-3">
            <p className="text-[11px] leading-4 text-muted-foreground">Settings are visible to administrators and owners only.</p>
          </div>
        </aside>
        <section className="min-w-0">{content}</section>
      </div>
    </div>
  );
}