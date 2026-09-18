import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarClock, CircleDollarSign, ListChecks, Pencil, Plus, Search } from 'lucide-react';
import {
  type Project,
  type ProjectControlsSummary,
  type ProjectIssue,
  type ProjectIssueInput,
  type ProjectIssueUpdate,
  getGetProjectControlsQueryKey,
  getGetProjectControlsQueryOptions,
  getListProjectsQueryKey,
  useCreateProjectIssue,
  useListProjects,
  useUpdateProjectIssue,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, StatCard, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

const statuses = ['open', 'pending_response', 'answered', 'closed'] as const;
const priorities = ['low', 'normal', 'high', 'critical'] as const;
const types = ['rfi', 'issue'] as const;
type FormState = { issueType: string; subject: string; question: string; responsibleParty: string; priority: string; status: string; dueDate: string; response: string; costImpact: string; scheduleImpactDays: string; documentUrl: string };
const blank: FormState = { issueType: 'rfi', subject: '', question: '', responsibleParty: '', priority: 'normal', status: 'open', dueDate: '', response: '', costImpact: '0', scheduleImpactDays: '0', documentUrl: '' };
const humanize = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const tone = (value: string) => value === 'critical' ? 'red' as const : value === 'high' || value === 'pending_response' ? 'orange' as const : value === 'closed' || value === 'answered' ? 'green' as const : 'teal' as const;
const overdue = (item: ProjectIssue) => Boolean(item.dueDate && item.status !== 'closed' && new Date(item.dueDate) < new Date(new Date().toDateString()));

function toForm(item?: ProjectIssue): FormState {
  return item ? { issueType: item.issueType, subject: item.subject, question: item.question, responsibleParty: item.responsibleParty ?? '', priority: item.priority, status: item.status, dueDate: item.dueDate?.slice(0, 10) ?? '', response: item.response ?? '', costImpact: String(item.costImpact), scheduleImpactDays: String(item.scheduleImpactDays), documentUrl: item.documentUrl ?? '' } : { ...blank };
}

function IssueForm({ projects, project, item, onClose, onSaved }: { projects: Project[]; project?: Project; item?: ProjectIssue; onClose: () => void; onSaved: (value: ProjectIssue) => void }) {
  const [form, setForm] = useState(() => toForm(item));
  const [projectId, setProjectId] = useState(String(project?.id ?? projects[0]?.id ?? ''));
  const create = useCreateProjectIssue();
  const update = useUpdateProjectIssue();
  const selected = projects.find((candidate) => candidate.id === Number(projectId)) ?? project;
  const pending = create.isPending || update.isPending;
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selected || !form.subject.trim() || !form.question.trim()) return;
    if (item) {
      const data: ProjectIssueUpdate = { subject: form.subject.trim(), question: form.question.trim(), responsibleParty: form.responsibleParty.trim() || null, status: form.status as ProjectIssueUpdate['status'], priority: form.priority as ProjectIssueUpdate['priority'], dueDate: form.dueDate || null, response: form.response.trim() || null, documentUrl: form.documentUrl.trim() || null, costImpact: Number(form.costImpact) || 0, scheduleImpactDays: Number(form.scheduleImpactDays) || 0 };
      update.mutate({ projectId: selected.id, issueId: item.id, data }, { onSuccess: onSaved });
    } else {
      const data: ProjectIssueInput = { issueType: form.issueType as ProjectIssueInput['issueType'], subject: form.subject.trim(), question: form.question.trim(), responsibleParty: form.responsibleParty.trim() || undefined, status: form.status as ProjectIssueInput['status'], priority: form.priority as ProjectIssueInput['priority'], dueDate: form.dueDate || undefined, response: form.response.trim() || undefined, documentUrl: form.documentUrl.trim() || undefined, costImpact: Number(form.costImpact) || 0, scheduleImpactDays: Number(form.scheduleImpactDays) || 0 };
      create.mutate({ projectId: selected.id, data }, { onSuccess: onSaved });
    }
  };
  const field = (key: keyof FormState, label: string, type = 'text', required = false) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span><Input data-testid={`input-open-item-${key}`} type={type} required={required} value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>;
  const error = create.error ?? update.error;
  return <Modal title={item ? `Edit ${item.issueNumber}` : 'New open item'} onClose={onClose}>
    <form data-testid="open-item-editor" onSubmit={submit} className="space-y-4">
      {!item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Project</span><Select value={projectId} onValueChange={setProjectId}><SelectTrigger data-testid="select-open-item-project"><SelectValue placeholder="Select a project" /></SelectTrigger><SelectContent className="bg-popover">{projects.map((candidate) => <SelectItem key={candidate.id} value={String(candidate.id)}>{candidate.projectNumber} · {candidate.projectName}</SelectItem>)}</SelectContent></Select></label>}
      {selected && <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">{selected.projectNumber} · {selected.projectName} · {selected.customerName}</p>}
      {item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Issue number</span><Input data-testid="input-open-item-issueNumber" value={item.issueNumber} readOnly /></label>}
      <div className="grid gap-4 sm:grid-cols-2">
        {!item && <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Type</span><Select value={form.issueType} onValueChange={(value) => set('issueType', value)}><SelectTrigger data-testid="select-open-item-type"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{types.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></label>}
        {field('subject', 'Subject', 'text', true)}
        {field('responsibleParty', 'Responsible party')}
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Priority</span><Select value={form.priority} onValueChange={(value) => set('priority', value)}><SelectTrigger data-testid="select-open-item-priority"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{priorities.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Status</span><Select value={form.status} onValueChange={(value) => set('status', value)}><SelectTrigger data-testid="select-open-item-status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{statuses.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select></label>
        {field('dueDate', 'Due date', 'date')}
        {field('costImpact', 'Cost impact', 'number')}
        {field('scheduleImpactDays', 'Schedule impact (days)', 'number')}
      </div>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Question</span><Textarea data-testid="textarea-open-item-question" rows={3} required value={form.question} onChange={(event) => set('question', event.target.value)} /></label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Response</span><Textarea data-testid="textarea-open-item-response" rows={3} value={form.response} onChange={(event) => set('response', event.target.value)} /></label>
      {field('documentUrl', 'Document URL', 'url')}
      {error && <p role="alert" className="text-xs text-destructive">The open item could not be saved. Check the fields and try again.</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-save-open-item" type="submit" disabled={pending || !selected || !form.subject.trim() || !form.question.trim()}>{pending ? 'Saving…' : item ? 'Save changes' : 'Create open item'}</Button></div>
    </form>
  </Modal>;
}

function IssueCard({ project, item, canManage, onEdit }: { project: Project; item: ProjectIssue; canManage: boolean; onEdit: () => void }) {
  return <article data-testid={`open-item-card-${item.id}`} className="rounded-lg border border-border bg-card p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link><p className="text-sm font-semibold">{item.issueNumber} · {item.subject}</p><p className="text-xs text-muted-foreground">{project.customerName} · {humanize(item.issueType)}</p></div><Badge tone={tone(item.priority)}>{humanize(item.priority)}</Badge></div><div className="mt-4 grid grid-cols-2 gap-3 border-t border-border pt-3"><div><p className="text-[10px] uppercase text-muted-foreground">Status</p><Badge tone={tone(item.status)}>{humanize(item.status)}</Badge></div><div><p className="text-[10px] uppercase text-muted-foreground">Due</p><p className={`text-sm ${overdue(item) ? 'font-semibold text-destructive' : ''}`}>{shortDate(item.dueDate)}{overdue(item) ? ' · Overdue' : ''}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Cost impact</p><p className="mono text-sm">{currency.format(item.costImpact)}</p></div><div><p className="text-[10px] uppercase text-muted-foreground">Schedule</p><p className="mono text-sm">{item.scheduleImpactDays} days</p></div></div><div className="mt-3 flex items-center justify-between">{item.documentUrl && <a href={item.documentUrl} target="_blank" rel="noreferrer" className="text-xs font-semibold text-primary hover:underline">Supporting document</a>}{canManage && <Button variant="ghost" className="p-2" onClick={onEdit} aria-label={`Edit ${item.issueNumber}`}><Pencil size={15} /></Button>}</div></article>;
}

export function OpenItems() {
  useRouteMetadata(routeMetadata.openItems);
  const { activeRole, isPlatformAdmin } = useTenant();
  const canManage = isPlatformAdmin || activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [priorityFilter, setPriorityFilter] = useState('');
  const [form, setForm] = useState<{ project?: Project; item?: ProjectIssue }>();
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 30000 } });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const controlsQueries = useQueries({ queries: projects.map((project) => getGetProjectControlsQueryOptions(project.id, { query: { queryKey: getGetProjectControlsQueryKey(project.id), staleTime: 30000 } })) });
  const allItems = useMemo(() => projects.flatMap((project, index) => (controlsQueries[index]?.data?.issues ?? []).map((item) => ({ project, item }))), [controlsQueries, projects]);
  const rows = useMemo(() => allItems.filter(({ project, item }) => { const text = [project.projectNumber, project.projectName, project.customerName, item.issueNumber, item.subject, item.responsibleParty ?? '', item.question].join(' ').toLowerCase(); const needle = search.trim().toLowerCase(); return (!needle || text.includes(needle)) && (!statusFilter || item.status === statusFilter) && (!typeFilter || item.issueType === typeFilter) && (!priorityFilter || item.priority === priorityFilter); }), [allItems, priorityFilter, search, statusFilter, typeFilter]);
  const totals = useMemo(() => allItems.reduce((sum, { item }) => ({ open: sum.open + (item.status === 'closed' ? 0 : 1), overdue: sum.overdue + (overdue(item) ? 1 : 0), high: sum.high + (item.priority === 'high' || item.priority === 'critical' ? 1 : 0), cost: sum.cost + item.costImpact, days: sum.days + item.scheduleImpactDays }), { open: 0, overdue: 0, high: 0, cost: 0, days: 0 }), [allItems]);
  const loading = controlsQueries.some((query) => query.isLoading);
  const controlsError = controlsQueries.some((query) => query.isError);
  const saved = (value: ProjectIssue) => { queryClient.setQueryData<ProjectControlsSummary | undefined>(getGetProjectControlsQueryKey(value.projectId), (current) => current ? { ...current, issues: current.issues.some((item) => item.id === value.id) ? current.issues.map((item) => item.id === value.id ? value : item) : [...current.issues, value] } : current); void queryClient.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(value.projectId) }); setForm(undefined); };
  return <div className="animate-rise space-y-6">
    <PageTitle eyebrow="Closeout workspace" title="Open Items" description="Coordinate RFIs and project issues across the active tenant and environment." action={canManage ? <Button data-testid="button-new-open-item" onClick={() => setForm({})} disabled={!projects.length}><Plus size={16} /> New open item</Button> : undefined} />
    <section data-testid="open-items-summary-metrics" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4"><StatCard label="Open items" value={loading ? '—' : String(totals.open)} detail={`${allItems.length} total records`} icon={ListChecks} accent="teal" /><StatCard label="Overdue items" value={loading ? '—' : String(totals.overdue)} detail="Past due and not closed" icon={CalendarClock} accent="orange" /><StatCard label="High / critical" value={loading ? '—' : String(totals.high)} detail="Priority attention required" icon={AlertTriangle} accent="violet" /><StatCard label="Total impact" value={loading ? '—' : `${currency.format(totals.cost)} · ${totals.days} days`} detail="Cost and schedule impact" icon={CircleDollarSign} accent="green" /></section>
    <section className="rounded-xl border border-border bg-card p-3"><div className="flex flex-col gap-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input data-testid="input-open-items-search" aria-label="Search open items" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, customer, issue number, subject, responsible party, question" className="pl-9" /></label><Select value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}><SelectTrigger data-testid="select-open-items-status" className="md:w-44"><SelectValue placeholder="All statuses" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All statuses</SelectItem>{statuses.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select><Select value={typeFilter || 'all'} onValueChange={(value) => setTypeFilter(value === 'all' ? '' : value)}><SelectTrigger data-testid="select-open-items-type" className="md:w-36"><SelectValue placeholder="All types" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All types</SelectItem>{types.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select><Select value={priorityFilter || 'all'} onValueChange={(value) => setPriorityFilter(value === 'all' ? '' : value)}><SelectTrigger data-testid="select-open-items-priority" className="md:w-40"><SelectValue placeholder="All priorities" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All priorities</SelectItem>{priorities.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent></Select>{(search || statusFilter || typeFilter || priorityFilter) && <Button variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); setTypeFilter(''); setPriorityFilter(''); }}>Clear</Button>}</div></section>
    {projectsQuery.isLoading ? <LoadingPanel lines={7} /> : projectsQuery.isError ? <ErrorPanel title="Projects unavailable" text="Open items could not load projects." onRetry={() => { void projectsQuery.refetch(); }} /> : !projects.length ? <EmptyState icon={ListChecks} title="No projects available" text="Create a project before tracking open items." /> : controlsError ? <ErrorPanel title="Project controls unavailable" text="Some open item registers could not be loaded." onRetry={() => controlsQueries.forEach((query) => { void query.refetch(); })} /> : loading ? <LoadingPanel lines={7} /> : !rows.length ? <EmptyState icon={Search} title={allItems.length ? 'No open items match' : 'No open items yet'} text={allItems.length ? 'Try a different search or filter.' : 'Create the first RFI or project issue.'} action={canManage && !allItems.length ? <Button onClick={() => setForm({})}><Plus size={15} /> Add open item</Button> : undefined} /> : <><div className="space-y-3 md:hidden">{rows.map(({ project, item }) => <IssueCard key={item.id} project={project} item={item} canManage={canManage} onEdit={() => setForm({ project, item })} />)}</div><div className="hidden overflow-x-auto rounded-xl border border-border bg-card md:block"><table className="w-full min-w-[1100px] text-left text-sm"><thead><tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground"><th className="px-4 py-3">Project</th><th className="px-4 py-3">Issue</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Responsible</th><th className="px-4 py-3">Due</th><th className="px-4 py-3 text-right">Cost</th><th className="px-4 py-3 text-right">Schedule</th><th /></tr></thead><tbody>{rows.map(({ project, item }) => <tr key={item.id} data-testid={`open-item-row-${item.id}`} className="border-b border-border/70 last:border-0 hover:bg-secondary/35"><td className="px-4 py-3"><Link href={`/projects/${project.id}`} className="font-bold text-primary hover:underline">{project.projectNumber}</Link><span className="block max-w-44 truncate text-xs">{project.projectName}</span><span className="block text-xs text-muted-foreground">{project.customerName}</span></td><td className="px-4 py-3"><span className="font-semibold">{item.issueNumber}</span><span className="block max-w-56 truncate text-xs text-muted-foreground">{item.subject}</span>{item.documentUrl && <a href={item.documentUrl} target="_blank" rel="noreferrer" className="text-[10px] font-semibold text-primary hover:underline">Supporting document</a>}</td><td className="px-4 py-3 text-xs">{humanize(item.issueType)}</td><td className="px-4 py-3"><Badge tone={tone(item.status)}>{humanize(item.status)}</Badge></td><td className="px-4 py-3"><Badge tone={tone(item.priority)}>{humanize(item.priority)}</Badge></td><td className="px-4 py-3 text-xs">{item.responsibleParty || '—'}</td><td className={`px-4 py-3 text-xs ${overdue(item) ? 'font-semibold text-destructive' : 'text-muted-foreground'}`}>{shortDate(item.dueDate)}{overdue(item) ? ' · overdue' : ''}</td><td className="mono px-4 py-3 text-right">{currency.format(item.costImpact)}</td><td className="mono px-4 py-3 text-right">{item.scheduleImpactDays} d</td><td className="px-4 py-3 text-right">{canManage && <Button variant="ghost" className="p-2" onClick={() => setForm({ project, item })} aria-label={`Edit ${item.issueNumber}`}><Pencil size={15} /></Button>}</td></tr>)}</tbody></table></div></>}
    {form && <IssueForm projects={projects} project={form.project} item={form.item} onClose={() => setForm(undefined)} onSaved={saved} />}
  </div>;
}

export default OpenItems;