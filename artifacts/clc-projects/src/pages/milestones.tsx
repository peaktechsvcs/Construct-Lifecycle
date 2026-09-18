import { useState } from 'react';
import { Link } from 'wouter';
import { CalendarClock, Pencil, Plus } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Project, ProjectScheduleItem, ProjectScheduleItemInput, ProjectScheduleItemUpdate,
  useListProjects, getListProjectsQueryKey, useGetProjectControls, getGetProjectControlsQueryKey,
  useCreateProjectScheduleItem, useUpdateProjectScheduleItem,
} from '@workspace/api-client-react';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle, shortDate } from '@/components/app-ui';

type Draft = { itemNumber: string; name: string; itemType: string; plannedStart: string; plannedEnd: string; actualStart: string; actualEnd: string; status: string; ownerName: string; predecessor: string };
const empty: Draft = { itemNumber: '', name: '', itemType: 'milestone', plannedStart: '', plannedEnd: '', actualStart: '', actualEnd: '', status: 'planned', ownerName: '', predecessor: '' };
const dateValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
const tone = (value: string) => value === 'complete' ? 'green' as const : value === 'delayed' ? 'red' as const : value === 'in_progress' ? 'orange' as const : 'teal' as const;

function getMilestoneSaveError(error: unknown) {
  if (error && typeof error === 'object') {
    const apiError = error as { status?: unknown; data?: unknown };
    const data = apiError.data && typeof apiError.data === 'object' ? apiError.data as { error?: unknown } : undefined;
    if (apiError.status === 400 && data?.error === 'Invalid schedule update') {
      return 'Milestone details are not valid. Check the milestone number, name, dates, and status.';
    }
    if (apiError.status === 403) {
      return 'You do not have permission to edit milestones in this workspace. Ask a workspace administrator for access.';
    }
  }
  return 'The milestone could not be saved. Check the fields and try again.';
}

function MilestoneEditor({ draft, setDraft, onSave, pending, editing }: { draft: Draft; setDraft: (draft: Draft) => void; onSave: () => void; pending: boolean; editing: boolean }) {
  const field = (label: string, key: keyof Draft, type = 'text') => <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">{label}</span><Input data-testid={`input-milestone-${key}`} type={type} value={draft[key]} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })} className="h-9 bg-background text-xs" /></label>;
  return <div className="mt-4 border-t border-border pt-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{field('Milestone number', 'itemNumber')}{field('Name', 'name')}{field('Planned start', 'plannedStart', 'date')}{field('Planned finish', 'plannedEnd', 'date')}{field('Actual start', 'actualStart', 'date')}{field('Actual finish', 'actualEnd', 'date')}{field('Owner', 'ownerName')}{field('Predecessor', 'predecessor')}
    <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">Status</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })} className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs"><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="delayed">Delayed</option></select></label>
  </div><Button data-testid="button-save-milestone" className="mt-4 px-3 py-2 text-xs" disabled={pending || !draft.itemNumber.trim() || !draft.name.trim()} onClick={onSave}>{pending ? 'Saving…' : editing ? 'Save milestone' : 'Add milestone'}</Button></div>;
}

