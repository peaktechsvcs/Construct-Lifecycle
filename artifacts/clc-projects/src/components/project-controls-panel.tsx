import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Landmark,
  Pencil,
  Plus,
  Receipt,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import {
  ProjectScheduleItem,
  getGetProjectControlsQueryKey,
  useCreateScheduleOfValue,
  useCreateProjectChangeOrder,
  useCreateProjectCommitment,
  useCreateProjectIssue,
  useCreateProjectScheduleItem,
  useGetProjectControls,
  useSyncProjectAccounting,
  useUpdateProjectFinancials,
  useUpdateProjectScheduleItem,
  useUpsertProjectContract,
} from '@workspace/api-client-react';
import { Badge, Button, currency, ErrorPanel, LoadingPanel, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';

type FormKind = 'milestone' | 'sov' | 'commitment' | 'issue' | 'change';

type ParticipantDraft = {
  participantType: string;
  organizationName: string;
  contactName: string;
  contactEmail: string;
  role: string;
};

const emptyParticipant: ParticipantDraft = {
  participantType: 'owner',
  organizationName: '',
  contactName: '',
  contactEmail: '',
  role: '',
};

const emptyForm: Record<string, string> = {
  number: '',
  name: '',
  itemType: 'milestone',
  vendorName: '',
  value: '',
  subject: '',
  question: '',
  title: '',
  dueDate: '',
  plannedStart: '',
  plannedEnd: '',
  actualStart: '',
  actualEnd: '',
  status: 'planned',
  predecessor: '',
  responsibleParty: '',
  description: '',
};

const dateInputValue = (value?: string | Date | null) =>
  value ? new Date(value).toISOString().slice(0, 10) : '';

const selectClassName = 'h-9 w-full rounded-md border border-input bg-background px-3 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-ring';

function toneForStatus(status: string) {
  if (['approved', 'complete', 'closed', 'executed'].includes(status)) return 'green' as const;
  if (['rejected', 'delayed', 'critical'].includes(status)) return 'red' as const;
  if (['pending', 'under_review', 'pending_response'].includes(status)) return 'orange' as const;
  return 'teal' as const;
}

function Metric({ label, value, detail, alert = false }: { label: string; value: string; detail: string; alert?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${alert ? 'border-status-warning/30 bg-status-warning/8' : 'border-border bg-secondary/45'}`}>
      <p className={`mono text-[9px] uppercase tracking-[.11em] ${alert ? 'text-status-warning' : 'text-muted-foreground'}`}>{label}</p>
      <p className="mt-2 text-xl font-bold tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  type = 'text',
  placeholder = '',
  required = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  required?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
        {label}{required ? <span aria-hidden="true" className="text-status-danger"> *</span> : null}
      </span>
      <Input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        required={required}
        className="h-9 bg-background text-xs"
      />
    </label>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-2 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="max-w-[68%] text-right text-xs font-semibold">{value || '—'}</span>
    </div>
  );
}

export function ProjectControlsPanel({ projectId, contractValue, closeoutStatus }: { projectId: number; contractValue: number; closeoutStatus: string }) {
  const qc = useQueryClient();
  const query = useGetProjectControls(projectId, { query: { queryKey: getGetProjectControlsQueryKey(projectId) } });
  const contractMutation = useUpsertProjectContract();
  const financialMutation = useUpdateProjectFinancials();
  const scheduleMutation = useCreateProjectScheduleItem();
  const updateScheduleMutation = useUpdateProjectScheduleItem();
  const sovMutation = useCreateScheduleOfValue();
  const commitmentMutation = useCreateProjectCommitment();
  const issueMutation = useCreateProjectIssue();
  const changeMutation = useCreateProjectChangeOrder();
  const accountingSyncMutation = useSyncProjectAccounting();
  const [formKind, setFormKind] = useState<FormKind>();
  const [editingMilestoneId, setEditingMilestoneId] = useState<number | null>(null);
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [contractForm, setContractForm] = useState({
    contractNumber: '',
    deliveryMethod: 'design_bid_build',
    currentValue: String(contractValue || 0),
    originalValue: String(contractValue || 0),
    contractStart: '',
    contractEnd: '',
    noticeToProceed: '',
    retainagePercent: '10',
    retainageCap: '',
    paymentTerms: 'Net 30',
    approvalStatus: 'draft',
    status: 'active',
    documentUrl: '',
  });
  const [participants, setParticipants] = useState<ParticipantDraft[]>([]);
  const [financialForm, setFinancialForm] = useState({ budgetCost: '', forecastCost: '', actualCost: '', forecastRevenue: String(contractValue || 0) });
  const data = query.data;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(projectId) });
  const setContract = (key: string, value: string) => setContractForm((current) => ({ ...current, [key]: value }));
  const setFinancial = (key: string, value: string) => setFinancialForm((current) => ({ ...current, [key]: value }));
  const setValue = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    if (!data?.contract) return;
    setContractForm({
      contractNumber: data.contract.contractNumber,
      deliveryMethod: data.contract.deliveryMethod,
      currentValue: String(data.contract.currentValue),
      originalValue: String(data.contract.originalValue),
      contractStart: dateInputValue(data.contract.contractStart),
      contractEnd: dateInputValue(data.contract.contractEnd),
      noticeToProceed: dateInputValue(data.contract.noticeToProceed),
      retainagePercent: String(data.contract.retainagePercent),
      retainageCap: data.contract.retainageCap == null ? '' : String(data.contract.retainageCap),
      paymentTerms: data.contract.paymentTerms ?? '',
      approvalStatus: data.contract.approvalStatus,
      status: data.contract.status,
      documentUrl: data.contract.documentUrl ?? '',
    });
    setParticipants(data.contract.participants.map((participant) => ({
      participantType: participant.participantType,
      organizationName: participant.organizationName,
      contactName: participant.contactName ?? '',
      contactEmail: participant.contactEmail ?? '',
      role: participant.role ?? '',
    })));
  }, [data?.contract]);

  const closeForm = () => {
    setFormKind(undefined);
    setEditingMilestoneId(null);
    setForm(emptyForm);
  };

  const openMilestoneForm = (item?: ProjectScheduleItem) => {
    setFormKind('milestone');
    setEditingMilestoneId(item?.id ?? null);
    setForm(item ? {
      number: item.itemNumber,
      name: item.name,
      itemType: item.itemType,
      vendorName: '',
      value: '',
      subject: '',
      question: '',
      title: '',
      dueDate: '',
      plannedStart: dateInputValue(item.plannedStart),
      plannedEnd: dateInputValue(item.plannedEnd),
      actualStart: dateInputValue(item.actualStart),
      actualEnd: dateInputValue(item.actualEnd),
      status: item.status,
      predecessor: item.predecessor ?? '',
      responsibleParty: item.ownerName ?? '',
      description: '',
    } : { ...emptyForm });
  };

  const updateParticipant = (index: number, key: keyof ParticipantDraft, value: string) => {
    setParticipants((current) => current.map((participant, participantIndex) =>
      participantIndex === index ? { ...participant, [key]: value } : participant,
    ));
  };

  const participantPayload = participants
    .filter((participant) => participant.organizationName.trim())
    .map((participant) => ({
      participantType: participant.participantType.trim() || 'other',
      organizationName: participant.organizationName.trim(),
      ...(participant.contactName.trim() ? { contactName: participant.contactName.trim() } : {}),
      ...(participant.contactEmail.trim() ? { contactEmail: participant.contactEmail.trim() } : {}),
      ...(participant.role.trim() ? { role: participant.role.trim() } : {}),
    }));

  const saveContract = () => {
    contractMutation.mutate({
      projectId,
      data: {
        contractNumber: contractForm.contractNumber.trim(),
        deliveryMethod: contractForm.deliveryMethod,
        originalValue: Number(contractForm.originalValue) || 0,
        currentValue: Number(contractForm.currentValue) || 0,
        ...(contractForm.contractStart ? { contractStart: contractForm.contractStart } : {}),
        ...(contractForm.contractEnd ? { contractEnd: contractForm.contractEnd } : {}),
        ...(contractForm.noticeToProceed ? { noticeToProceed: contractForm.noticeToProceed } : {}),
        paymentTerms: contractForm.paymentTerms.trim() || undefined,
        retainagePercent: Number(contractForm.retainagePercent) || 0,
        ...(contractForm.retainageCap ? { retainageCap: Number(contractForm.retainageCap) || 0 } : {}),
        approvalStatus: contractForm.approvalStatus as 'draft' | 'pending' | 'approved' | 'rejected',
        status: contractForm.status as 'active' | 'suspended' | 'complete',
        documentUrl: contractForm.documentUrl.trim() || undefined,
        participants: participantPayload,
      },
    }, {
      onSuccess: () => { refresh(); setFeedback('Contract saved.'); },
      onError: () => setFeedback('The contract could not be saved. Check the fields and try again.'),
    });
  };

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault();
    const done = {
      onSuccess: () => { refresh(); setFeedback('Control saved.'); closeForm(); },
      onError: () => setFeedback('The control could not be saved. Check the fields and try again.'),
    };
    if (formKind === 'milestone') {
      const milestoneData = {
        itemNumber: form.number.trim(),
        name: form.name.trim(),
        itemType: form.itemType as 'milestone' | 'activity' | 'dependency',
        predecessor: form.predecessor.trim() || undefined,
        plannedStart: form.plannedStart || undefined,
        plannedEnd: form.plannedEnd || undefined,
        actualStart: form.actualStart || undefined,
        actualEnd: form.actualEnd || undefined,
        status: form.status as 'planned' | 'in_progress' | 'complete' | 'delayed',
        ownerName: form.responsibleParty.trim() || undefined,
      };
      if (editingMilestoneId) {
        updateScheduleMutation.mutate({ projectId, itemId: editingMilestoneId, data: milestoneData }, done);
      } else {
        scheduleMutation.mutate({ projectId, data: milestoneData }, done);
      }
    } else if (formKind === 'sov') {
      sovMutation.mutate({ projectId, data: { lineNumber: form.number, description: form.name, scheduledValue: Number(form.value) || 0 } }, done);
    } else if (formKind === 'commitment') {
      commitmentMutation.mutate({ projectId, data: { commitmentNumber: form.number, commitmentType: 'subcontract', vendorName: form.vendorName, committedValue: Number(form.value) || 0, description: form.description || undefined, dueDate: form.dueDate || undefined } }, done);
    } else if (formKind === 'issue') {
      issueMutation.mutate({ projectId, data: { issueType: 'rfi', subject: form.subject, question: form.question, responsibleParty: form.responsibleParty || undefined, dueDate: form.dueDate || undefined } }, done);
    } else if (formKind === 'change') {
      changeMutation.mutate({ projectId, data: { changeNumber: form.number, changeType: 'change_request', title: form.title, proposedValue: Number(form.value) || 0, description: form.description || undefined, scheduleImpactDays: 0 } }, done);
    }
  };

  const formPending = scheduleMutation.isPending || updateScheduleMutation.isPending || sovMutation.isPending || commitmentMutation.isPending || issueMutation.isPending || changeMutation.isPending;
  const forecastMargin = data?.metrics.forecastMargin ?? 0;
  const marginPercent = data?.metrics.contractValue ? Math.round((forecastMargin / data.metrics.contractValue) * 100) : 0;
  const upcomingMilestones = useMemo(() => (data?.scheduleItems ?? []).slice(0, 6), [data?.scheduleItems]);
  const latestAccountingSync = useMemo(() => [...(data?.accountingSyncs ?? [])].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())[0], [data?.accountingSyncs]);

  if (query.isLoading) return <LoadingPanel lines={5} />;
  if (query.isError || !data) return <ErrorPanel title="Project controls are unavailable" text="The project loaded, but its controls could not be retrieved." onRetry={() => query.refetch()} />;

  return (
    <section className="mt-5 rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-start">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.14em] text-accent">General contractor controls</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">Control center</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-muted-foreground">Track the contract, commitments, decisions, changes, billing position, and closeout readiness without leaving this project.</p>
          {feedback && <p role={feedback.startsWith('The') ? 'alert' : 'status'} aria-live="polite" className={`mt-2 text-xs ${feedback.startsWith('The') ? 'text-destructive' : 'text-status-success'}`}>{feedback}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {([
            ['milestone', 'Milestone'],
            ['sov', 'SOV line'],
            ['commitment', 'Commitment'],
            ['issue', 'RFI / issue'],
            ['change', 'Change request'],
          ] as [FormKind, string][]).map(([kind, label]) => (
            <Button
              key={kind}
              variant={formKind === kind ? 'primary' : 'outline'}
              className="px-3 py-2 text-xs"
              onClick={() => kind === 'milestone'
                ? (formKind === kind ? closeForm() : openMilestoneForm())
                : setFormKind(formKind === kind ? undefined : kind)}
            >
              <Plus size={13} /> {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Committed cost" value={currency.format(data.metrics.committedCost)} detail={`${data.commitments.length} commitments`} />
        <Metric label="Forecast margin" value={`${currency.format(forecastMargin)} · ${marginPercent}%`} detail={`Forecast cost ${currency.format(data.metrics.forecastCost)}`} alert={forecastMargin < 0} />
        <Metric label="Schedule risk" value={`${data.metrics.scheduleRiskDays} days`} detail={`${data.metrics.openIssues} open decisions`} alert={data.metrics.scheduleRiskDays > 0 || data.metrics.overdueIssues > 0} />
        <Metric label="Closeout readiness" value={`${data.metrics.closeoutReadiness}%`} detail={`${closeoutStatus.replace(/_/g, ' ')} · ${currency.format(data.metrics.retainageHeld)} retainage`} />
      </div>

      {formKind && (
        <form onSubmit={submitForm} className="mt-5 rounded-lg border border-primary/25 bg-primary/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-sm font-bold">{formKind === 'milestone' ? (editingMilestoneId ? 'Edit schedule milestone' : 'Add schedule milestone') : formKind === 'commitment' ? 'Add subcontractor or supplier commitment' : formKind === 'issue' ? 'Open an RFI or project issue' : 'Create a change request'}</p>
            <button type="button" onClick={closeForm} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
           {formKind === 'milestone' && (
             <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
               <Field label="Item number" value={form.number} onChange={(v) => setValue('number', v)} placeholder="M-010" required />
               <Field label="Milestone" value={form.name} onChange={(v) => setValue('name', v)} placeholder="Owner inspection" required />
               <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Type</span><select className={selectClassName} value={form.itemType} onChange={(event) => setValue('itemType', event.target.value)}><option value="milestone">Milestone</option><option value="activity">Activity</option><option value="dependency">Dependency</option></select></label>
               <Field label="Planned start" type="date" value={form.plannedStart} onChange={(v) => setValue('plannedStart', v)} />
               <Field label="Planned finish" type="date" value={form.plannedEnd} onChange={(v) => setValue('plannedEnd', v)} />
               <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Status</span><select className={selectClassName} value={form.status} onChange={(event) => setValue('status', event.target.value)}><option value="planned">Planned</option><option value="in_progress">In progress</option><option value="complete">Complete</option><option value="delayed">Delayed</option></select></label>
               <Field label="Actual start" type="date" value={form.actualStart} onChange={(v) => setValue('actualStart', v)} />
               <Field label="Actual finish" type="date" value={form.actualEnd} onChange={(v) => setValue('actualEnd', v)} />
               <Field label="Predecessor" value={form.predecessor} onChange={(v) => setValue('predecessor', v)} placeholder="M-005" />
               <Field label="Responsible party" value={form.responsibleParty} onChange={(v) => setValue('responsibleParty', v)} placeholder="Project manager" />
             </div>
           )}
          {formKind === 'sov' && <div className="grid gap-3 sm:grid-cols-3"><Field label="Line number" value={form.number} onChange={(v) => setValue('number', v)} placeholder="01-100" /><Field label="Description" value={form.name} onChange={(v) => setValue('name', v)} placeholder="Site concrete" /><Field label="Scheduled value" type="number" value={form.value} onChange={(v) => setValue('value', v)} /></div>}
          {formKind === 'commitment' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Commitment number" value={form.number} onChange={(v) => setValue('number', v)} placeholder="SC-001" /><Field label="Vendor / subcontractor" value={form.vendorName} onChange={(v) => setValue('vendorName', v)} /><Field label="Committed value" type="number" value={form.value} onChange={(v) => setValue('value', v)} /><Field label="Due date" type="date" value={form.dueDate} onChange={(v) => setValue('dueDate', v)} /><div className="sm:col-span-2"><Field label="Scope description" value={form.description} onChange={(v) => setValue('description', v)} /></div></div>}
          {formKind === 'issue' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Subject" value={form.subject} onChange={(v) => setValue('subject', v)} placeholder="Clarify storefront detail" /><Field label="Responsible party" value={form.responsibleParty} onChange={(v) => setValue('responsibleParty', v)} /><Field label="Due date" type="date" value={form.dueDate} onChange={(v) => setValue('dueDate', v)} /><div className="sm:col-span-2"><label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Question</span><Textarea value={form.question} onChange={(event) => setValue('question', event.target.value)} rows={3} className="bg-background text-xs" /></label></div></div>}
          {formKind === 'change' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Change number" value={form.number} onChange={(v) => setValue('number', v)} placeholder="COR-001" /><Field label="Title" value={form.title} onChange={(v) => setValue('title', v)} /><Field label="Proposed value" type="number" value={form.value} onChange={(v) => setValue('value', v)} /><div className="sm:col-span-2"><Field label="Description" value={form.description} onChange={(v) => setValue('description', v)} /></div></div>}
          <div className="mt-4 flex justify-end"><Button type="submit" disabled={formPending}>{formPending ? 'Saving…' : 'Save control'}</Button></div>
        </form>
      )}

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="space-y-5">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Landmark size={15} className="text-primary" /><h3 className="text-sm font-bold">Contract & participants</h3></div>{data.contract && <Badge tone={toneForStatus(data.contract.approvalStatus)}>{data.contract.approvalStatus}</Badge>}</div>
             {data.contract ? (
               <>
                 <Row label="Contract" value={`${data.contract.contractNumber} · ${data.contract.deliveryMethod.replace(/_/g, ' ')}`} />
                 <Row label="Value" value={`${currency.format(data.contract.currentValue)} current · ${currency.format(data.contract.originalValue)} original`} />
                 <Row label="Contract window" value={`${shortDate(data.contract.contractStart)} — ${shortDate(data.contract.contractEnd)}`} />
                 <Row label="Notice to proceed" value={shortDate(data.contract.noticeToProceed)} />
                 <Row label="Payment terms" value={data.contract.paymentTerms} />
                 <Row label="Retainage" value={`${data.contract.retainagePercent}%${data.contract.retainageCap == null ? '' : ` · capped at ${currency.format(data.contract.retainageCap)}`}`} />
                 {data.contract.documentUrl && <a href={data.contract.documentUrl} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-xs font-semibold text-primary hover:underline">Open contract document</a>}
                 <div className="mt-3 flex flex-wrap gap-2">
                   {data.contract.participants.map((participant) => (
                     <span key={participant.id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold">
                       <Users size={11} />{participant.organizationName} · {participant.participantType}
                     </span>
                   ))}
                 </div>
               </>
             ) : <p className="text-xs text-muted-foreground">No control contract has been entered yet. Add the owner agreement and key participants below.</p>}
             <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2 lg:grid-cols-3">
               <Field label="Contract #" value={contractForm.contractNumber} onChange={(v) => setContract('contractNumber', v)} placeholder="Owner contract number" required />
               <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Delivery method</span><select className={selectClassName} value={contractForm.deliveryMethod} onChange={(event) => setContract('deliveryMethod', event.target.value)}><option value="design_bid_build">Design-bid-build</option><option value="design_build">Design-build</option><option value="construction_manager_at_risk">CM at risk</option><option value="negotiated">Negotiated</option></select></label>
               <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Approval</span><select className={selectClassName} value={contractForm.approvalStatus} onChange={(event) => setContract('approvalStatus', event.target.value)}><option value="draft">Draft</option><option value="pending">Pending review</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
               <Field label="Original value" type="number" value={contractForm.originalValue} onChange={(v) => setContract('originalValue', v)} required />
               <Field label="Current value" type="number" value={contractForm.currentValue} onChange={(v) => setContract('currentValue', v)} required />
               <label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Contract status</span><select className={selectClassName} value={contractForm.status} onChange={(event) => setContract('status', event.target.value)}><option value="active">Active</option><option value="suspended">Suspended</option><option value="complete">Complete</option></select></label>
               <Field label="Contract start" type="date" value={contractForm.contractStart} onChange={(v) => setContract('contractStart', v)} />
               <Field label="Contract end" type="date" value={contractForm.contractEnd} onChange={(v) => setContract('contractEnd', v)} />
               <Field label="Notice to proceed" type="date" value={contractForm.noticeToProceed} onChange={(v) => setContract('noticeToProceed', v)} />
               <Field label="Retainage %" type="number" value={contractForm.retainagePercent} onChange={(v) => setContract('retainagePercent', v)} />
               <Field label="Retainage cap" type="number" value={contractForm.retainageCap} onChange={(v) => setContract('retainageCap', v)} placeholder="Optional" />
               <Field label="Document URL" type="url" value={contractForm.documentUrl} onChange={(v) => setContract('documentUrl', v)} placeholder="https://…" />
               <div className="sm:col-span-2 lg:col-span-3"><label className="block"><span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">Payment terms</span><Textarea value={contractForm.paymentTerms} onChange={(event) => setContract('paymentTerms', event.target.value)} rows={2} className="bg-background text-xs" placeholder="Net 30, monthly pay applications, retainage release terms…" /></label></div>
             </div>
             <div className="mt-4 border-t border-border pt-4">
               <div className="mb-3 flex items-center justify-between gap-3"><div><p className="text-xs font-bold">Contract participants</p><p className="text-[10px] text-muted-foreground">Store only the contacts needed to coordinate this agreement.</p></div><Button type="button" variant="outline" className="px-2.5 py-1.5 text-[10px]" onClick={() => setParticipants((current) => [...current, { ...emptyParticipant }])}><Plus size={12} /> Add participant</Button></div>
               <div className="space-y-3">
                 {participants.map((participant, index) => (
                   <div key={index} className="grid gap-2 rounded-md border border-border/70 bg-secondary/25 p-3 sm:grid-cols-2 lg:grid-cols-5">
                     <label className="block"><span className="mb-1 block text-[10px] font-semibold text-muted-foreground">Type</span><select className={selectClassName} value={participant.participantType} onChange={(event) => updateParticipant(index, 'participantType', event.target.value)}><option value="owner">Owner</option><option value="architect">Architect</option><option value="contractor">Contractor</option><option value="consultant">Consultant</option><option value="lender">Lender</option><option value="other">Other</option></select></label>
                     <Field label="Organization" value={participant.organizationName} onChange={(value) => updateParticipant(index, 'organizationName', value)} required />
                     <Field label="Contact" value={participant.contactName} onChange={(value) => updateParticipant(index, 'contactName', value)} />
                     <Field label="Email" type="email" value={participant.contactEmail} onChange={(value) => updateParticipant(index, 'contactEmail', value)} />
                     <div className="flex items-end gap-2"><div className="min-w-0 flex-1"><Field label="Role" value={participant.role} onChange={(value) => updateParticipant(index, 'role', value)} /></div><button type="button" aria-label={`Remove participant ${index + 1}`} className="mb-0.5 rounded-md p-2 text-muted-foreground hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => setParticipants((current) => current.filter((_, participantIndex) => participantIndex !== index))}>×</button></div>
                   </div>
                 ))}
                 {!participants.length && <p className="text-xs text-muted-foreground">No participants added.</p>}
               </div>
             </div>
              <Button className="mt-4 px-3 py-2 text-xs" disabled={contractMutation.isPending || !contractForm.contractNumber.trim()} onClick={saveContract}>{contractMutation.isPending ? 'Saving…' : data.contract ? 'Update contract' : 'Save contract'}</Button>
          </div>

          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Receipt size={15} className="text-primary" /><h3 className="text-sm font-bold">Budget & forecast</h3></div><Badge tone={forecastMargin >= 0 ? 'green' : 'red'}>{forecastMargin >= 0 ? 'On plan' : 'At risk'}</Badge></div>
            <div className="grid gap-3 sm:grid-cols-3"><Metric label="Budget" value={currency.format(data.financials?.budgetCost ?? 0)} detail="Approved cost plan" /><Metric label="Actual" value={currency.format(data.financials?.actualCost ?? 0)} detail="Recorded to date" /><Metric label="Billed" value={currency.format(data.metrics.billedToDate)} detail={`${currency.format(data.metrics.retainageHeld)} held`} /></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3"><Field label="Budget cost" type="number" value={financialForm.budgetCost} onChange={(v) => setFinancial('budgetCost', v)} /><Field label="Forecast cost" type="number" value={financialForm.forecastCost} onChange={(v) => setFinancial('forecastCost', v)} /><Field label="Actual cost" type="number" value={financialForm.actualCost} onChange={(v) => setFinancial('actualCost', v)} /></div>
             <Button className="mt-3 px-3 py-2 text-xs" disabled={financialMutation.isPending || !financialForm.budgetCost || !financialForm.forecastCost} onClick={() => financialMutation.mutate({ projectId, data: { budgetCost: Number(financialForm.budgetCost), forecastCost: Number(financialForm.forecastCost), actualCost: Number(financialForm.actualCost) || 0, forecastRevenue: Number(financialForm.forecastRevenue) || contractValue, asOfDate: new Date().toISOString().slice(0, 10) } }, { onSuccess: () => { refresh(); setFeedback('Forecast saved.'); }, onError: () => setFeedback('The forecast could not be saved.') })}>{financialMutation.isPending ? 'Saving…' : 'Update forecast'}</Button>
          </div>
        </div>

        <div className="space-y-5">
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><CalendarClock size={15} className="text-primary" /><h3 className="text-sm font-bold">Schedule & milestones</h3></div><Badge tone={data.metrics.scheduleRiskDays ? 'orange' : 'green'}>{data.metrics.scheduleRiskDays ? `${data.metrics.scheduleRiskDays}d risk` : 'On track'}</Badge></div>
             {upcomingMilestones.length ? (
               <div className="divide-y divide-border">
                 {upcomingMilestones.map((item) => (
                   <div key={item.id} className="flex items-center gap-3 py-2.5">
                     <span className={`h-2 w-2 shrink-0 rounded-full ${item.status === 'delayed' ? 'bg-status-warning' : item.status === 'complete' ? 'bg-status-success' : 'bg-primary'}`} />
                     <div className="min-w-0 flex-1">
                       <p className="truncate text-xs font-semibold">{item.itemNumber} · {item.name}</p>
                       <p className="text-[10px] text-muted-foreground">{item.ownerName || 'Unassigned'} · {shortDate(item.plannedStart)} → {shortDate(item.plannedEnd)}</p>
                     </div>
                     <Badge tone={toneForStatus(item.status)}>{item.status.replace(/_/g, ' ')}</Badge>
                     <button type="button" aria-label={`Edit ${item.name}`} className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => openMilestoneForm(item)}><Pencil size={13} /></button>
                   </div>
                 ))}
               </div>
             ) : <p className="text-xs text-muted-foreground">No milestones have been added.</p>}
          </div>
          <div className="rounded-lg border border-border p-4">
            <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Truck size={15} className="text-primary" /><h3 className="text-sm font-bold">Commitments</h3></div><span className="mono text-xs font-bold">{currency.format(data.metrics.committedCost)}</span></div>
            {data.commitments.length ? <div className="divide-y divide-border">{data.commitments.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{item.commitmentNumber} · {item.vendorName}</p><p className="text-[10px] text-muted-foreground">{item.commitmentType.replace(/_/g, ' ')} · Due {shortDate(item.dueDate)}</p></div><span className="mono text-xs font-semibold">{currency.format(item.committedValue)}</span></div>)}</div> : <p className="text-xs text-muted-foreground">No subcontractor or supplier commitments yet.</p>}
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><Receipt size={15} className="text-primary" /><h3 className="text-sm font-bold">Schedule of values</h3></div><span className="mono text-xs font-bold">{currency.format(data.sovLines.reduce((sum, line) => sum + line.scheduledValue, 0))}</span></div>
          {data.sovLines.length ? <div className="divide-y divide-border">{data.sovLines.slice(0, 4).map((line) => <div key={line.id} className="flex items-center gap-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{line.lineNumber} · {line.description}</p><p className="text-[10px] text-muted-foreground">{line.percentComplete}% complete · {currency.format(line.billedToDate)} billed</p></div><span className="mono text-xs font-semibold">{currency.format(line.scheduledValue)}</span></div>)}</div> : <p className="text-xs text-muted-foreground">No schedule-of-values lines have been entered.</p>}
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><ShieldAlert size={15} className="text-primary" /><h3 className="text-sm font-bold">RFIs & decisions</h3></div><Badge tone={data.metrics.overdueIssues ? 'red' : 'teal'}>{data.metrics.openIssues} open</Badge></div>
          {data.issues.length ? <div className="divide-y divide-border">{data.issues.slice(0, 4).map((item) => <div key={item.id} className="flex items-start gap-3 py-2.5"><AlertTriangle size={14} className={item.priority === 'critical' || item.priority === 'high' ? 'mt-0.5 text-status-warning' : 'mt-0.5 text-muted-foreground'} /><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{item.issueNumber} · {item.subject}</p><p className="mt-0.5 text-[10px] text-muted-foreground">{item.responsibleParty || 'No owner'} · Due {shortDate(item.dueDate)}</p></div><Badge tone={toneForStatus(item.status)}>{item.status.replace(/_/g, ' ')}</Badge></div>)}</div> : <p className="text-xs text-muted-foreground">No RFIs or issues have been opened.</p>}
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><FileText size={15} className="text-primary" /><h3 className="text-sm font-bold">Change control</h3></div><Badge tone={data.metrics.pendingChanges ? 'orange' : 'green'}>{data.metrics.pendingChanges} pending</Badge></div>
          {data.changeOrders.length ? <div className="divide-y divide-border">{data.changeOrders.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 py-2.5"><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{item.changeNumber} · {item.title}</p><p className="text-[10px] text-muted-foreground">{item.scheduleImpactDays} schedule days · {item.approvalStatus}</p></div><span className="mono text-xs font-semibold">{currency.format(item.proposedValue)}</span></div>)}</div> : <p className="text-xs text-muted-foreground">No change requests or orders have been recorded.</p>}
        </div>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-2">
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><div className="flex items-center gap-2"><Receipt size={15} className="text-primary" /><h3 className="text-sm font-bold">Owner pay applications</h3></div><div className="flex flex-wrap items-center justify-end gap-2"><Badge tone={data.payApplications.some((item) => item.status === 'rejected') ? 'red' : 'teal'}>{data.payApplications.length} submitted</Badge><Button variant="outline" className="px-2.5 py-1.5 text-[10px]" disabled={accountingSyncMutation.isPending} onClick={() => accountingSyncMutation.mutate({ projectId, data: { providerKey: 'quickbooks' } }, { onSuccess: () => { refresh(); setFeedback('QuickBooks sync completed.'); }, onError: () => setFeedback('QuickBooks sync could not be completed. Check the provider connection and try again.') })}><Landmark size={12} />{accountingSyncMutation.isPending ? 'Syncing…' : 'Sync QuickBooks'}</Button></div></div>
          {data.payApplications.length ? <div className="divide-y divide-border">{data.payApplications.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 py-2.5"><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{item.applicationNumber} · {currency.format(item.netAmount)}</p><p className="text-[10px] text-muted-foreground">{shortDate(item.periodEnd)} · {currency.format(item.retainageAmount)} retainage</p></div><Badge tone={toneForStatus(item.status)}>{item.status}</Badge></div>)}</div> : <p className="text-xs text-muted-foreground">No owner pay applications have been prepared.</p>}
          <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2 text-[10px] text-muted-foreground"><span>Accounting status</span><span className="font-semibold">{latestAccountingSync ? latestAccountingSync.syncStatus.replace(/_/g, ' ') : 'not synced'}</span></div>
        </div>
        <div className="rounded-lg border border-border p-4">
          <div className="mb-3 flex items-center justify-between"><div className="flex items-center gap-2"><CheckCircle2 size={15} className="text-primary" /><h3 className="text-sm font-bold">Closeout requirements</h3></div><Badge tone={data.metrics.closeoutReadiness === 100 ? 'green' : 'orange'}>{data.metrics.closeoutReadiness}% ready</Badge></div>
          {data.closeoutRequirements.length ? <div className="divide-y divide-border">{data.closeoutRequirements.slice(0, 4).map((item) => <div key={item.id} className="flex items-center gap-3 py-2.5"><div className={`h-2 w-2 rounded-full ${['complete', 'waived'].includes(item.status) ? 'bg-status-success' : 'bg-status-warning'}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{item.requirementNumber} · {item.title}</p><p className="text-[10px] text-muted-foreground">{item.responsibleParty || 'Unassigned'} · Due {shortDate(item.dueDate)}</p></div><Badge tone={toneForStatus(item.status)}>{item.status.replace(/_/g, ' ')}</Badge></div>)}</div> : <p className="text-xs text-muted-foreground">No closeout requirements have been defined.</p>}
        </div>
      </div>

      {data.events.length > 0 && <div className="mt-5 border-t border-border pt-4"><p className="mono text-[9px] uppercase tracking-[.11em] text-muted-foreground">Control history</p><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">{data.events.slice(0, 5).map((event) => <span key={event.id} className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground"><CheckCircle2 size={12} className="text-primary" />{event.action.replace(/_/g, ' ')} · {shortDate(event.createdAt)}</span>)}</div></div>}
    </section>
  );
}