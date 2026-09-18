import { useMemo, useState, type FormEvent } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { CalendarDays, CircleDollarSign, FileCheck2, Pencil, Plus, ReceiptText, Search } from 'lucide-react';
import {
  type Project,
  type ProjectControlsSummary,
  type ProjectPayApplication,
  type ProjectPayApplicationInput,
  type ProjectPayApplicationUpdate,
  getGetProjectControlsQueryKey,
  getGetProjectControlsQueryOptions,
  getListProjectsQueryKey,
  useCreateProjectPayApplication,
  useListProjects,
  useUpdateProjectPayApplication,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, StatCard, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

const statuses = ['draft', 'submitted', 'approved', 'paid', 'rejected'] as const;
type FormState = { applicationNumber: string; periodStart: string; periodEnd: string; grossAmount: string; retainageAmount: string; status: string; notes: string };
const emptyForm: FormState = { applicationNumber: '', periodStart: '', periodEnd: '', grossAmount: '', retainageAmount: '0', status: 'draft', notes: '' };
const humanize = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const tone = (value: string) => value === 'paid' || value === 'approved' ? 'green' as const : value === 'rejected' ? 'red' as const : value === 'submitted' ? 'orange' as const : 'teal' as const;

function PayApplicationForm({ projects, project, item, onClose, onSaved }: { projects: Project[]; project?: Project; item?: ProjectPayApplication; onClose: () => void; onSaved: (value: ProjectPayApplication) => void }) {
  const [form, setForm] = useState<FormState>(() => item ? { applicationNumber: item.applicationNumber, periodStart: item.periodStart?.slice(0, 10) ?? '', periodEnd: item.periodEnd?.slice(0, 10) ?? '', grossAmount: String(item.grossAmount), retainageAmount: String(item.retainageAmount), status: item.status, notes: item.notes ?? '' } : emptyForm);
  const [projectId, setProjectId] = useState(String(project?.id ?? projects[0]?.id ?? ''));
  const create = useCreateProjectPayApplication();
  const update = useUpdateProjectPayApplication();
  const selected = projects.find((candidate) => candidate.id === Number(projectId)) ?? project;
  const pending = create.isPending || update.isPending;
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !form.applicationNumber.trim() || !form.grossAmount) return;
    if (item) {
      const data: ProjectPayApplicationUpdate = { periodStart: form.periodStart || null, periodEnd: form.periodEnd || null, grossAmount: Number(form.grossAmount) || 0, retainageAmount: Number(form.retainageAmount) || 0, status: form.status as ProjectPayApplicationUpdate['status'], notes: form.notes.trim() || null };
      update.mutate({ projectId: selected.id, applicationId: item.id, data }, { onSuccess: onSaved });
    } else {
      const data: ProjectPayApplicationInput = { applicationNumber: form.applicationNumber.trim(), periodStart: form.periodStart || undefined, periodEnd: form.periodEnd || undefined, grossAmount: Number(form.grossAmount) || 0, retainageAmount: Number(form.retainageAmount) || 0, status: form.status as ProjectPayApplicationInput['status'], notes: form.notes.trim() || undefined };
      create.mutate({ projectId: selected.id, data }, { onSuccess: onSaved });
    }
  };
  const field = (key: keyof FormState, label: string, type = 'text', required = false) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span><Input data-testid={`input-final-billing-${key}`} type={type} required={required} readOnly={item && key === 'applicationNumber'} value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>;
  return <Modal title={item ? `Edit ${item.applicationNumber}` : 'New owner pay application'} onClose={onClose}>
    <form data-testid="final-billing-editor" onSubmit={submit} className="space-y-4">
      {!item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Project</span><Select value={projectId} onValueChange={setProjectId}><SelectTrigger data-testid="select-final-billing-project"><SelectValue placeholder="Select a project" /></SelectTrigger><SelectContent className="bg-popover">{projects.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.projectNumber} · {candidate.projectName}</SelectItem>)}</SelectContent></Select></label>}
      {selected && <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">{selected.projectNumber} · {selected.projectName} · {selected.customerName}</p>}
      {field('applicationNumber', 'Application number', 'text', true)}
      <div className="grid gap-4 sm:grid-cols-2">{field('periodStart', 'Period start', 'date')}{field('periodEnd', 'Period end', 'date')}{field('grossAmount', 'Gross amount', 'number', true)}{field('retainageAmount', 'Retainage amount', 'number')}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Status</span><Select value={form.status} onValueChange={(value) => set('status', value)}><SelectTrigger data-testid="select-final-billing-status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{statuses.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></label></div>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Notes</span><Textarea data-testid="textarea-final-billing-notes" rows={4} value={form.notes} onChange={(event) => set('notes', event.target.value)} /></label>
      {(create.error || update.error) && <p role="alert" className="text-xs text-destructive">The pay application could not be saved. Check the fields and try again.</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-save-final-billing" type="submit" disabled={pending || !selected || !form.applicationNumber.trim() || !form.grossAmount}>{pending ? 'Saving…' : item ? 'Save changes' : 'Create application'}</Button></div>
    </form>
  </Modal>;
}

function ApplicationCard({ project, item, canManage, onEdit }: { project: Project; item: ProjectPayApplication; canManage: boolean; onEdit: () => void }) {
  return <article data-testid={`final-billing-card-${item.id}`} className="rounded-lg border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link><p className="text-sm font-semibold">{item.applicationNumber}</p><p className="text-xs text-muted-foreground">{project.customerName} · {project.projectName}</p></div><Badge tone={tone(item.status)}>{humanize(item.status)}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3"><div><p className="text-[10px] uppercase text-muted-foreground">Period</p><p className="text-sm">{shortDate(item.periodStart)} — {shortDate(item.periodEnd)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Gross / net</p><p className="mono text-sm">{currency.format(item.grossAmount)} / {currency.format(item.netAmount)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Retainage</p><p className="mono text-sm">{currency.format(item.retainageAmount)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Notes</p><p className="truncate text-sm">{item.notes || '—'}</p></div></div>{canManage && <div className="mt-3 flex justify-end"><Button variant="ghost" className="p-2" onClick={onEdit} aria-label={`Edit ${item.applicationNumber}`}><Pencil size={15} /></Button></div>}</article>;
}

export function FinalBilling() {
  useRouteMetadata(routeMetadata.finalBilling);
  const { activeRole, isPlatformAdmin } = useTenant();
  const canManage = isPlatformAdmin || activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState<{ project?: Project; item?: ProjectPayApplication }>();
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 30000 } });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const controlsQueries = useQueries({ queries: projects.map((project) => getGetProjectControlsQueryOptions(project.id, { query: { queryKey: getGetProjectControlsQueryKey(project.id), staleTime: 30000 } })) });
  const allItems = useMemo(() => projects.flatMap((project, index) => (controlsQueries[index]?.data?.payApplications ?? []).map((item) => ({ project, item }))), [controlsQueries, projects]);
  const rows = useMemo(() => allItems.filter(({ project, item }) => { const text = [project.projectNumber, project.projectName, project.customerName, item.applicationNumber, item.notes ?? ''].join(' ').toLowerCase(); const needle = search.trim().toLowerCase(); return (!needle || text.includes(needle)) && (!statusFilter || item.status === statusFilter); }), [allItems, search, statusFilter]);
  const totals = useMemo(() => allItems.reduce((sum, { item }) => ({ gross: sum.gross + item.grossAmount, net: sum.net + item.netAmount, retainage: sum.retainage + item.retainageAmount, paid: sum.paid + (item.status === 'paid' ? 1 : 0), queue: sum.queue + (item.status === 'submitted' ? 1 : 0) }), { gross: 0, net: 0, retainage: 0, paid: 0, queue: 0 }), [allItems]);
  const loading = controlsQueries.some((query) => query.isLoading);
  const controlsError = controlsQueries.some((query) => query.isError);
  const saved = (value: ProjectPayApplication) => { queryClient.setQueryData<ProjectControlsSummary | undefined>(getGetProjectControlsQueryKey(value.projectId), (current) => current ? { ...current, payApplications: current.payApplications.some((item) => item.id === value.id) ? current.payApplications.map((item) => item.id === value.id ? value : item) : [...current.payApplications, value] } : current); void queryClient.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(value.projectId) }); setForm(undefined); };
  return <div className="animate-rise space-y-6">
    <PageTitle eyebrow="Closeout workspace" title="Final Billing" description="Owner pay-application register for project closeout across this tenant and environment." action={canManage ? <Button data-testid="button-new-final-billing" onClick={() => setForm({})} disabled={!projects.length}><Plus size={16} /> New application</Button> : undefined} />
    <p className="text-xs text-muted-foreground">Basis: owner pay applications recorded against project controls. Gross, net, and retainage values are register totals, not subscription billing.</p>
    <section data-testid="final-billing-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6"><StatCard label="Gross billed" value={loading ? '—' : currency.format(totals.gross)} detail={`${allItems.length} applications`} icon={CircleDollarSign} accent="teal" /><StatCard label="Net billed" value={loading ? '—' : currency.format(totals.net)} detail="After retainage" icon={ReceiptText} accent="green" /><StatCard label="Retainage held" value={loading ? '—' : currency.format(totals.retainage)} detail="Held from gross" icon={CircleDollarSign} accent="orange" /><StatCard label="Paid applications" value={loading ? '—' : String(totals.paid)} detail="Status is paid" icon={FileCheck2} accent="green" /><StatCard label="Review queue" value={loading ? '—' : String(totals.queue)} detail="Submitted for review" icon={CalendarDays} accent="orange" /><StatCard label="Projects with applications" value={loading ? '—' : String(new Set(allItems.map(({ project }) => project.id)).size)} detail={`of ${projects.length} projects`} icon={FileCheck2} accent="violet" /></section>
    <section className="rounded-xl border border-border bg-card p-3"><div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input data-testid="input-final-billing-search" aria-label="Search final billing" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, customer, application number, or notes" className="pl-9" /></label><Select value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}><SelectTrigger data-testid="select-final-billing-filter-status" className="md:w-44"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All statuses</SelectItem>{statuses.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>{(search || statusFilter) && <Button variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear</Button>}</div></section>
    {projectsQuery.isLoading ? <LoadingPanel lines={7} /> : projectsQuery.isError ? <ErrorPanel title="Projects unavailable" text="Final billing could not load projects." onRetry={() => { void projectsQuery.refetch(); }} /> : !projects.length ? <EmptyState icon={ReceiptText} title="No projects available" text="Create a project before recording owner pay applications." /> : controlsError ? <ErrorPanel title="Project controls unavailable" text="Some pay-application registers could not be loaded." onRetry={() => controlsQueries.forEach((query) => { void query.refetch(); })} /> : loading ? <LoadingPanel lines={7} /> : !rows.length ? <EmptyState icon={Search} title={allItems.length ? 'No applications match' : 'No owner pay applications yet'} text={allItems.length ? 'Try a different search or status filter.' : 'Create the first application for a project closeout register.'} action={canManage && !allItems.length ? <Button onClick={() => setForm({})}><Plus size={15} /> Add application</Button> : undefined} /> : <><div className="space-y-3 md:hidden">{rows.map(({ project, item }) => <ApplicationCard key={item.id} project={project} item={item} canManage={canManage} onEdit={() => setForm({ project, item })} />)}</div><div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block"><table className="w-full min-w-[1050px] text-left text-sm"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Project / customer</th><th className="px-4 py-3">Application</th><th className="px-4 py-3">Period</th><th className="px-4 py-3 text-right">Gross</th><th className="px-4 py-3 text-right">Retainage</th><th className="px-4 py-3 text-right">Net</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Notes</th><th /></tr></thead><tbody>{rows.map(({ project, item }) => <tr key={item.id} data-testid={`final-billing-row-${item.id}`} className="border-b border-border/70 last:border-0 hover:bg-secondary/35"><td className="px-4 py-3"><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link><span className="block max-w-48 truncate text-xs">{project.projectName}</span><span className="block text-xs text-muted-foreground">{project.customerName}</span></td><td className="px-4 py-3 font-semibold">{item.applicationNumber}</td><td className="px-4 py-3 text-xs text-muted-foreground">{shortDate(item.periodStart)} — {shortDate(item.periodEnd)}</td><td className="mono px-4 py-3 text-right">{currency.format(item.grossAmount)}</td><td className="mono px-4 py-3 text-right">{currency.format(item.retainageAmount)}</td><td className="mono px-4 py-3 text-right">{currency.format(item.netAmount)}</td><td className="px-4 py-3"><Badge tone={tone(item.status)}>{humanize(item.status)}</Badge></td><td className="max-w-56 truncate px-4 py-3 text-xs text-muted-foreground">{item.notes || '—'}</td><td className="px-4 py-3 text-right">{canManage && <Button variant="ghost" className="p-2" onClick={() => setForm({ project, item })} aria-label={`Edit ${item.applicationNumber}`}><Pencil size={15} /></Button>}</td></tr>)}</tbody></table></div></>}
    {form && <PayApplicationForm projects={projects} project={form.project} item={form.item} onClose={() => setForm(undefined)} onSaved={saved} />}
  </div>;
}

export default FinalBilling;