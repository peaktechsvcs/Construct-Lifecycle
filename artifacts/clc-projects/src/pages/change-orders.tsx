import { useMemo, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, Check, Clock3, FileText, Pencil, Plus, Search, X } from 'lucide-react';
import {
  type Project,
  type ProjectControlEvent,
  type ProjectChangeOrder,
  type ProjectChangeOrderInput,
  type ProjectChangeOrderUpdate,
  type ProjectControlsSummary,
  getGetProjectControlsQueryKey,
  getGetProjectControlsQueryOptions,
  getListProjectsQueryKey,
  useCreateProjectChangeOrder,
  useListProjects,
  useUpdateProjectChangeOrder,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

const changeTypes = [
  { value: 'change_request', label: 'Change request' },
  { value: 'change_order', label: 'Change order' },
] as const;
const statuses = ['draft', 'submitted', 'under_review', 'approved', 'rejected', 'void'] as const;
const approvals = ['pending', 'approved', 'rejected'] as const;
const humanize = (value: string) => value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
const statusTone = (value: string) =>
  value === 'approved'
    ? 'green' as const
    : value === 'rejected' || value === 'void'
      ? 'red' as const
      : value === 'under_review' || value === 'pending'
        ? 'orange' as const
        : 'teal' as const;
const historyDateTime = (value: string) =>
  new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));

function historyStatus(event: ProjectControlEvent, key: 'approvalStatus' | 'workflowStatus') {
  const value = event.details?.[key];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const pair = value as { from?: unknown; to?: unknown };
    return {
      from: typeof pair.from === 'string' ? pair.from : null,
      to: typeof pair.to === 'string' ? pair.to : null,
    };
  }
  return key === 'approvalStatus'
    ? { from: event.fromStatus, to: event.toStatus }
    : { from: null, to: null };
}

function historyEventLabel(action: string) {
  return action === 'change_order_created' ? 'Change Order created' : 'Change Order updated';
}

const emptyForm = {
  changeNumber: '',
  changeType: 'change_request' as 'change_request' | 'change_order',
  title: '',
  description: '',
  status: 'draft' as typeof statuses[number],
  approvalStatus: 'pending' as typeof approvals[number],
  proposedValue: '',
  approvedValue: '',
  scheduleImpactDays: '',
  requestedBy: '',
  dueDate: '',
  documentUrl: '',
};

type FormState = typeof emptyForm;

function toForm(item?: ProjectChangeOrder): FormState {
  return item
    ? {
        changeNumber: item.changeNumber,
        changeType: item.changeType,
        title: item.title,
        description: item.description ?? '',
        status: item.status,
        approvalStatus: item.approvalStatus,
        proposedValue: String(item.proposedValue),
        approvedValue: String(item.approvedValue ?? ''),
        scheduleImpactDays: String(item.scheduleImpactDays ?? ''),
        requestedBy: item.requestedBy ?? '',
        dueDate: item.dueDate?.slice(0, 10) ?? '',
        documentUrl: item.documentUrl ?? '',
      }
    : { ...emptyForm };
}

function getMutationErrorMessage(error: unknown) {
  const status = error && typeof error === 'object' && 'status' in error ? (error as { status?: unknown }).status : undefined;
  return status === 403
    ? 'Only customer administrators can approve a change order.'
    : 'The change could not be saved. Check the fields and try again.';
}

