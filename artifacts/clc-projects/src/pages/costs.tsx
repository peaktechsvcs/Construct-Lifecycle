import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CircleDollarSign, FileCheck2, Pencil, Search, ShieldCheck, TrendingDown } from 'lucide-react';
import {
  type Project,
  type ProjectControlsSummary,
  type ProjectFinancials,
  type ProjectFinancialsInput,
  getGetProjectControlsQueryKey,
  getGetProjectControlsQueryOptions,
  getListProjectsQueryKey,
  useListProjects,
  useUpdateProjectFinancials,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, StatCard, currency } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

type Health = 'all' | 'on_plan' | 'committed_over' | 'forecast_over' | 'no_budget';
type CostRow = { project: Project; controls: ProjectControlsSummary };

const healthLabel: Record<Exclude<Health, 'all'>, string> = {
  on_plan: 'On plan',
  committed_over: 'Committed over budget',
  forecast_over: 'Forecast over budget',
  no_budget: 'No budget',
};

function getHealth(controls: ProjectControlsSummary): Exclude<Health, 'all'> {
  const budget = controls.financials?.budgetCost ?? 0;
  if (budget <= 0) return 'no_budget';
  if (controls.metrics.committedCost > budget) return 'committed_over';
  if (controls.financials && controls.financials.forecastCost > budget) return 'forecast_over';
  return 'on_plan';
}

function healthTone(health: Exclude<Health, 'all'>) {
  if (health === 'on_plan') return 'green' as const;
  if (health === 'no_budget') return 'neutral' as const;
  return 'orange' as const;
}

function amount(value: number | undefined, absent = false) {
  return absent || value === undefined ? 'Not recorded' : currency.format(value);
}

