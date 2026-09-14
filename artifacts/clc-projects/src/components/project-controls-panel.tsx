import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  Landmark,
  Plus,
  Receipt,
  ShieldAlert,
  Truck,
  Users,
} from 'lucide-react';
import {
  getGetProjectControlsQueryKey,
  useCreateScheduleOfValue,
  useCreateProjectChangeOrder,
  useCreateProjectCommitment,
  useCreateProjectIssue,
  useCreateProjectScheduleItem,
  useGetProjectControls,
  useSyncProjectAccounting,
  useUpdateProjectFinancials,
  useUpsertProjectContract,
} from '@workspace/api-client-react';
import { Badge, Button, currency, ErrorPanel, LoadingPanel, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';

type FormKind = 'milestone' | 'sov' | 'commitment' | 'issue' | 'change';

const emptyForm: Record<string, string> = {
  number: '',
  name: '',
  vendorName: '',
  value: '',
  subject: '',
  question: '',
  title: '',
  dueDate: '',
  plannedEnd: '',
  responsibleParty: '',
  description: '',
};

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

function Field({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: string; onChange: (value: string) => void; type?: string; placeholder?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">{label}</span>
      <Input type={type} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-9 bg-background text-xs" />
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
  const sovMutation = useCreateScheduleOfValue();
  const commitmentMutation = useCreateProjectCommitment();
  const issueMutation = useCreateProjectIssue();
  const changeMutation = useCreateProjectChangeOrder();
  const accountingSyncMutation = useSyncProjectAccounting();
  const [formKind, setFormKind] = useState<FormKind>();
  const [feedback, setFeedback] = useState('');
  const [form, setForm] = useState(emptyForm);
  const [contractForm, setContractForm] = useState({
    contractNumber: '',
    deliveryMethod: 'design_bid_build',
    currentValue: String(contractValue || 0),
    originalValue: String(contractValue || 0),
    retainagePercent: '10',
    paymentTerms: 'Net 30',
  });
  const [financialForm, setFinancialForm] = useState({ budgetCost: '', forecastCost: '', actualCost: '', forecastRevenue: String(contractValue || 0) });
  const data = query.data;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetProjectControlsQueryKey(projectId) });
  const setContract = (key: string, value: string) => setContractForm((current) => ({ ...current, [key]: value }));
  const setFinancial = (key: string, value: string) => setFinancialForm((current) => ({ ...current, [key]: value }));
  const setValue = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const closeForm = () => {
    setFormKind(undefined);
    setForm(emptyForm);
  };

  const submitForm = (event: React.FormEvent) => {
    event.preventDefault();
    const done = {
      onSuccess: () => { refresh(); setFeedback('Control saved.'); closeForm(); },
      onError: () => setFeedback('The control could not be saved. Check the fields and try again.'),
    };
    if (formKind === 'milestone') {
      scheduleMutation.mutate({ projectId, data: { itemNumber: form.number, name: form.name, plannedEnd: form.plannedEnd || undefined, ownerName: form.responsibleParty || undefined } }, done);
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

  const formPending = scheduleMutation.isPending || sovMutation.isPending || commitmentMutation.isPending || issueMutation.isPending || changeMutation.isPending;
  const forecastMargin = data?.metrics.forecastMargin ?? 0;
  const marginPercent = data?.metrics.contractValue ? Math.round((forecastMargin / data.metrics.contractValue) * 100) : 0;
  const upcomingMilestones = useMemo(() => (data?.scheduleItems ?? []).filter((item) => item.status !== 'complete').slice(0, 4), [data?.scheduleItems]);
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
            <Button key={kind} variant={formKind === kind ? 'primary' : 'outline'} className="px-3 py-2 text-xs" onClick={() => setFormKind(formKind === kind ? undefined : kind)}>
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
            <p className="text-sm font-bold">{formKind === 'milestone' ? 'Add schedule milestone' : formKind === 'commitment' ? 'Add subcontractor or supplier commitment' : formKind === 'issue' ? 'Open an RFI or project issue' : 'Create a change request'}</p>
            <button type="button" onClick={closeForm} className="text-xs font-semibold text-muted-foreground hover:text-foreground">Cancel</button>
          </div>
          {formKind === 'milestone' && <div className="grid gap-3 sm:grid-cols-2"><Field label="Item number" value={form.number} onChange={(v) => setValue('number', v)} placeholder="M-010" /><Field label="Milestone" value={form.name} onChange={(v) => setValue('name', v)} placeholder="Owner inspection" /><Field label="Planned finish" type="date" value={form.plannedEnd} onChange={(v) => setValue('plannedEnd', v)} /><Field label="Responsible party" value={form.responsibleParty} onChange={(v) => setValue('responsibleParty', v)} placeholder="Project manager" /></div>}
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
            {data.contract ? <><Row label="Contract" value={`${data.contract.contractNumber} · ${data.contract.deliveryMethod.replace(/_/g, ' ')}`} /><Row label="Current value" value={currency.format(data.contract.currentValue)} /><Row label="Payment terms" value={data.contract.paymentTerms} /><Row label="Retainage" value={`${data.contract.retainagePercent}%`} /><div className="mt-3 flex flex-wrap gap-2">{data.contract.participants.map((participant) => <span key={participant.id} className="inline-flex items-center gap-1.5 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold"><Users size={11} />{participant.organizationName} · {participant.participantType}</span>)}</div></> : <p className="text-xs text-muted-foreground">No control contract has been entered yet. The legacy project contract fields remain visible below.</p>}
            <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-3"><Field label="Contract #" value={contractForm.contractNumber} onChange={(v) => setContract('contractNumber', v)} placeholder="Owner contract number" /><Field label="Current value" type="number" value={contractForm.currentValue} onChange={(v) => setContract('currentValue', v)} /><Field label="Retainage %" type="number" value={contractForm.retainagePercent} onChange={(v) => setContract('retainagePercent', v)} /></div>
             <Button className="mt-3 px-3 py-2 text-xs" disabled={contractMutation.isPending || !contractForm.contractNumber} onClick={() => contractMutation.mutate({ projectId, data: { contractNumber: contractForm.contractNumber, deliveryMethod: contractForm.deliveryMethod, originalValue: Number(contractForm.originalValue) || 0, currentValue: Number(contractForm.currentValue) || 0, retainagePercent: Number(contractForm.retainagePercent) || 0, paymentTerms: contractForm.paymentTerms } }, { onSuccess: () => { refresh(); setFeedback('Contract saved.'); }, onError: () => setFeedback('The contract could not be saved.') })}>{contractMutation.isPending ? 'Saving…' : data.contract ? 'Update contract' : 'Save contract'}</Button>
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
            {upcomingMilestones.length ? <div className="divide-y divide-border">{upcomingMilestones.map((item) => <div key={item.id} className="flex items-center gap-3 py-2.5"><span className={`h-2 w-2 rounded-full ${item.status === 'delayed' ? 'bg-status-warning' : 'bg-primary'}`} /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{item.itemNumber} · {item.name}</p><p className="text-[10px] text-muted-foreground">{item.ownerName || 'Unassigned'} · {shortDate(item.plannedEnd)}</p></div><Badge tone={toneForStatus(item.status)}>{item.status.replace(/_/g, ' ')}</Badge></div>)}</div> : <p className="text-xs text-muted-foreground">No milestones have been added.</p>}
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