function MilestoneProject({ project }: { project: Project }) {
  const qc = useQueryClient();
  const controls = useGetProjectControls(project.id, { query: { queryKey: getGetProjectControlsQueryKey(project.id) } });
  const create = useCreateProjectScheduleItem();
  const update = useUpdateProjectScheduleItem();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(empty);
  const [feedback, setFeedback] = useState('');
  const [saveError, setSaveError] = useState(false);
  const items = (controls.data?.scheduleItems ?? []).filter((item) => item.itemType === 'milestone');
  const open = (item?: ProjectScheduleItem) => {
    setEditingId(item?.id ?? null);
    setDraft(item ? { itemNumber: item.itemNumber, name: item.name, itemType: item.itemType, plannedStart: dateValue(item.plannedStart), plannedEnd: dateValue(item.plannedEnd), actualStart: dateValue(item.actualStart), actualEnd: dateValue(item.actualEnd), status: item.status, ownerName: item.ownerName ?? '', predecessor: item.predecessor ?? '' } : { ...empty });
    setFeedback('');
    setSaveError(false);
  };
  const saveItem = () => {
    const data = {
      itemNumber: draft.itemNumber.trim(), name: draft.name.trim(), itemType: draft.itemType as ProjectScheduleItemInput['itemType'],
      plannedStart: draft.plannedStart || undefined, plannedEnd: draft.plannedEnd || undefined, actualStart: draft.actualStart || undefined, actualEnd: draft.actualEnd || undefined,
      status: draft.status as ProjectScheduleItemInput['status'], ownerName: draft.ownerName.trim() || undefined, predecessor: draft.predecessor.trim() || undefined,
    };
    const done = { onSuccess: () => { qc.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(project.id) }); setEditingId(null); setDraft(empty); setFeedback('Milestone saved.'); setSaveError(false); }, onError: (error: unknown) => { setFeedback(getMilestoneSaveError(error)); setSaveError(true); } };
    if (editingId) update.mutate({ projectId: project.id, itemId: editingId, data: data as ProjectScheduleItemUpdate }, done);
    else create.mutate({ projectId: project.id, data }, done);
  };
  if (controls.isLoading) return <div className="rounded-xl border border-border bg-card p-5"><LoadingPanel lines={3} /></div>;
  if (controls.isError) return <ErrorPanel title={`${project.projectName} schedule unavailable`} text="Milestones could not be loaded." onRetry={() => controls.refetch()} />;
  return <article className="rounded-xl border border-border bg-card p-4 md:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><p className="mono text-[10px] text-accent">{project.projectNumber}</p><Link href={`/projects/${project.id}`} data-testid={`link-milestone-project-${project.id}`} className="text-base font-bold hover:text-primary hover:underline">{project.projectName}</Link><p className="text-xs text-muted-foreground">{project.customerName}</p></div><div className="flex gap-2"><Button data-testid={`button-add-milestone-${project.id}`} variant="outline" className="px-3 py-1.5 text-xs" onClick={() => open()}><Plus size={13} /> Add milestone</Button><Link href={`/projects/${project.id}`} className="rounded-md px-2 py-1.5 text-xs font-semibold text-primary hover:bg-secondary">Project detail</Link></div></div>
      {feedback && <p data-testid="milestone-save-feedback" role={saveError ? 'alert' : 'status'} className={`mt-3 text-xs ${saveError ? 'text-destructive' : 'text-status-success'}`}>{feedback}</p>}
    {editingId === null && draft !== empty && <MilestoneEditor draft={draft} setDraft={setDraft} onSave={saveItem} pending={create.isPending || update.isPending} editing={false} />}
     {items.length === 0 ? <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">No milestones have been entered for this project.</p> : <div className="mt-4 overflow-x-auto border-t border-border pt-2"><div className="min-w-[720px] divide-y divide-border">{items.map((item) => <div key={item.id} className="grid grid-cols-[90px_1.4fr_110px_120px_120px_42px] items-center gap-3 py-3"><p className="mono text-[10px] text-muted-foreground">{item.itemNumber}</p><p className="text-sm font-semibold">{item.name}<span className="block text-[10px] font-normal text-muted-foreground">{item.ownerName || 'Owner not assigned'}</span></p><span data-testid={`milestone-status-${item.id}`}><Badge tone={tone(item.status)}>{item.status.replace(/_/g, ' ')}</Badge></span><p className="text-xs">{shortDate(item.plannedStart)} — {shortDate(item.plannedEnd)}</p><p className="text-xs text-muted-foreground">{item.actualEnd ? `Actual ${shortDate(item.actualEnd)}` : 'Not complete'}</p><Button data-testid={`button-edit-milestone-${item.id}`} variant="ghost" aria-label={`Edit ${item.name}`} className="px-2" onClick={() => open(item)}><Pencil size={14} /></Button></div>)}</div></div>}
    {editingId !== null && <MilestoneEditor draft={draft} setDraft={setDraft} onSave={saveItem} pending={create.isPending || update.isPending} editing />}
  </article>;
}

export function Milestones() {
  const projects = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey() } });
  if (projects.isLoading) return <LoadingPanel lines={7} />;
  if (projects.isError) return <ErrorPanel title="Milestones are unavailable" text="Projects could not be loaded for this environment." onRetry={() => projects.refetch()} />;
  const items = projects.data ?? [];
  return <div data-testid="milestones-page" className="animate-rise"><PageTitle eyebrow="Project controls" title="Milestones" description="Keep schedule commitments visible, owned, and traceable to the project record." />{items.length === 0 ? <EmptyState icon={CalendarClock} title="No projects to review" text="Milestones will appear here when projects are available." /> : <div className="space-y-3">{items.map((project) => <MilestoneProject key={project.id} project={project} />)}</div>}</div>;
}