import { Building2, Cable, ShieldCheck, Paintbrush, Layers3, Users, KeyRound, CreditCard } from 'lucide-react';
import { Link, useLocation, Redirect } from 'wouter';
import { BrandingAdmin } from '@/pages/branding-admin';
import { IntegrationsAdmin } from '@/pages/integrations-admin';
import { OrganizationAccess } from '@/pages/organization-access';
import { EmptyState, LoadingPanel, PageTitle } from '@/components/app-ui';
import { useTenant } from '@/providers/tenant-provider';
import { BillingAdmin } from '@/pages/billing';
import { WorkflowsAdmin } from '@/pages/workflows';
import { getListFeatureFlagsQueryKey, useListFeatureFlags } from '@workspace/api-client-react';

type SettingsSection = 'profile' | 'branding' | 'integrations' | 'billing' | 'administration';
type AdministrationSection = 'users' | 'roles' | 'access' | 'workflows';

const settingsSections: Array<{ key: SettingsSection; label: string; description: string; icon: typeof Building2 }> = [
  { key: 'profile', label: 'Organization Profile', description: 'Workspace identity and environment context', icon: Building2 },
  { key: 'branding', label: 'Branding', description: 'Theme, live preview, and publishing', icon: Paintbrush },
  { key: 'integrations', label: 'Integrations', description: 'Connected systems and activity', icon: Cable },
  { key: 'billing', label: 'Subscription & Billing', description: 'Plans, payment, and invoices', icon: CreditCard },
  { key: 'administration', label: 'Administration', description: 'Users, roles, and access', icon: ShieldCheck },
];

const administrationSections: Array<{ key: AdministrationSection; label: string; description: string; icon: typeof Users }> = [
  { key: 'users', label: 'Users', description: 'Manage workspace members and invitations', icon: Users },
  { key: 'roles', label: 'Roles', description: 'Define what each workspace role can do', icon: KeyRound },
  { key: 'access', label: 'Access & Memberships', description: 'Review membership access and assignments', icon: ShieldCheck },
  { key: 'workflows', label: 'Lifecycle & Workflows', description: 'Configure project states, statuses, and transitions', icon: Layers3 },
];

function AdministrationSettings() {
  const [location] = useLocation();
  const { isPlatformAdmin } = useTenant();
  const featureFlagsQuery = useListFeatureFlags({
    query: { queryKey: getListFeatureFlagsQueryKey(), staleTime: 30000, retry: false },
  });
  const requested = location.split('/')[3] as AdministrationSection | undefined;
  const rolesEnabled = featureFlagsQuery.data?.some((feature) => feature.key === 'roles') ?? false;
  const visibleSections = isPlatformAdmin
    ? administrationSections.filter((item) => item.key === 'workflows')
    : administrationSections.filter((item) => item.key !== 'roles' || rolesEnabled);
  const section: AdministrationSection = visibleSections.some((item) => item.key === requested)
    ? requested!
    : isPlatformAdmin ? 'workflows' : 'users';

  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Settings / Administration" title="Administration" description="Manage workspace users, roles, and access memberships." />
      <nav className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-2" aria-label="Administration navigation">
        {visibleSections.map(({ key, label, description, icon: Icon }) => (
          <Link
            key={key}
            href={`/settings/administration/${key}`}
            aria-current={section === key ? 'page' : undefined}
            className={`flex min-w-[170px] flex-1 items-start gap-3 rounded-lg px-3 py-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${section === key ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-secondary'}`}
          >
            <Icon size={17} className="mt-0.5 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm font-semibold">{label}</span>
              <span className={`mt-0.5 block text-[11px] leading-4 ${section === key ? 'text-primary/75' : 'text-muted-foreground'}`}>{description}</span>
            </span>
          </Link>
        ))}
      </nav>
      <div className="mt-6">
        {section === 'workflows' ? (
          <WorkflowsAdmin />
        ) : section === 'roles' ? (
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-5 flex items-center gap-3 border-b border-border pb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><KeyRound size={16} /></span>
              <h2 className="text-base font-bold">Roles</h2>
            </div>
            <EmptyState icon={KeyRound} title="Role controls are coming soon" text="Workspace role assignments are available from Users today. Dedicated role policies will be added here." />
          </section>
        ) : (
          <OrganizationAccess
            title={section === 'users' ? 'Users' : 'Access & Memberships'}
            description={section === 'users' ? 'Manage workspace members, invitations, and role assignments.' : 'Review workspace members and manage their access.'}
            showPageTitle={false}
          />
        )}
      </div>
    </div>
  );
}

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
  const { activeRole, isPlatformAdmin, isLoading } = useTenant();
  const requested = location.split('/')[2] as SettingsSection | undefined;
  const section: SettingsSection = settingsSections.some((item) => item.key === requested) ? requested! : 'profile';
  const canManageSettings = activeRole === 'owner' || activeRole === 'admin' || isPlatformAdmin;

  if (isLoading) return <LoadingPanel lines={6} />;
  if (!canManageSettings) return <Redirect to="/overview" />;
  if (isPlatformAdmin && section !== 'administration') return <Redirect to="/administration/platform/customers" />;

  const content = section === 'profile'
    ? <OrganizationProfile />
    : section === 'branding'
      ? <BrandingAdmin />
      : section === 'integrations'
        ? <IntegrationsAdmin />
      : section === 'billing'
        ? <BillingAdmin />
        : <AdministrationSettings />;

  return (
    <div className="animate-rise">
      <div className="grid gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="h-fit rounded-xl border border-border bg-card p-2" aria-label="Settings navigation">
          <nav className="space-y-1">
            {settingsSections.filter((item) => !isPlatformAdmin || item.key === 'administration').map(({ key, label, description, icon: Icon }) => {
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