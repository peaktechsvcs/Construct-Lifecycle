import { useMemo, useState } from 'react';
import { Link } from 'wouter';
import { CircleDollarSign, FileText, Search, WalletCards } from 'lucide-react';
import {
  getGetProjectControlsDashboardQueryKey,
  getListProjectsQueryKey,
  useGetProjectControlsDashboard,
  useListProjects,
  type BillingStatus,
  type Project,
} from '@workspace/api-client-react';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { Badge, EmptyState, ErrorPanel, LoadingPanel, PageTitle, StatCard, currency, shortDate } from '@/components/app-ui';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

type BillingFilter = 'all' | BillingStatus;

const billingLabels: Record<string, string> = {
  not_started: 'Not started',
  deposit_pending: 'Deposit pending',
  invoicing: 'Invoicing',
  partially_paid: 'Partially paid',
  paid: 'Paid',
};

function billingTone(status: string) {
  if (status === 'paid') return 'green' as const;
  if (status === 'partially_paid' || status === 'deposit_pending') return 'orange' as const;
  if (status === 'invoicing') return 'teal' as const;
  return 'neutral' as const;
}

function value(value: number | undefined) {
  return value === undefined ? '—' : currency.format(value);
}

function outstanding(project: Project) {
  return Math.max(0, project.invoicedAmount - project.receivedAmount);
}

function RevenueMobileCard({ project }: { project: Project }) {
  return (
    <article data-testid={`revenue-card-${project.id}`} className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {project.projectNumber}
          </Link>
          <p className="truncate text-sm font-semibold">{project.projectName}</p>
          <p className="truncate text-xs text-muted-foreground">{project.customerName}</p>
        </div>
        <Badge tone={billingTone(project.billingStatus)}>{billingLabels[project.billingStatus] ?? project.billingStatus.replaceAll('_', ' ')}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4">
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Contracted</p><p className="mono mt-1 text-sm font-semibold">{currency.format(project.contractValue)}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Invoiced</p><p className="mono mt-1 text-sm font-semibold">{currency.format(project.invoicedAmount)}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Received</p><p className="mono mt-1 text-sm font-semibold">{currency.format(project.receivedAmount)}</p></div>
        <div><p className="text-[10px] uppercase tracking-wide text-muted-foreground">Outstanding</p><p className="mono mt-1 text-sm font-semibold">{currency.format(outstanding(project))}</p></div>
      </div>
      <p className="mono mt-3 text-[10px] text-muted-foreground">Updated {shortDate(project.updatedAt)}</p>
    </article>
  );
}