function CostEditor({ row, onClose, onSaved }: { row: CostRow; onClose: () => void; onSaved: (financials: ProjectFinancials) => void }) {
  const mutation = useUpdateProjectFinancials();
  const current = row.controls.financials;
  const [form, setForm] = useState({
    budgetCost: current ? String(current.budgetCost) : '',
    forecastCost: current ? String(current.forecastCost) : '',
    actualCost: current ? String(current.actualCost) : '',
    asOfDate: current?.asOfDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
  });
  const set = (key: keyof typeof form, value: string) => setForm((previous) => ({ ...previous, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data: ProjectFinancialsInput = {
      budgetCost: Number(form.budgetCost) || 0,
      forecastCost: Number(form.forecastCost) || 0,
      actualCost: Number(form.actualCost) || 0,
      forecastRevenue: current?.forecastRevenue ?? row.controls.metrics.contractValue,
      asOfDate: form.asOfDate || undefined,
    };
    mutation.mutate({ projectId: row.project.id, data }, { onSuccess: onSaved });
  };
  const field = (key: keyof typeof form, label: string, type: 'number' | 'date' = 'number') => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <Input data-testid={`input-cost-${key}`} type={type} min={type === 'number' ? '0' : undefined} step={type === 'number' ? '0.01' : undefined} value={form[key]} onChange={(event) => set(key, event.target.value)} required={key !== 'actualCost'} />
    </label>
  );
  return (
    <Modal title={`Edit costs · ${row.project.projectNumber}`} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4" data-testid="cost-editor">
        <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">{row.project.projectName} · {row.project.customerName}</p>
        <div className="grid gap-4 sm:grid-cols-2">
          {field('budgetCost', 'Budget cost')}
          {field('forecastCost', 'Forecast cost')}
          {field('actualCost', 'Actual cost')}
          {field('asOfDate', 'As-of date', 'date')}
        </div>
        <p className="text-xs text-muted-foreground">Forecast revenue is preserved from the existing financial snapshot or project controls metrics.</p>
        {mutation.isError && <p role="alert" className="text-xs text-destructive">Costs could not be saved. Check the values and try again.</p>}
        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button data-testid="button-save-costs" type="submit" disabled={mutation.isPending}>{mutation.isPending ? 'Saving…' : 'Save costs'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function CostCard({ row, canEdit, onEdit }: { row: CostRow; canEdit: boolean; onEdit: () => void }) {
  const { project, controls } = row;
  const financials = controls.financials;
  const health = getHealth(controls);
  return (
    <article data-testid={`cost-card-${project.id}`} className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link>
          <p className="truncate text-sm font-semibold">{project.projectName}</p>
          <p className="truncate text-xs text-muted-foreground">{project.customerName}</p>
        </div>
        <Badge tone={healthTone(health)}>{healthLabel[health]}</Badge>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3">
        <div><p className="text-[10px] uppercase text-muted-foreground">Budget</p><p className="mono text-sm font-semibold">{amount(financials?.budgetCost, !financials)}</p></div>
        <div><p className="text-[10px] uppercase text-muted-foreground">Committed</p><p className="mono text-sm font-semibold">{currency.format(controls.metrics.committedCost)}</p></div>
        <div><p className="text-[10px] uppercase text-muted-foreground">Forecast</p><p className="mono text-sm font-semibold">{amount(financials?.forecastCost, !financials)}</p></div>
        <div><p className="text-[10px] uppercase text-muted-foreground">Actual</p><p className="mono text-sm font-semibold">{amount(financials?.actualCost, !financials)}</p></div>
        <div className="col-span-2"><p className="text-[10px] uppercase text-muted-foreground">Variance to budget</p><p className="mono text-sm font-semibold">{financials ? currency.format(financials.budgetCost - financials.forecastCost) : 'No snapshot — variance unavailable'}</p></div>
      </div>
      {canEdit && <div className="mt-3 flex justify-end"><Button variant="ghost" className="p-2" onClick={onEdit} aria-label={`Edit costs for ${project.projectNumber}`}><Pencil size={15} /></Button></div>}
    </article>
  );
}

export function Costs() {
  useRouteMetadata(routeMetadata.costs);
  const { activeRole, isPlatformAdmin } = useTenant();
  const canEdit = isPlatformAdmin || activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState<Health>('all');
  const [editing, setEditing] = useState<CostRow>();
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 30000 } });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const controlsQueries = useQueries({ queries: projects.map((project) => getGetProjectControlsQueryOptions(project.id, { query: { queryKey: getGetProjectControlsQueryKey(project.id), staleTime: 30000 } })) });
  const rows = useMemo(() => projects.flatMap((project, index) => {
    const controls = controlsQueries[index]?.data;
    return controls ? [{ project, controls }] : [];
  }).filter((row) => {
    const needle = search.trim().toLowerCase();
    const text = `${row.project.projectNumber} ${row.project.projectName} ${row.project.customerName}`.toLowerCase();
    return (!needle || text.includes(needle)) && (healthFilter === 'all' || getHealth(row.controls) === healthFilter);
  }), [controlsQueries, healthFilter, projects, search]);
  const allRows = useMemo(() => projects.flatMap((project, index) => controlsQueries[index]?.data ? [{ project, controls: controlsQueries[index].data as ProjectControlsSummary }] : []), [controlsQueries, projects]);
  const totals = useMemo(() => allRows.reduce((sum, row) => ({
    budget: sum.budget + (row.controls.financials?.budgetCost ?? 0),
    committed: sum.committed + row.controls.metrics.committedCost,
    forecast: sum.forecast + (row.controls.financials?.forecastCost ?? 0),
    actual: sum.actual + (row.controls.financials?.actualCost ?? 0),
    snapshots: sum.snapshots + (row.controls.financials ? 1 : 0),
  }), { budget: 0, committed: 0, forecast: 0, actual: 0, snapshots: 0 }), [allRows]);
  const loading = controlsQueries.some((query) => query.isLoading);
  const controlsError = controlsQueries.some((query) => query.isError);
  const saved = (financials: ProjectFinancials) => {
    queryClient.setQueryData<ProjectControlsSummary | undefined>(getGetProjectControlsQueryKey(financials.projectId), (current) => current ? { ...current, financials } : current);
    void queryClient.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(financials.projectId) });
    setEditing(undefined);
  };
  return (
    <div className="animate-rise space-y-6">
      <div data-testid="costs-heading"><PageTitle eyebrow="Financial workspace" title="Costs" description="Compare planned, committed, forecast, and recorded project costs across the active workspace." /></div>
      <p data-testid="costs-basis-statement" className="rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-muted-foreground">Basis: committed cost comes from Project Controls metrics. Budget, forecast, actual, and variance use financial snapshots; projects without a snapshot are labeled rather than treated as zero.</p>
      <section data-testid="costs-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Budget cost" value={loading ? '—' : currency.format(totals.budget)} detail={`${totals.snapshots} financial snapshots`} icon={CircleDollarSign} accent="teal" />
        <StatCard label="Committed cost" value={loading ? '—' : currency.format(totals.committed)} detail="Project Controls commitments" icon={FileCheck2} accent="violet" />
        <StatCard label="Forecast cost" value={loading ? '—' : currency.format(totals.forecast)} detail="Snapshot forecast basis" icon={TrendingDown} accent="orange" />
        <StatCard label="Actual cost" value={loading ? '—' : totals.snapshots ? currency.format(totals.actual) : 'Not recorded'} detail={totals.snapshots ? 'Recorded snapshots' : 'No financial snapshots'} icon={CircleDollarSign} accent="green" />
        <StatCard label="Variance to budget" value={loading ? '—' : totals.snapshots ? currency.format(totals.budget - totals.forecast) : 'Unavailable'} detail="Budget minus forecast" icon={AlertTriangle} accent="orange" />
      </section>
      <section className="rounded-xl border border-border bg-card p-3">
        <div className="flex flex-col gap-3 md:flex-row">
          <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input data-testid="input-costs-search" aria-label="Search costs" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, customer, or number" className="pl-9" /></label>
          <Select value={healthFilter} onValueChange={(value) => setHealthFilter(value as Health)}><SelectTrigger data-testid="select-cost-health" className="md:w-56"><SelectValue placeholder="All cost health" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All cost health</SelectItem><SelectItem value="on_plan">On plan</SelectItem><SelectItem value="committed_over">Committed over budget</SelectItem><SelectItem value="forecast_over">Forecast over budget</SelectItem><SelectItem value="no_budget">No budget</SelectItem></SelectContent></Select>
          {(search || healthFilter !== 'all') && <Button variant="ghost" onClick={() => { setSearch(''); setHealthFilter('all'); }}>Clear</Button>}
        </div>
      </section>
      {projectsQuery.isLoading ? <LoadingPanel lines={7} /> : projectsQuery.isError ? <ErrorPanel title="Projects unavailable" text="Costs could not load the project register." onRetry={() => { void projectsQuery.refetch(); }} /> : !projects.length ? <EmptyState icon={ShieldCheck} title="No projects available" text="Create a project before tracking costs." /> : controlsError ? <ErrorPanel title="Project controls unavailable" text="Cost snapshots could not be loaded for every project." onRetry={() => controlsQueries.forEach((query) => { void query.refetch(); })} /> : loading ? <LoadingPanel lines={7} /> : !rows.length ? <EmptyState icon={Search} title={allRows.length ? 'No costs match' : 'No cost snapshots yet'} text={allRows.length ? 'Try a different search or health filter.' : 'Add a financial snapshot from a project or use the editor when available.'} /> : <>
        <div className="space-y-3 md:hidden">{rows.map((row) => <CostCard key={row.project.id} row={row} canEdit={canEdit} onEdit={() => setEditing(row)} />)}</div>
        <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block"><table className="w-full min-w-[1060px] text-left text-sm"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Project</th><th className="px-4 py-3">Health</th><th className="px-4 py-3 text-right">Budget</th><th className="px-4 py-3 text-right">Committed</th><th className="px-4 py-3 text-right">Forecast</th><th className="px-4 py-3 text-right">Actual</th><th className="px-4 py-3 text-right">Variance</th><th /></tr></thead><tbody>{rows.map((row) => { const financials = row.controls.financials; const health = getHealth(row.controls); return <tr key={row.project.id} data-testid={`cost-row-${row.project.id}`} className="border-b border-border/70 last:border-0 hover:bg-secondary/35"><td className="px-4 py-3"><Link href={`/projects/${row.project.id}`} className="font-bold text-primary hover:underline">{row.project.projectNumber}</Link><span className="block max-w-52 truncate text-xs">{row.project.projectName}</span><span className="block text-xs text-muted-foreground">{row.project.customerName}</span></td><td className="px-4 py-3"><Badge tone={healthTone(health)}>{healthLabel[health]}</Badge></td><td className="mono px-4 py-3 text-right">{amount(financials?.budgetCost, !financials)}</td><td className="mono px-4 py-3 text-right">{currency.format(row.controls.metrics.committedCost)}</td><td className="mono px-4 py-3 text-right">{amount(financials?.forecastCost, !financials)}</td><td className="mono px-4 py-3 text-right">{amount(financials?.actualCost, !financials)}</td><td className="mono px-4 py-3 text-right font-semibold">{financials ? currency.format(financials.budgetCost - financials.forecastCost) : 'Unavailable'}</td><td className="px-4 py-3 text-right">{canEdit && <Button variant="ghost" className="p-2" onClick={() => setEditing(row)} aria-label={`Edit costs for ${row.project.projectNumber}`}><Pencil size={15} /></Button>}</td></tr>; })}</tbody></table></div>
      </>}
      {editing && <CostEditor row={editing} onClose={() => setEditing(undefined)} onSaved={saved} />}
    </div>
  );
}

export default Costs;