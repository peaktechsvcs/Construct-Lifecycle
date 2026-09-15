import { ArrowLeft, Clock3, Construction } from 'lucide-react';
import { Link, Redirect, useParams } from 'wouter';
import { Button, LoadingPanel } from '@/components/app-ui';
import { useTenant } from '@/providers/tenant-provider';
import { getListFeatureFlagsQueryKey, useListFeatureFlags } from '@workspace/api-client-react';
import { canAccessComingSoonFeature } from '@/lib/feature-visibility';
import { comingSoonMetadata, useRouteMetadata } from '@/lib/route-titles';

const destinations: Record<string, { section: string; description: string }> = {
  notifications: { section: 'Home', description: 'See alerts, mentions, approvals, and changes that need your attention.' },
  opportunities: { section: 'Pipeline', description: 'Capture and qualify new construction opportunities before they become bids.' },
  bids: { section: 'Pipeline', description: 'Organize bid invitations, deadlines, scope, and submission status.' },
  estimates: { section: 'Pipeline', description: 'Build and compare project estimates with the assumptions behind every number.' },
  proposals: { section: 'Pipeline', description: 'Prepare, send, and track proposals from first draft through decision.' },
  'active-projects': { section: 'Projects', description: 'Focus the team on projects currently moving through execution.' },
  contracts: { section: 'Projects', description: 'Manage contract records, commitments, dates, and executed documents.' },
  milestones: { section: 'Projects', description: 'Track the dates and decisions that keep every project on plan.' },
  products: { section: 'Operations', description: 'Maintain the products, materials, and assemblies used across projects.' },
  selections: { section: 'Operations', description: 'Collect, approve, and coordinate customer and design selections.' },
  procurement: { section: 'Operations', description: 'Plan purchasing activity against project scope, timing, and availability.' },
  'purchase-orders': { section: 'Operations', description: 'Create and track purchase orders from release through confirmation.' },
  deliveries: { section: 'Operations', description: 'Coordinate delivery dates, shipments, and jobsite readiness.' },
  receiving: { section: 'Operations', description: 'Record what arrived, what is missing, and what needs resolution.' },
  revenue: { section: 'Financial', description: 'Understand expected and realized revenue across the lifecycle.' },
  commitments: { section: 'Financial', description: 'Track committed spend and obligations before they become costs.' },
  costs: { section: 'Financial', description: 'Capture project costs and compare actuals with the plan.' },
  billing: { section: 'Financial', description: 'Manage invoices, draws, collections, and billing status.' },
  'change-orders': { section: 'Financial', description: 'Control scope, price, and schedule changes with a clear approval trail.' },
  margin: { section: 'Financial', description: 'See project margin as scope, cost, and billing change.' },
  'open-items': { section: 'Closeout', description: 'Resolve punch-list items and open responsibilities before completion.' },
  documentation: { section: 'Closeout', description: 'Collect closeout documents, warranties, and final records.' },
  'final-billing': { section: 'Closeout', description: 'Complete final billing and confirm the financial handoff.' },
  'closed-projects': { section: 'Closeout', description: 'Review completed projects and the history behind the work.' },
  dashboards: { section: 'Insights', description: 'Assemble role-specific views of performance and work in motion.' },
  reports: { section: 'Insights', description: 'Generate operational and financial reports for the business.' },
  analytics: { section: 'Insights', description: 'Explore trends across projects, customers, operations, and finance.' },
  'construct-intelligence': { section: 'Insights', description: 'Surface patterns and recommendations from the full lifecycle record.' },
  users: { section: 'Administration', description: 'Invite teammates and manage access to the customer workspace.' },
  roles: { section: 'Administration', description: 'Define what each workspace role can view and change.' },
  vendors: { section: 'Administration', description: 'Maintain vendor relationships, contacts, and performance history.' },
  settings: { section: 'Administration', description: 'Configure workspace preferences and operational defaults.' },
};

export function ComingSoonPage() {
  const { item = '' } = useParams<{ item: string }>();
  const title = item
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  useRouteMetadata(comingSoonMetadata(title));
  const { isPlatformAdmin } = useTenant();
  const featureFlagsQuery = useListFeatureFlags({
    query: {
      queryKey: getListFeatureFlagsQueryKey(),
      staleTime: 30000,
      retry: false,
    },
  });
  const isVisible = canAccessComingSoonFeature(item, featureFlagsQuery.data, isPlatformAdmin);

  if (featureFlagsQuery.isLoading) return <LoadingPanel lines={5} />;
  if (!isVisible) return <Redirect to="/overview" />;

  const destination = destinations[item];
  if (!destination) return <Redirect to="/overview" />;
  return (
    <div className="mx-auto flex min-h-[60dvh] max-w-2xl items-center justify-center py-12">
      <section className="w-full rounded-2xl border border-border bg-card p-7 text-center shadow-sm md:p-12">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
          <Construction size={26} />
        </span>
        <p className="mono mt-6 text-[10px] uppercase tracking-[.18em] text-accent">{destination.section}</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">{title}</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">{destination.description}</p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <span className="inline-flex items-center gap-2 rounded-lg border border-border bg-secondary/60 px-3.5 py-2 text-xs font-semibold text-muted-foreground">
            <Clock3 size={14} /> Coming soon
          </span>
          <Link href="/overview" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground shadow-sm hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ArrowLeft size={15} /> Back to Dashboard
          </Link>
        </div>
      </section>
    </div>
  );
}