export function Revenue() {
  useRouteMetadata(routeMetadata.revenue);
  const [search, setSearch] = useState('');
  const [billingFilter, setBillingFilter] = useState<BillingFilter>('all');
  const params = useMemo(() => ({ search: search.trim() || undefined }), [search]);
  const projectsQuery = useListProjects(params, { query: { queryKey: getListProjectsQueryKey(params), retry: false } });
  const controlsQuery = useGetProjectControlsDashboard({ query: { queryKey: getGetProjectControlsDashboardQueryKey(), retry: false, staleTime: 60000 } });
  const projects = projectsQuery.data ?? [];
  const visibleProjects = useMemo(
    () => projects.filter((project) => billingFilter === 'all' || project.billingStatus === billingFilter),
    [projects, billingFilter],
  );
  const totals = useMemo(() => projects.reduce(
    (result, project) => ({
      contracted: result.contracted + project.contractValue,
      invoiced: result.invoiced + project.invoicedAmount,
      received: result.received + project.receivedAmount,
    }),
    { contracted: 0, invoiced: 0, received: 0 },
  ), [projects]);
  const listFailed = projectsQuery.isError;
  const controlsFailed = controlsQuery.isError;
  const loaded = !projectsQuery.isLoading;

  return (
    <div className="animate-rise space-y-6">
      <PageTitle
        eyebrow="Financial workspace"
        title="Revenue"
        description="Track contracted, invoiced, and collected revenue across active work so project cash position is clear."
      />
      <p data-testid="revenue-basis-statement" className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">
        Basis: contracted, invoiced, and received values come from project records. Forecast context comes from Project Controls; this workspace is not an accounting ledger.
      </p>

      <section data-testid="revenue-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Contracted revenue" value={value(loaded ? totals.contracted : undefined)} detail={`${controlsQuery.data?.activeProjects ?? '—'} active projects`} icon={CircleDollarSign} accent="teal" />
        <StatCard label="Invoiced to date" value={value(loaded ? totals.invoiced : undefined)} detail={loaded ? `${value(totals.contracted - totals.invoiced)} not invoiced` : 'Project records loading'} icon={FileText} accent="violet" />
        <StatCard label="Received to date" value={value(loaded ? totals.received : undefined)} detail={loaded && totals.invoiced > 0 ? `${Math.round((totals.received / totals.invoiced) * 100)}% of invoiced` : 'No invoiced basis'} icon={WalletCards} accent="green" />
        <StatCard label="Forecast revenue" value={value(controlsQuery.data?.contractValue)} detail={controlsQuery.data ? `${value(controlsQuery.data.forecastMargin)} forecast margin` : 'Project controls unavailable'} icon={CircleDollarSign} accent="orange" />
      </section>

      {controlsFailed && <ErrorPanel title="Forecast context unavailable" text="Project controls could not be loaded. Project revenue records remain available below." onRetry={() => { void controlsQuery.refetch(); }} />}
      {listFailed ? (
        <ErrorPanel title="Revenue records unavailable" text="Project revenue records could not be loaded. Retry to restore the register." onRetry={() => { void projectsQuery.refetch(); }} />
      ) : (
        <section className="rounded-xl border border-border bg-card p-4 md:p-5">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Revenue register</p>
              <h2 className="mt-1 text-lg font-bold">Project cash position</h2>
            </div>
            <div className="flex flex-col gap-2 sm:flex-row">
              <label className="relative w-full sm:w-64">
                <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
                <Input data-testid="input-revenue-search" aria-label="Search revenue projects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project or customer" className="pl-9" />
              </label>
              <Select value={billingFilter} onValueChange={(next) => setBillingFilter(next as BillingFilter)}>
                <SelectTrigger data-testid="select-revenue-billing-status" className="w-full sm:w-48"><SelectValue placeholder="All billing statuses" /></SelectTrigger>
               <SelectContent className="bg-popover">
                  <SelectItem value="all">All billing statuses</SelectItem>
                  {Object.entries(billingLabels).map(([status, label]) => <SelectItem key={status} value={status}>{label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          {controlsFailed && <p role="status" className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">Register values are project-record totals; forecast context is currently partial.</p>}
          {!loaded ? <LoadingPanel lines={6} /> : visibleProjects.length === 0 ? (
            <div className="mt-4"><EmptyState icon={CircleDollarSign} title="No revenue projects match" text={projects.length ? 'Try a different billing status or search.' : 'Projects with contract, invoice, and received values will appear here.'} /></div>
          ) : (
            <>
              <div className="mt-4 space-y-3 md:hidden">{visibleProjects.map((project) => <RevenueMobileCard key={project.id} project={project} />)}</div>
              <div className="mt-4 hidden overflow-x-auto md:block">
                <table className="w-full min-w-[760px] text-left text-sm">
                   <thead><tr className="border-b border-border text-[10px] uppercase tracking-[.1em] text-muted-foreground"><th scope="col" className="px-3 py-3">Project</th><th scope="col" className="px-3 py-3">Customer</th><th scope="col" className="px-3 py-3">Billing</th><th scope="col" className="px-3 py-3 text-right">Contracted</th><th scope="col" className="px-3 py-3 text-right">Invoiced</th><th scope="col" className="px-3 py-3 text-right">Received</th><th scope="col" className="px-3 py-3 text-right">Outstanding</th><th scope="col" className="px-3 py-3 text-right">Updated</th></tr></thead>
                  <tbody>{visibleProjects.map((project) => <tr key={project.id} data-testid={`revenue-row-${project.id}`} className="border-b border-border/70 last:border-0 hover:bg-secondary/35">
                    <td className="px-3 py-3"><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{project.projectNumber}</Link><span className="mt-1 block max-w-52 truncate text-xs">{project.projectName}</span></td>
                    <td className="px-3 py-3 text-muted-foreground">{project.customerName}</td><td className="px-3 py-3"><Badge tone={billingTone(project.billingStatus)}>{billingLabels[project.billingStatus] ?? project.billingStatus.replaceAll('_', ' ')}</Badge></td>
                     <td className="mono px-3 py-3 text-right">{currency.format(project.contractValue)}</td><td className="mono px-3 py-3 text-right">{currency.format(project.invoicedAmount)}</td><td className="mono px-3 py-3 text-right font-semibold">{currency.format(project.receivedAmount)}</td><td className="mono px-3 py-3 text-right font-semibold">{currency.format(outstanding(project))}</td><td className="mono px-3 py-3 text-right text-xs text-muted-foreground">{shortDate(project.updatedAt)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}