function ChangeOrderForm({
  projects,
  project,
  item,
  canApprove,
  onClose,
  onSaved,
}: {
  projects: Project[];
  project?: Project;
  item?: ProjectChangeOrder;
  canApprove: boolean;
  onClose: () => void;
  onSaved: (value: ProjectChangeOrder) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(item));
  const [projectId, setProjectId] = useState(String(project?.id ?? projects[0]?.id ?? ''));
  const create = useCreateProjectChangeOrder();
  const update = useUpdateProjectChangeOrder();
  const pending = create.isPending || update.isPending;
  const selectedProject = projects.find((candidate) => candidate.id === Number(projectId)) ?? project;
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!selectedProject || !form.changeNumber.trim() || !form.title.trim() || !form.proposedValue) return;

    const optional = {
      description: form.description.trim() || undefined,
      approvedValue: form.approvedValue ? Number(form.approvedValue) : undefined,
      scheduleImpactDays: form.scheduleImpactDays ? Number(form.scheduleImpactDays) : undefined,
      dueDate: form.dueDate || undefined,
      documentUrl: form.documentUrl.trim() || undefined,
    };

    if (item) {
      const workflow = canApprove || form.approvalStatus !== 'approved'
        ? { status: form.status, approvalStatus: form.approvalStatus }
        : {};
      const data: ProjectChangeOrderUpdate = {
        ...optional,
        ...workflow,
        title: form.title.trim(),
        proposedValue: Number(form.proposedValue),
        description: form.description.trim() || null,
        dueDate: form.dueDate || null,
        documentUrl: form.documentUrl.trim() || null,
      };
      update.mutate(
        { projectId: selectedProject.id, changeOrderId: item.id, data },
        { onSuccess: onSaved, onError: () => undefined },
      );
    } else {
      const data: ProjectChangeOrderInput = {
        ...optional,
        changeNumber: form.changeNumber.trim(),
        changeType: form.changeType,
        title: form.title.trim(),
        proposedValue: Number(form.proposedValue),
        status: form.status,
        approvalStatus: canApprove ? form.approvalStatus : 'pending',
        requestedBy: form.requestedBy.trim() || undefined,
      };
      create.mutate(
        { projectId: selectedProject.id, data },
        { onSuccess: onSaved, onError: () => undefined },
      );
    }
  };

  const field = (key: keyof FormState, label: string, props: InputHTMLAttributes<HTMLInputElement> = {}) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <Input
        data-testid={`input-change-order-${key}`}
        {...props}
        value={form[key]}
        onChange={(event) => set(key, event.target.value)}
        readOnly={item && (key === 'changeNumber' || key === 'requestedBy') ? true : props.readOnly}
      />
    </label>
  );
  const approvalOptions = approvals.filter((value) => value !== 'approved' || canApprove || form.approvalStatus === 'approved');
  const error = create.error ?? update.error;

  return (
    <Modal title={item ? `Edit ${item.changeNumber}` : 'New change'} onClose={onClose}>
      <form data-testid="change-order-form" onSubmit={submit} className="space-y-4">
        {!item && (
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Project</span>
            <Select value={projectId} onValueChange={setProjectId}>
              <SelectTrigger aria-label="Project">
                <SelectValue placeholder="Select a project" />
              </SelectTrigger>
              <SelectContent className="bg-popover">
                {projects.map((candidate) => (
                  <SelectItem key={candidate.id} value={String(candidate.id)}>
                    {candidate.projectNumber} · {candidate.projectName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        )}
        {selectedProject && (
          <p className="rounded-md bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
            {selectedProject.projectNumber} · {selectedProject.projectName} · {selectedProject.customerName}
          </p>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          {field('changeNumber', 'Change number', { required: true, placeholder: 'CO-001' })}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Type</span>
            <Select value={form.changeType} onValueChange={(value) => set('changeType', value)} disabled={Boolean(item)}>
              <SelectTrigger aria-label="Change type"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                {changeTypes.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          {field('title', 'Title', { required: true, placeholder: 'Additional concrete scope' })}
          {field('proposedValue', 'Proposed value', { required: true, type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}
          {field('approvedValue', 'Approved value', { type: 'number', min: '0', step: '0.01', placeholder: 'Set after approval' })}
          {field('scheduleImpactDays', 'Schedule impact (days)', { type: 'number', min: '0', step: '1', placeholder: '0' })}
          {field('requestedBy', 'Requested by', { placeholder: 'Team member or company' })}
          {field('dueDate', 'Due date', { type: 'date' })}
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span>
          <Textarea data-testid="textarea-change-order-description" rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Scope, pricing assumptions, and schedule notes" />
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Workflow status</span>
            <Select value={form.status} onValueChange={(value) => set('status', value)}>
              <SelectTrigger aria-label="Workflow status"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                {statuses.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Approval status</span>
            <Select value={form.approvalStatus} onValueChange={(value) => set('approvalStatus', value)} disabled={!canApprove && form.approvalStatus === 'approved'}>
              <SelectTrigger aria-label="Approval status"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">
                {approvalOptions.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}
              </SelectContent>
            </Select>
            {!canApprove && <p className="mt-1 text-[10px] text-muted-foreground">Customer administrator approval is required for approval.</p>}
          </label>
        </div>
        {field('documentUrl', 'Document URL', { type: 'url', placeholder: 'https://...' })}
        {error && <p role="alert" className="text-xs text-destructive">{getMutationErrorMessage(error)}</p>}
        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button data-testid="button-save-change-order" type="submit" disabled={pending || !selectedProject || !form.changeNumber.trim() || !form.title.trim() || !form.proposedValue}>
            {pending ? 'Saving…' : item ? 'Save changes' : 'Create change'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectChangeOrders({
  project,
  controls,
  search,
  statusFilter,
  canApprove,
  canManage,
  onEdit,
  onCreate,
}: {
  project: Project;
  controls: ProjectControlsSummary;
  search: string;
  statusFilter: string;
  canApprove: boolean;
  canManage: boolean;
  onEdit: (item: ProjectChangeOrder) => void;
  onCreate: () => void;
}) {
  const queryClient = useQueryClient();
  const update = useUpdateProjectChangeOrder();
  const [feedback, setFeedback] = useState<string>();
  const projectText = `${project.projectNumber} ${project.projectName} ${project.customerName}`.toLowerCase();
  const normalizedSearch = search.trim().toLowerCase();
  const items = controls.changeOrders.filter((item) => {
    const matchesStatus = !statusFilter || item.approvalStatus === statusFilter;
    const itemText = [item.changeNumber, item.title, item.description ?? '', item.requestedBy ?? ''].join(' ').toLowerCase();
    return matchesStatus && (!normalizedSearch || projectText.includes(normalizedSearch) || itemText.includes(normalizedSearch));
  });
  if (!items.length) return null;

  const transition = (item: ProjectChangeOrder, approvalStatus: 'approved' | 'rejected') => {
    setFeedback(undefined);
    update.mutate(
      { projectId: project.id, changeOrderId: item.id, data: { approvalStatus, status: approvalStatus } },
      {
        onSuccess: (value) => {
          queryClient.setQueryData<ProjectControlsSummary | undefined>(
            getGetProjectControlsQueryKey(project.id),
            (current) => current ? { ...current, changeOrders: current.changeOrders.map((candidate) => candidate.id === value.id ? value : candidate) } : current,
          );
          queryClient.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(project.id) });
          setFeedback(`${item.changeNumber} marked ${humanize(approvalStatus)}.`);
        },
        onError: (error) => setFeedback(getMutationErrorMessage(error)),
      },
    );
  };

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-secondary/35 px-5 py-3">
        <div>
          <p className="mono text-[10px] text-accent">{project.projectNumber}</p>
          <h2 className="text-sm font-bold">{project.projectName}</h2>
          <p className="text-xs text-muted-foreground">{project.customerName}</p>
        </div>
        {canManage && <Button data-testid={`button-add-change-${project.id}`} variant="outline" onClick={onCreate}><Plus size={15} /> Add change</Button>}
      </div>
      {feedback && <p data-testid={`change-order-feedback-${project.id}`} role="status" aria-live="polite" className="border-b border-border px-5 py-2 text-xs text-muted-foreground">{feedback}</p>}
      <div className="divide-y divide-border">
        {items.map((item) => (
          <div key={item.id} data-testid={`change-order-row-${item.id}`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.35fr_110px_130px_110px_145px_auto] md:items-center md:gap-4">
            <div className="min-w-0">
              <p className="mono text-[10px] text-accent">{item.changeNumber} · {humanize(item.changeType)}</p>
              <p className="truncate text-sm font-bold">{item.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {item.requestedBy || 'Requested by project team'}{item.scheduleImpactDays ? ` · +${item.scheduleImpactDays} days` : ''}
              </p>
              {item.documentUrl && <a data-testid={`link-change-order-document-${item.id}`} href={item.documentUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[10px] font-semibold text-primary hover:underline">Open supporting document</a>}
            </div>
            <Badge tone={statusTone(item.status)}>{humanize(item.status)}</Badge>
            <Badge tone={statusTone(item.approvalStatus)}>{humanize(item.approvalStatus)}</Badge>
            <p className="mono text-sm font-medium">{currency.format(item.proposedValue)}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} />{shortDate(item.dueDate)}</p>
            <div className="flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              {canManage && <Button data-testid={`button-edit-change-${item.id}`} variant="ghost" className="p-2" aria-label={`Edit ${item.changeNumber}`} onClick={() => onEdit(item)}><Pencil size={15} /></Button>}
              {canApprove && item.approvalStatus === 'pending' && (
                <>
                  <Button data-testid={`button-approve-change-${item.id}`} variant="ghost" className="p-2 text-status-success" aria-label={`Approve ${item.changeNumber}`} onClick={() => transition(item, 'approved')} disabled={update.isPending}><Check size={15} /></Button>
                  <Button data-testid={`button-reject-change-${item.id}`} variant="ghost" className="p-2 text-status-danger" aria-label={`Reject ${item.changeNumber}`} onClick={() => transition(item, 'rejected')} disabled={update.isPending}><X size={15} /></Button>
                </>
              )}
            </div>
            {(() => {
              const history = controls.events
                .filter((event) => event.entityType === 'change_order' && event.entityId === item.id)
                .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
              return (
                <details open className="md:col-span-6 rounded-lg border border-border/70 bg-secondary/25 px-3 py-2.5" data-testid={`change-order-history-${item.id}`}>
                  <summary className="cursor-pointer list-none text-[10px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                    Approval history <span className="ml-1 font-normal normal-case tracking-normal">({history.length} {history.length === 1 ? 'entry' : 'entries'})</span>
                  </summary>
                  {history.length ? (
                    <div className="mt-3 space-y-3">
                      {history.map((event) => {
                        const approval = historyStatus(event, 'approvalStatus');
                        const workflow = historyStatus(event, 'workflowStatus');
                        return (
                          <div key={event.id} data-testid={`change-order-history-entry-${event.id}`} className="relative flex gap-3 border-l-2 border-primary/30 pl-3">
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-semibold">{historyEventLabel(event.action)}</p>
                              <p className="mt-1 text-[11px] leading-5 text-muted-foreground">
                                Approval: <span className="font-semibold text-foreground">{humanize(approval.from ?? '—')}</span>
                                {' → '}
                                <span className="font-semibold text-foreground">{humanize(approval.to ?? '—')}</span>
                                {' · '}
                                Workflow: <span className="font-semibold text-foreground">{humanize(workflow.from ?? '—')}</span>
                                {' → '}
                                <span className="font-semibold text-foreground">{humanize(workflow.to ?? '—')}</span>
                              </p>
                              <p className="mono mt-1 text-[9px] uppercase tracking-[.07em] text-muted-foreground">
                                {event.actorDisplayName} · {historyDateTime(event.createdAt)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-muted-foreground">No approval history has been recorded.</p>
                  )}
                </details>
              );
            })()}
          </div>
        ))}
      </div>
    </section>
  );
}

export function ChangeOrders() {
  useRouteMetadata(routeMetadata.changeOrders);
  const queryClient = useQueryClient();
  const { activeRole, isPlatformAdmin } = useTenant();
  const canManage = isPlatformAdmin || activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const canApprove = isPlatformAdmin || activeRole === 'owner' || activeRole === 'admin';
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState<{ project?: Project; item?: ProjectChangeOrder }>();
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 30000 } });
  const projects = useMemo(() => projectsQuery.data ?? [], [projectsQuery.data]);
  const controlsQueries = useQueries({
    queries: projects.map((project) => getGetProjectControlsQueryOptions(project.id, {
      query: { queryKey: getGetProjectControlsQueryKey(project.id), staleTime: 30000 },
    })),
  });
  const controlsLoading = controlsQueries.some((query) => query.isLoading);
  const controlsError = controlsQueries.find((query) => query.isError);
  const groups = useMemo(
    () => projects
      .map((project, index) => ({ project, controls: controlsQueries[index]?.data }))
      .filter((group): group is { project: Project; controls: ProjectControlsSummary } => Boolean(group.controls))
      .filter(({ project, controls }) => {
        const projectText = `${project.projectNumber} ${project.projectName} ${project.customerName}`.toLowerCase();
        const normalizedSearch = search.trim().toLowerCase();
        return controls.changeOrders.some((item) => {
          const itemText = [item.changeNumber, item.title, item.description ?? '', item.requestedBy ?? ''].join(' ').toLowerCase();
          return (!statusFilter || item.approvalStatus === statusFilter)
            && (!normalizedSearch || projectText.includes(normalizedSearch) || itemText.includes(normalizedSearch));
        });
      }),
    [controlsQueries, projects, search, statusFilter],
  );
  const totalChanges = groups.reduce((sum, group) => sum + group.controls.changeOrders.filter((item) => (!statusFilter || item.approvalStatus === statusFilter) && (!search || `${group.project.projectNumber} ${group.project.projectName} ${group.project.customerName} ${item.changeNumber} ${item.title} ${item.description ?? ''}`.toLowerCase().includes(search.toLowerCase()))).length, 0);
  const pendingCount = groups.reduce((sum, group) => sum + group.controls.changeOrders.filter((item) => item.approvalStatus === 'pending').length, 0);
  const close = () => setForm(undefined);
  const saved = (value: ProjectChangeOrder) => {
    queryClient.setQueryData<ProjectControlsSummary | undefined>(
      getGetProjectControlsQueryKey(value.projectId),
      (current) => current
        ? {
            ...current,
            changeOrders: current.changeOrders.some((item) => item.id === value.id)
              ? current.changeOrders.map((item) => item.id === value.id ? value : item)
              : [...current.changeOrders, value],
          }
        : current,
    );
    queryClient.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(value.projectId) });
    close();
  };

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Project controls"
        title="Change orders"
        description="Control scope, price, and schedule changes with an approval trail across projects."
        action={canManage ? <Button data-testid="button-new-change-order" onClick={() => setForm({})} disabled={!projects.length}><Plus size={16} /> New change</Button> : undefined}
      />
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Changes in view</p><p className="mt-2 text-2xl font-semibold">{controlsLoading ? '—' : totalChanges}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Awaiting approval</p><p className="mt-2 text-2xl font-semibold"><Clock3 className="mr-1 inline-block text-status-warning" size={21} />{controlsLoading ? '—' : pendingCount}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Projects with changes</p><p className="mt-2 text-2xl font-semibold">{controlsLoading ? '—' : groups.length}</p></div>
      </div>
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
          <Input aria-label="Search change orders" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search project, change number, title" className="h-10 border-transparent bg-secondary/65 pl-9" />
        </label>
        <Select value={statusFilter || 'all'} onValueChange={(value) => setStatusFilter(value === 'all' ? '' : value)}>
          <SelectTrigger aria-label="Filter by approval status" className="h-10 border-transparent bg-secondary/65 md:w-48"><SelectValue placeholder="All approvals" /></SelectTrigger>
          <SelectContent className="bg-popover"><SelectItem value="all">All approvals</SelectItem>{approvals.map((value) => <SelectItem key={value} value={value}>{humanize(value)}</SelectItem>)}</SelectContent>
        </Select>
        {(search || statusFilter) && <Button variant="ghost" onClick={() => { setSearch(''); setStatusFilter(''); }}>Clear</Button>}
      </div>
      {projectsQuery.isLoading ? <LoadingPanel lines={7} />
        : projectsQuery.isError ? <ErrorPanel onRetry={() => projectsQuery.refetch()} />
          : !projects.length ? <EmptyState icon={FileText} title="No projects available" text="Create a project before tracking scope and price changes." />
            : controlsError ? <ErrorPanel title="Some project controls are unavailable" text="Change orders could not be loaded for every project." onRetry={() => { controlsQueries.forEach((query) => { void query.refetch(); }); }} />
              : controlsLoading ? <LoadingPanel lines={7} />
                : !groups.length ? <EmptyState icon={Search} title="No change orders match" text={search || statusFilter ? 'Try a different search or clear the approval filter.' : 'Create the first change request or order for a project.'} action={canManage ? <Button onClick={() => setForm({})}><Plus size={15} /> Add change</Button> : undefined} />
                  : <div className="space-y-4">{groups.map(({ project, controls }) => <ProjectChangeOrders key={project.id} project={project} controls={controls} search={search} statusFilter={statusFilter} canApprove={canApprove} canManage={canManage} onCreate={() => setForm({ project })} onEdit={(item) => setForm({ project, item })} />)}</div>}
      {form && <ChangeOrderForm projects={projects} project={form.project} item={form.item} canApprove={canApprove} onClose={close} onSaved={saved} />}
    </div>
  );
}

export default ChangeOrders;