import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import { FileCheck2, Plus, Trash2 } from 'lucide-react';
import {
  Project,
  ProjectContractInput,
  useGetProjectControls,
  getGetProjectControlsQueryKey,
  useListProjects,
  getListProjectsQueryKey,
  useUpsertProjectContract,
} from '@workspace/api-client-react';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle, currency, shortDate } from '@/components/app-ui';
import { useQueryClient } from '@tanstack/react-query';

type Participant = { participantType: string; organizationName: string; contactName: string; contactEmail: string; role: string };
type Draft = {
  contractNumber: string; deliveryMethod: string; originalValue: string; currentValue: string;
  contractStart: string; contractEnd: string; noticeToProceed: string; paymentTerms: string;
  retainagePercent: string; retainageCap: string; approvalStatus: string; status: string; documentUrl: string;
};
const blankDraft: Draft = { contractNumber: '', deliveryMethod: 'design_bid_build', originalValue: '0', currentValue: '0', contractStart: '', contractEnd: '', noticeToProceed: '', paymentTerms: 'Net 30', retainagePercent: '10', retainageCap: '', approvalStatus: 'draft', status: 'active', documentUrl: '' };
const blankParticipant = (): Participant => ({ participantType: 'owner', organizationName: '', contactName: '', contactEmail: '', role: '' });
const dateValue = (value?: string | null) => value ? new Date(value).toISOString().slice(0, 10) : '';
const tone = (value: string) => ['approved', 'active', 'complete'].includes(value) ? 'green' as const : ['pending', 'draft'].includes(value) ? 'orange' as const : value === 'rejected' ? 'red' as const : 'teal' as const;

function ContractRow({ project }: { project: Project }) {
  const qc = useQueryClient();
  const controls = useGetProjectControls(project.id, { query: { queryKey: getGetProjectControlsQueryKey(project.id) } });
  const save = useUpsertProjectContract();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [feedback, setFeedback] = useState('');
  const contract = controls.data?.contract;

  useEffect(() => {
    if (!contract) return;
    setDraft({
      contractNumber: contract.contractNumber, deliveryMethod: contract.deliveryMethod,
      originalValue: String(contract.originalValue), currentValue: String(contract.currentValue),
      contractStart: dateValue(contract.contractStart), contractEnd: dateValue(contract.contractEnd),
      noticeToProceed: dateValue(contract.noticeToProceed), paymentTerms: contract.paymentTerms ?? '',
      retainagePercent: String(contract.retainagePercent), retainageCap: contract.retainageCap == null ? '' : String(contract.retainageCap),
      approvalStatus: contract.approvalStatus, status: contract.status, documentUrl: contract.documentUrl ?? '',
    });
    setParticipants(contract.participants.map((item) => ({ participantType: item.participantType, organizationName: item.organizationName, contactName: item.contactName ?? '', contactEmail: item.contactEmail ?? '', role: item.role ?? '' })));
  }, [contract]);

  const set = (key: keyof Draft, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const saveContract = () => {
    const data: ProjectContractInput = {
      contractNumber: draft.contractNumber.trim(), deliveryMethod: draft.deliveryMethod,
      originalValue: Number(draft.originalValue) || 0, currentValue: Number(draft.currentValue) || 0,
      ...(draft.contractStart ? { contractStart: draft.contractStart } : {}),
      ...(draft.contractEnd ? { contractEnd: draft.contractEnd } : {}),
      ...(draft.noticeToProceed ? { noticeToProceed: draft.noticeToProceed } : {}),
      paymentTerms: draft.paymentTerms.trim() || undefined, retainagePercent: Number(draft.retainagePercent) || 0,
      ...(draft.retainageCap ? { retainageCap: Number(draft.retainageCap) || 0 } : {}),
      approvalStatus: draft.approvalStatus as ProjectContractInput['approvalStatus'],
      status: draft.status as ProjectContractInput['status'], documentUrl: draft.documentUrl.trim() || undefined,
      participants: participants.filter((item) => item.organizationName.trim()).map((item) => ({ ...item, organizationName: item.organizationName.trim(), contactName: item.contactName.trim() || undefined, contactEmail: item.contactEmail.trim() || undefined, role: item.role.trim() || undefined })),
    };
    save.mutate({ projectId: project.id, data }, {
      onSuccess: () => { qc.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(project.id) }); setFeedback('Contract saved.'); setEditing(false); },
      onError: () => setFeedback('The contract could not be saved. Check the fields and try again.'),
    });
  };
  if (controls.isLoading) return <div className="rounded-xl border border-border bg-card p-5"><LoadingPanel lines={3} /></div>;
  if (controls.isError) return <ErrorPanel title={`${project.projectName} controls unavailable`} text="Contract details could not be loaded." onRetry={() => controls.refetch()} />;

  return (
    <article className="rounded-xl border border-border bg-card p-4 md:p-5">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <p className="mono text-[10px] text-accent">{project.projectNumber}</p>
          <Link href={`/projects/${project.id}`} className="text-base font-bold hover:text-primary hover:underline">{project.projectName}</Link>
          <p className="text-xs text-muted-foreground">{project.customerName} · {project.address || 'Address not provided'}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {contract && <Badge tone={tone(contract.status)}>{contract.status}</Badge>}
          <Button variant="outline" className="px-3 py-1.5 text-xs" onClick={() => { setFeedback(''); setEditing((value) => !value); }}>{editing ? 'Close editor' : 'Edit contract'}</Button>
          <Link href={`/projects/${project.id}`} className="rounded-md px-2 py-1.5 text-xs font-semibold text-primary hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Project detail</Link>
        </div>
      </div>
      {feedback && <p role="status" className="mt-3 text-xs text-status-success">{feedback}</p>}
      {contract ? (
        <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 xl:grid-cols-4">
          <div><p className="mono text-[9px] uppercase text-muted-foreground">Contract / approval</p><p className="mt-1 text-sm font-semibold">{contract.contractNumber} · <Badge tone={tone(contract.approvalStatus)}>{contract.approvalStatus}</Badge></p></div>
          <div><p className="mono text-[9px] uppercase text-muted-foreground">Current value</p><p className="mt-1 text-sm font-semibold">{currency.format(contract.currentValue)}</p></div>
          <div><p className="mono text-[9px] uppercase text-muted-foreground">Delivery / dates</p><p className="mt-1 text-sm font-semibold">{contract.deliveryMethod.replace(/_/g, ' ')} · {shortDate(contract.contractStart)} — {shortDate(contract.contractEnd)}</p></div>
          <div><p className="mono text-[9px] uppercase text-muted-foreground">Terms / participants</p><p className="mt-1 text-sm font-semibold">{contract.paymentTerms || 'Terms not entered'} · {contract.participants.length} listed</p></div>
        </div>
      ) : <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">No contract has been entered for this project yet.</p>}
      {editing && <ContractEditor draft={draft} set={set} participants={participants} setParticipants={setParticipants} onSave={saveContract} pending={save.isPending} />}
    </article>
  );
}

