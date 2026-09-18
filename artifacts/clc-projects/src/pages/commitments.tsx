import { useMemo, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { Link } from 'wouter';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileText, HandCoins, Pencil, Plus, Search, WalletCards } from 'lucide-react';
import {
  type Project,
  type ProjectCommitment,
  type ProjectCommitmentInput,
  type ProjectCommitmentUpdate,
  type ProjectControlsSummary,
  getGetProjectControlsQueryKey,
  getGetProjectControlsQueryOptions,
  getListProjectsQueryKey,
  useCreateProjectCommitment,
  useListProjects,
  useUpdateProjectCommitment,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, StatCard, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

const statuses = ['draft', 'pending', 'executed', 'complete', 'closed'] as const;
const types = [
  { value: 'subcontract', label: 'Subcontract' },
  { value: 'purchase_order', label: 'Purchase order' },
  { value: 'supplier', label: 'Supplier' },
] as const;
type Status = typeof statuses[number];
type CommitmentType = typeof types[number]['value'];
const humanize = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const tone = (value: string) => ['complete', 'closed', 'executed'].includes(value) ? 'green' as const : value === 'pending' ? 'orange' as const : 'teal' as const;

type FormState = {
  commitmentNumber: string; commitmentType: CommitmentType; vendorName: string; committedValue: string;
  invoicedValue: string; paidValue: string; dueDate: string; status: Status; description: string; documentUrl: string;
};
const blankForm: FormState = {
  commitmentNumber: '', commitmentType: 'subcontract', vendorName: '', committedValue: '', invoicedValue: '0',
  paidValue: '0', dueDate: '', status: 'draft', description: '', documentUrl: '',
};
const toForm = (item?: ProjectCommitment): FormState => item ? {
  commitmentNumber: item.commitmentNumber, commitmentType: item.commitmentType, vendorName: item.vendorName,
  committedValue: String(item.committedValue), invoicedValue: String(item.invoicedValue), paidValue: String(item.paidValue),
  dueDate: item.dueDate?.slice(0, 10) ?? '', status: item.status, description: item.description ?? '', documentUrl: item.documentUrl ?? '',
} : { ...blankForm };

function CommitmentForm({ projects, project, item, onClose, onSaved }: {
  projects: Project[]; project?: Project; item?: ProjectCommitment; onClose: () => void; onSaved: (value: ProjectCommitment) => void;
}) {
  const [form, setForm] = useState(() => toForm(item));
  const [projectId, setProjectId] = useState(String(project?.id ?? projects[0]?.id ?? ''));
  const create = useCreateProjectCommitment();
  const update = useUpdateProjectCommitment();
  const selectedProject = projects.find((candidate) => candidate.id === Number(projectId)) ?? project;
  const pending = create.isPending || update.isPending;
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject || !form.commitmentNumber.trim() || !form.vendorName.trim() || !form.committedValue) return;
    if (item) {
      const data: ProjectCommitmentUpdate = {
        description: form.description.trim() || null, status: form.status, invoicedValue: Number(form.invoicedValue) || 0,
        paidValue: Number(form.paidValue) || 0, dueDate: form.dueDate || null, documentUrl: form.documentUrl.trim() || null,
      };
      update.mutate({ projectId: selectedProject.id, commitmentId: item.id, data }, { onSuccess: onSaved });
    } else {
      const data: ProjectCommitmentInput = {
        commitmentNumber: form.commitmentNumber.trim(), commitmentType: form.commitmentType, vendorName: form.vendorName.trim(),
        committedValue: Number(form.committedValue), invoicedValue: Number(form.invoicedValue) || 0, paidValue: Number(form.paidValue) || 0,
        status: form.status, description: form.description.trim() || undefined, dueDate: form.dueDate || undefined, documentUrl: form.documentUrl.trim() || undefined,
      };
      create.mutate({ projectId: selectedProject.id, data }, { onSuccess: onSaved });
    }
  };
  const field = (key: keyof FormState, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <Input {...props} data-testid={`input-commitment-${key}`} value={form[key]} onChange={(event) => set(key, event.target.value)} readOnly={Boolean(item && ['commitmentNumber', 'vendorName', 'committedValue'].includes(key))} />
    </label>
  );
  const error = create.error ?? update.error;
  return <Modal title={item ? `Edit ${item.commitmentNumber}` : 'New commitment'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4" data-testid="commitment-form">
      {!item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Project</span>
        <Select value={projectId} onValueChange={setProjectId}><SelectTrigger data-testid="select-commitment-project"><SelectValue placeholder="Select a project" /></SelectTrigger>
          <SelectContent className="bg-popover">{projects.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.projectNumber} · {candidate.projectName}</SelectItem>)}</SelectContent>
        </Select>
      </label>}
      {selectedProject && <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">{selectedProject.projectNumber} · {selectedProject.projectName} · {selectedProject.customerName}</p>}
      <div className="grid gap-4 sm:grid-cols-2">
        {field('commitmentNumber', 'Commitment number', { required: true, placeholder: 'SC-001' })}
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Type</span><Select value={form.commitmentType} onValueChange={(value) => set('commitmentType', value)} disabled={Boolean(item)}><SelectTrigger data-testid="select-commitment-type"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{types.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select></label>
        {field('vendorName', 'Vendor / subcontractor', { required: true, placeholder: 'Trade partner or supplier' })}
        {field('committedValue', 'Committed value', { required: true, type: 'number', min: '0', step: '0.01' })}
        {field('invoicedValue', 'Invoiced value', { type: 'number', min: '0', step: '0.01' })}
        {field('paidValue', 'Paid value', { type: 'number', min: '0', step: '0.01' })}
        {field('dueDate', 'Due date', { type: 'date' })}
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Status</span><Select value={form.status} onValueChange={(value) => set('status', value)}><SelectTrigger data-testid="select-commitment-status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{statuses.map((status) => <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>)}</SelectContent></Select></label>
      </div>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea data-testid="textarea-commitment-description" rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} /></label>
      {field('documentUrl', 'Document URL', { type: 'url', placeholder: 'https://...' })}
      {error && <p role="alert" className="text-xs text-destructive">The commitment could not be saved. Check the fields and try again.</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-save-commitment" type="submit" disabled={pending || !selectedProject || !form.commitmentNumber.trim() || !form.vendorName.trim() || !form.committedValue}>{pending ? 'Saving…' : item ? 'Save changes' : 'Create commitment'}</Button></div>
    </form>
  </Modal>;
}

function CommitmentMobileCard({ project, item, canManage, onEdit }: { project: Project; item: ProjectCommitment; canManage: boolean; onEdit: () => void }) {
  return <article data-testid={`commitment-card-${item.id}`} className="rounded-lg border border-border bg-card p-4">
    <div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link><p className="text-sm font-semibold">{item.commitmentNumber} · {item.vendorName}</p><p className="text-xs text-muted-foreground">{project.customerName}</p></div><Badge tone={tone(item.status)}>{humanize(item.status)}</Badge></div>
    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3"><div><p className="text-[10px] uppercase text-muted-foreground">Committed</p><p className="mono text-sm font-semibold">{currency.format(item.committedValue)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Unpaid</p><p className="mono text-sm font-semibold">{currency.format(Math.max(0, item.invoicedValue - item.paidValue))}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Invoiced</p><p className="mono text-sm">{currency.format(item.invoicedValue)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Due</p><p className="text-sm">{shortDate(item.dueDate)}</p></div></div>
    <div className="mt-3 flex items-center justify-between">{item.documentUrl && <a href={item.documentUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Supporting document</a>}{canManage && <Button variant="ghost" className="p-2" onClick={onEdit} aria-label={`Edit ${item.commitmentNumber}`}><Pencil size={15} /></Button>}</div>
  </article>;
}

export function Commitments() {
  useRouteMetadata(routeMetadata.commitments);
  const { activeRole, isPlatformAdmin } = useTenant();
  const canManage = isPlatformAdmin || activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [form, setForm] = useState<{ project?: Project; item?: ProjectCommitment }>();
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 30000 } });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const controlsQueries = useQueries({ queries: projects.map((project) => getGetProjectControlsQueryOptions(project.id, { query: { queryKey: getGetProjectControlsQueryKey(project.id), staleTime: 30000 } })) });
  const loading = controlsQueries.some((query) => query.isLoading);
  const controlsError = controlsQueries.find((query) => query.isError);
  const rows = useMemo(() => projects.flatMap((project, index) => (controlsQueries[index]?.data?.commitments ?? []).map((item) => ({ project, item }))).filter(({ project, item }) => {
    const text = [project.projectNumber, project.projectName, project.customerName, item.commitmentNumber, item.vendorName, item.description ?? ''].join(' ').toLowerCase();
    return (!search.trim() || text.includes(search.trim().toLowerCase())) && (!statusFilter || item.status === statusFilter) && (!typeFilter || item.commitmentType === typeFilter);
  }), [controlsQueries, projects, search, statusFilter, typeFilter]);
  const allItems = controlsQueries.flatMap((query) => query.data?.commitments ?? []);
  const totals = allItems.reduce((sum, item) => ({ committed: sum.committed + item.committedValue, invoiced: sum.invoiced + item.invoicedValue, paid: sum.paid + item.paidValue }), { committed: 0, invoiced: 0, paid: 0 });
  const saved = (value: ProjectCommitment) => {
    queryClient.setQueryData<ProjectControlsSummary | undefined>(getGetProjectControlsQueryKey(value.projectId), (current) => current ? { ...current, commitments: current.commitments.some((item) => item.id === value.id) ? current.commitments.map((item) => item.id === value.id ? value : item) : [...current.commitments, value] } : current);
    void queryClient.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(value.projectId) });
    setForm(undefined);
  };
  return <div className="animate-rise space-y-6">
    <PageTitle eyebrow="Financial workspace" title="Commitments" description="Track committed spend, invoices, payments, and outstanding obligations across every project." action={canManage ? <Button data-testid="button-new-commitment" onClick={() => setForm({})} disabled={!projects.length}><Plus size={16} /> New commitment</Button> : undefined} />
    <section data-testid="commitments-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <StatCard label="Committed cost" value={loading ? '—' : currency.format(totals.committed)} detail={`${allItems.length} commitments`} icon={HandCoins} accent="teal" />
      <StatCard label="Invoiced cost" value={loading ? '—' : currency.format(totals.invoiced)} detail="Against committed scope" icon={FileText} accent="violet" />
      <StatCard label="Paid cost" value={loading ? '—' : currency.format(totals.paid)} detail="Payments recorded" icon={WalletCards} accent="green" />
      <StatCard label="Unpaid balance" value={loading ? '—' : currency.format(Math.max(0, totals.invoiced - totals.paid))} detail="Invoiced less paid" icon={CalendarDays} accent="orange" />
    </section>
    <section className="rounded-xl border border-border bg-card p-3">
      <div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input data-testid="input-commitments-search" aria-label="Search commitments" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, customer, number, vendor, description" className="pl-9" /></label>
        <Select value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}><SelectTrigger data-testid="select-commitments-status" className="md:w-44"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All statuses</SelectItem>{statuses.map((status) => <SelectItem key={status} value={status}>{humanize(status)}</SelectItem>)}</SelectContent></Select>
        <Select value={typeFilter || 'all'} onValueChange={(value) => setTypeFilter(value === 'all' ? '' : value)}><SelectTrigger data-testid="select-commitments-type" className="md:w-48"><SelectValue placeholder="All types" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All types</SelectItem>{types.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}</SelectContent></Select>
        {(search || statusFilter || typeFilter) && <Button variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); setTypeFilter(''); }}>Clear</Button>}
      </div>
    </section>
    {projectsQuery.isLoading ? <LoadingPanel lines={7} /> : projectsQuery.isError ? <ErrorPanel title="Projects unavailable" text="Commitments could not load projects." onRetry={() => { void projectsQuery.refetch(); }} /> : !projects.length ? <EmptyState icon={HandCoins} title="No projects available" text="Create a project before tracking commitments." /> : controlsError ? <ErrorPanel title="Project controls unavailable" text="Some commitment registers could not be loaded." onRetry={() => { controlsQueries.forEach((query) => { void query.refetch(); }); }} /> : loading ? <LoadingPanel lines={7} /> : !rows.length ? <EmptyState icon={Search} title={allItems.length ? 'No commitments match' : 'No commitments yet'} text={allItems.length ? 'Try a different search or filter.' : 'Create the first commitment for a project.'} action={canManage && !allItems.length ? <Button onClick={() => setForm({})}><Plus size={15} /> Add commitment</Button> : undefined} /> : <>
      <div className="space-y-3 md:hidden">{rows.map(({ project, item }) => <CommitmentMobileCard key={item.id} project={project} item={item} canManage={canManage} onEdit={() => setForm({ project, item })} />)}</div>
      <div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block"><table className="w-full min-w-[940px] text-left text-sm"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Project</th><th className="px-4 py-3">Commitment</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3 text-right">Committed</th><th className="px-4 py-3 text-right">Invoiced</th><th className="px-4 py-3 text-right">Paid</th><th className="px-4 py-3 text-right">Unpaid</th><th className="px-4 py-3">Due</th><th /></tr></thead><tbody>{rows.map(({ project, item }) => <tr key={item.id} data-testid={`commitment-row-${item.id}`} className="border-b border-border/70 last:border-0 hover:bg-secondary/35"><td className="px-4 py-3"><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link><span className="block max-w-48 truncate text-xs">{project.projectName}</span><span className="block text-xs text-muted-foreground">{project.customerName}</span></td><td className="px-4 py-3"><span className="font-semibold">{item.commitmentNumber}</span><span className="block max-w-52 truncate text-xs text-muted-foreground">{item.vendorName}</span>{item.documentUrl && <a href={item.documentUrl} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-primary hover:underline">Supporting document</a>}</td><td className="px-4 py-3 text-xs">{humanize(item.commitmentType)}</td><td className="px-4 py-3"><Badge tone={tone(item.status)}>{humanize(item.status)}</Badge></td><td className="mono px-4 py-3 text-right">{currency.format(item.committedValue)}</td><td className="mono px-4 py-3 text-right">{currency.format(item.invoicedValue)}</td><td className="mono px-4 py-3 text-right">{currency.format(item.paidValue)}</td><td className="mono px-4 py-3 text-right font-semibold">{currency.format(Math.max(0, item.invoicedValue - item.paidValue))}</td><td className="px-4 py-3 text-xs text-muted-foreground">{shortDate(item.dueDate)}</td><td className="px-4 py-3 text-right">{canManage && <Button variant="ghost" className="p-2" onClick={() => setForm({ project, item })} aria-label={`Edit ${item.commitmentNumber}`}><Pencil size={15} /></Button>}</td></tr>)}</tbody></table></div>
    </>}
    {form && <CommitmentForm projects={projects} project={form.project} item={form.item} onClose={() => setForm(undefined)} onSaved={saved} />}
  </div>;
}

export default Commitments;