function ContractEditor({ draft, set, participants, setParticipants, onSave, pending }: { draft: Draft; set: (key: keyof Draft, value: string) => void; participants: Participant[]; setParticipants: (items: Participant[]) => void; onSave: () => void; pending: boolean }) {
  const field = (label: string, key: keyof Draft, type = 'text') => <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">{label}</span><Input type={type} value={draft[key]} onChange={(event) => set(key, event.target.value)} className="h-9 bg-background text-xs" /></label>;
  return <div className="mt-5 border-t border-border pt-4">
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{field('Contract number', 'contractNumber')}{field('Original value', 'originalValue', 'number')}{field('Current value', 'currentValue', 'number')}{field('Retainage %', 'retainagePercent', 'number')}{field('Start', 'contractStart', 'date')}{field('End', 'contractEnd', 'date')}{field('Notice to proceed', 'noticeToProceed', 'date')}{field('Retainage cap', 'retainageCap', 'number')}
      <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">Delivery method</span><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs" value={draft.deliveryMethod} onChange={(event) => set('deliveryMethod', event.target.value)}><option value="design_bid_build">Design-bid-build</option><option value="design_build">Design-build</option><option value="construction_manager_at_risk">CM at risk</option><option value="negotiated">Negotiated</option></select></label>
      <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">Approval</span><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs" value={draft.approvalStatus} onChange={(event) => set('approvalStatus', event.target.value)}><option value="draft">Draft</option><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
      <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">Status</span><select className="h-9 w-full rounded-md border border-input bg-background px-3 text-xs" value={draft.status} onChange={(event) => set('status', event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="complete">Complete</option></select></label>
      <div className="sm:col-span-2 lg:col-span-4"><label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">Payment terms</span><Textarea value={draft.paymentTerms} onChange={(event) => set('paymentTerms', event.target.value)} rows={2} className="bg-background text-xs" /></label></div>
      {field('Document URL', 'documentUrl', 'url')}</div>
    <div className="mt-4"><div className="flex items-center justify-between"><p className="text-xs font-bold">Participants</p><Button variant="outline" className="px-2 py-1 text-[10px]" onClick={() => setParticipants([...participants, blankParticipant()])}><Plus size={12} /> Add participant</Button></div>
      <div className="mt-2 space-y-2">{participants.map((item, index) => <div key={index} className="grid gap-2 rounded-md border border-border bg-secondary/25 p-3 sm:grid-cols-2 lg:grid-cols-5">{(['participantType', 'organizationName', 'contactName', 'contactEmail', 'role'] as const).map((key) => <Input key={key} aria-label={key.replace(/([A-Z])/g, ' $1')} placeholder={key.replace(/([A-Z])/g, ' $1')} value={item[key]} onChange={(event) => setParticipants(participants.map((current, i) => i === index ? { ...current, [key]: event.target.value } : current))} className="h-8 bg-background text-xs" />)}<Button variant="ghost" aria-label={`Remove participant ${index + 1}`} className="justify-self-start px-2 text-xs text-status-danger lg:col-start-5" onClick={() => setParticipants(participants.filter((_, i) => i !== index))}><Trash2 size={13} /> Remove</Button></div>)}</div>
    </div>
    <Button className="mt-4 px-3 py-2 text-xs" disabled={pending || !draft.contractNumber.trim()} onClick={onSave}>{pending ? 'Saving…' : 'Save contract'}</Button>
  </div>;
}

export function Contracts() {
  const projects = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey() } });
  if (projects.isLoading) return <LoadingPanel lines={7} />;
  if (projects.isError) return <ErrorPanel title="Contracts are unavailable" text="Projects could not be loaded for this environment." onRetry={() => projects.refetch()} />;
  const items = projects.data ?? [];
  return <div className="animate-rise"><PageTitle eyebrow="Project controls" title="Contracts" description="Review agreement status, commercial terms, and participants across the current environment." />{items.length === 0 ? <EmptyState icon={FileCheck2} title="No projects to review" text="Contracts will appear here when projects are available." /> : <div className="space-y-3">{items.map((project) => <ContractRow key={project.id} project={project} />)}</div>}</div>;
}