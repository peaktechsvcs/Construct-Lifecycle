import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Calculator, CalendarDays, CircleDollarSign, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import {
  Estimate,
  EstimateInput,
  BusinessCustomerInput,
  EstimateIntegrationKind,
  EstimateIntegrationStatus,
  EstimateStage,
  EstimateUpdate,
  useCreateEstimate,
  useDeleteEstimate,
  useGetEstimate,
  useListBids,
  useListEstimates,
  useListTenantMembers,
  useUpdateEstimate,
  getGetEstimateQueryKey,
  getListBidsQueryKey,
  getListEstimatesQueryKey,
  getListTenantMembersQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import { CustomerSelector } from '@/components/customer-selector';
import NotFound from '@/pages/not-found';

const stages: { value: EstimateStage; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'takeoff', label: 'Takeoff' },
  { value: 'estimating', label: 'Estimating' },
  { value: 'review', label: 'Review' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];
const integrationKinds: { value: EstimateIntegrationKind; label: string }[] = [
  { value: 'takeoff_estimating', label: 'Takeoff / estimating' },
  { value: 'accounting', label: 'Accounting' },
  { value: 'pricing', label: 'Pricing' },
  { value: 'other', label: 'Other' },
];
const integrationStatuses: { value: EstimateIntegrationStatus; label: string }[] = [
  { value: 'manual', label: 'Manual estimate' },
  { value: 'pending', label: 'Ready to connect' },
  { value: 'synced', label: 'Synced' },
  { value: 'error', label: 'Sync error' },
];
const tone = (stage: string) => stage === 'approved' ? 'green' as const : stage === 'rejected' ? 'red' as const : stage === 'review' ? 'violet' as const : stage === 'takeoff' || stage === 'estimating' ? 'teal' as const : 'neutral' as const;
const statusTone = (status: EstimateIntegrationStatus) => status === 'synced' ? 'green' as const : status === 'error' ? 'red' as const : status === 'pending' ? 'orange' as const : 'neutral' as const;
const label = (items: { value: string; label: string }[], value: string) => items.find((item) => item.value === value)?.label ?? value;

type FormState = {
  businessCustomerId: string;
  customerName: string;
  newCustomer?: BusinessCustomerInput;
  bidId: string;
  name: string;
  description: string;
  stage: EstimateStage;
  laborValue: string;
  materialValue: string;
  subcontractValue: string;
  otherValue: string;
  contingencyValue: string;
  dueDate: string;
  ownerUserId: string;
  integrationProviderKey: string;
  integrationKind: EstimateIntegrationKind;
  integrationStatus: EstimateIntegrationStatus;
  externalReference: string;
};

const emptyForm: FormState = {
  businessCustomerId: '', customerName: '', bidId: '', name: '', description: '', stage: 'draft',
  laborValue: '', materialValue: '', subcontractValue: '', otherValue: '', contingencyValue: '',
  dueDate: '', ownerUserId: '', integrationProviderKey: '', integrationKind: 'takeoff_estimating',
  integrationStatus: 'manual', externalReference: '',
};

const toForm = (estimate?: Estimate): FormState => estimate ? {
  businessCustomerId: String(estimate.businessCustomerId), customerName: estimate.customerName,
  bidId: estimate.bidId ? String(estimate.bidId) : '',
  name: estimate.name,
  description: estimate.description ?? '',
  stage: estimate.stage,
  laborValue: estimate.laborValue ? String(estimate.laborValue) : '',
  materialValue: estimate.materialValue ? String(estimate.materialValue) : '',
  subcontractValue: estimate.subcontractValue ? String(estimate.subcontractValue) : '',
  otherValue: estimate.otherValue ? String(estimate.otherValue) : '',
  contingencyValue: estimate.contingencyValue ? String(estimate.contingencyValue) : '',
  dueDate: estimate.dueDate?.slice(0, 10) ?? '',
  ownerUserId: estimate.ownerUserId ? String(estimate.ownerUserId) : '',
  integrationProviderKey: estimate.integrationProviderKey ?? '',
  integrationKind: estimate.integrationKind ?? 'takeoff_estimating',
  integrationStatus: estimate.integrationStatus,
  externalReference: estimate.externalReference ?? '',
} : emptyForm;

const numberOrZero = (value: string) => value ? Number(value) : 0;

function EstimateForm({ estimate, onClose, onSaved }: { estimate?: Estimate; onClose: () => void; onSaved: (estimate: Estimate) => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(estimate));
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const bids = useListBids(undefined, { query: { queryKey: getListBidsQueryKey() } });
  const create = useCreateEstimate();
  const update = useUpdateEstimate();
  const pending = create.isPending || update.isPending;
  const availableBids = (bids.data ?? []).filter((bid) => !form.businessCustomerId || bid.businessCustomerId === Number(form.businessCustomerId));
  const total = useMemo(() => [
    form.laborValue, form.materialValue, form.subcontractValue, form.otherValue, form.contingencyValue,
  ].reduce((sum, value) => sum + numberOrZero(value), 0), [form]);

  useEffect(() => setForm(toForm(estimate)), [estimate]);
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const setCustomer = (customer?: { id: number; companyName: string }) => setForm((current) => ({
    ...current, businessCustomerId: customer?.id ? String(customer.id) : '', customerName: customer?.companyName ?? '', newCustomer: undefined,
  }));
  const setCustomerDraft = (draft?: BusinessCustomerInput) => setForm((current) => ({
    ...current, businessCustomerId: '', customerName: draft?.companyName ?? current.customerName, newCustomer: draft,
  }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if ((!form.businessCustomerId && !form.newCustomer) || !form.name.trim()) return;
    const base = {
      businessCustomerId: form.businessCustomerId ? Number(form.businessCustomerId) : undefined,
      newCustomer: form.newCustomer,
      bidId: form.bidId ? Number(form.bidId) : undefined,
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      stage: form.stage,
      laborValue: numberOrZero(form.laborValue),
      materialValue: numberOrZero(form.materialValue),
      subcontractValue: numberOrZero(form.subcontractValue),
      otherValue: numberOrZero(form.otherValue),
      contingencyValue: numberOrZero(form.contingencyValue),
      dueDate: form.dueDate || undefined,
      ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : undefined,
      integrationProviderKey: form.integrationProviderKey.trim() || undefined,
      integrationKind: form.integrationProviderKey.trim() ? form.integrationKind : undefined,
      integrationStatus: form.integrationStatus,
      externalReference: form.externalReference.trim() || undefined,
    };
    if (estimate) {
      const data: EstimateUpdate = {
        ...base,
        bidId: base.bidId ?? null,
        description: base.description ?? null,
        dueDate: base.dueDate ?? null,
        ownerUserId: base.ownerUserId ?? null,
        integrationProviderKey: base.integrationProviderKey ?? null,
        integrationKind: base.integrationKind ?? null,
        externalReference: base.externalReference ?? null,
      };
      update.mutate({ estimateId: estimate.id, data }, { onSuccess: onSaved });
    } else {
      create.mutate({ data: base as EstimateInput }, { onSuccess: onSaved });
    }
  };
  const select = (key: keyof FormState) => (
    <Select value={String(form[key]) || 'none'} onValueChange={(value) => set(key, value === 'none' ? '' : value)}>
      <SelectTrigger aria-label={key}><SelectValue /></SelectTrigger>
      <SelectContent className="bg-popover">
        {key === 'bidId' && <><SelectItem value="none">No linked bid</SelectItem>{availableBids.map((bid) => <SelectItem key={bid.id} value={String(bid.id)}>{bid.bidNumber} · {bid.name}</SelectItem>)}</>}
        {key === 'ownerUserId' && <><SelectItem value="none">Unassigned</SelectItem>{(members.data ?? []).map((member) => <SelectItem key={member.userId} value={String(member.userId)}>{member.displayName || member.email || `Member ${member.userId}`}</SelectItem>)}</>}
        {key === 'stage' && stages.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        {key === 'integrationKind' && integrationKinds.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
        {key === 'integrationStatus' && integrationStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
  const field = (key: keyof FormState, title: string, props: Record<string, string> = {}) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{title}</span><Input {...props} value={String(form[key] ?? '')} onChange={(event) => set(key, event.target.value)} /></label>;

  return <Modal title={estimate ? 'Edit estimate' : 'New estimate'} onClose={onClose}>
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 md:grid-cols-2">
        {field('name', 'Estimate name', { required: 'true', placeholder: 'North wing renovation estimate' })}
        <CustomerSelector value={form.customerName} selectedId={form.businessCustomerId ? Number(form.businessCustomerId) : undefined} draft={form.newCustomer} onSelect={setCustomer} onDraftChange={setCustomerDraft} allowCreate={!estimate} />
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Source bid</span>{select('bidId')}</label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Stage</span>{select('stage')}</label>
        <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span>{select('ownerUserId')}</label>
        {field('dueDate', 'Due date', { type: 'date' })}
      </div>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Assumptions, exclusions, and estimate notes" /></label>
      <section className="rounded-lg border border-border bg-secondary/35 p-4">
        <div className="mb-3 flex items-center justify-between"><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Cost build-up</p><p className="mono text-sm font-bold">{currency.format(total)}</p></div>
        <div className="grid gap-4 md:grid-cols-2">{field('laborValue', 'Labor', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}{field('materialValue', 'Materials', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}{field('subcontractValue', 'Subcontractors', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}{field('otherValue', 'Other', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}{field('contingencyValue', 'Contingency', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}</div>
      </section>
      <section className="rounded-lg border border-border bg-secondary/35 p-4">
        <p className="mono mb-3 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Integration envelope</p>
        <div className="grid gap-4 md:grid-cols-2">
          {field('integrationProviderKey', 'Provider key', { placeholder: 'stack, measuresquare, quickbooks' })}
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Integration kind</span>{select('integrationKind')}</label>
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Sync status</span>{select('integrationStatus')}</label>
          {field('externalReference', 'External reference', { placeholder: 'Estimate ID in the provider' })}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">Provider keys are intentionally vendor-neutral so future connectors can import, sync, and reconcile estimates without changing the estimate record.</p>
      </section>
      {(create.isError || update.isError) && <p role="alert" className="text-xs text-destructive">This estimate could not be saved. Check the fields and integration status.</p>}
      <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !form.name.trim() || (!form.businessCustomerId && !form.newCustomer)}>{pending ? 'Saving…' : estimate ? 'Save changes' : 'Create estimate'}</Button></div>
    </form>
  </Modal>;
}

function EstimateDetail({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { activeRole } = useTenant();
  const query = useGetEstimate(id, { query: { queryKey: getGetEstimateQueryKey(id) } });
  const remove = useDeleteEstimate();
  const [editing, setEditing] = useState(false);
  if (query.isLoading) return <LoadingPanel lines={8} />;
  if (query.isError || !query.data) return <ErrorPanel onRetry={() => query.refetch()} />;
  const estimate = query.data;
  const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const canDelete = activeRole === 'owner' || activeRole === 'admin';
  const del = () => { if (!window.confirm(`Delete ${estimate.name}?`)) return; remove.mutate({ estimateId: id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); setLocation('/estimates'); } }); };
  const costRows = [['Labor', estimate.laborValue], ['Materials', estimate.materialValue], ['Subcontractors', estimate.subcontractValue], ['Other', estimate.otherValue], ['Contingency', estimate.contingencyValue]] as const;
  return <div className="animate-rise">
    <PageTitle eyebrow={estimate.estimateNumber} title={estimate.name} description={`${estimate.customerName} · Estimate record`} action={<div className="flex gap-2">{canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}{canDelete && <Button variant="danger" onClick={del}><Trash2 size={15} /> Delete</Button>}</div>} />
    <div className="grid gap-5 lg:grid-cols-[1.25fr_1fr]">
      <section className="rounded-xl border border-border bg-card p-5"><div className="mb-5 flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Estimate status</span><Badge tone={tone(estimate.stage)}>{label(stages, estimate.stage)}</Badge></div><div className="mb-6 grid gap-5 sm:grid-cols-2"><div><p className="text-xs text-muted-foreground">Total estimate</p><p className="mono mt-1 text-2xl font-semibold">{currency.format(estimate.totalValue)}</p></div><div><p className="text-xs text-muted-foreground">Due date</p><p className="mt-1 text-sm font-semibold">{shortDate(estimate.dueDate)}</p></div><div><p className="text-xs text-muted-foreground">Source bid</p>{estimate.bidId ? <Link href={`/bids/${estimate.bidId}`} className="mt-1 inline-block text-sm font-semibold text-primary hover:underline">{estimate.bidNumber}</Link> : <p className="mt-1 text-sm font-semibold">Standalone estimate</p>}</div><div><p className="text-xs text-muted-foreground">Owner</p><p className="mt-1 text-sm font-semibold">{estimate.owner?.displayName || estimate.owner?.email || 'Unassigned'}</p></div></div><div className="border-t border-border pt-5"><p className="mono mb-3 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Cost build-up</p><dl className="space-y-3">{costRows.map(([name, value]) => <div key={name} className="flex justify-between text-sm"><dt className="text-muted-foreground">{name}</dt><dd className="mono font-medium">{currency.format(value)}</dd></div>)}<div className="flex justify-between border-t border-border pt-3 text-sm font-bold"><dt>Total</dt><dd className="mono">{currency.format(estimate.totalValue)}</dd></div></dl></div>{estimate.description && <div className="mt-6 border-t border-border pt-5"><p className="mb-1 text-xs text-muted-foreground">Description</p><p className="whitespace-pre-wrap text-sm leading-6">{estimate.description}</p></div>}</section>
      <section className="rounded-xl border border-border bg-card p-5"><div className="mb-5 flex items-center gap-2"><CircleDollarSign size={18} className="text-primary" /><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Integration readiness</p></div><div className="rounded-lg border border-border bg-secondary/35 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{estimate.integrationProviderKey || 'Manual estimate'}</p><p className="mt-1 text-xs text-muted-foreground">{estimate.integrationKind ? label(integrationKinds, estimate.integrationKind) : 'No provider assigned'}</p></div><Badge tone={statusTone(estimate.integrationStatus)}>{label(integrationStatuses, estimate.integrationStatus)}</Badge></div>{estimate.externalReference && <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">External reference <span className="mono ml-1 text-foreground">{estimate.externalReference}</span></p>}{estimate.lastSyncedAt && <p className="mt-2 text-xs text-muted-foreground">Last synced {shortDate(estimate.lastSyncedAt)}</p>}</div><p className="mt-5 text-sm leading-6 text-muted-foreground">This estimate can receive takeoff, pricing, or accounting data from an entitled provider later. The current record keeps the provider identity and reconciliation reference without pretending a connector is active.</p></section>
    </div>
    {editing && <EstimateForm estimate={estimate} onClose={() => setEditing(false)} onSaved={(saved) => { queryClient.setQueryData(getGetEstimateQueryKey(id), saved); queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); setEditing(false); }} />}
  </div>;
}

function EstimateList() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { activeRole } = useTenant();
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [integrationStatus, setIntegrationStatus] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Estimate>();
  const params = useMemo(() => ({ search: search || undefined, stage: stage ? stage as EstimateStage : undefined, integrationStatus: integrationStatus ? integrationStatus as EstimateIntegrationStatus : undefined }), [search, stage, integrationStatus]);
  const query = useListEstimates(params, { query: { queryKey: getListEstimatesQueryKey(params) } });
  const remove = useDeleteEstimate();
  const estimates = query.data ?? [];
  const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const total = estimates.reduce((sum, estimate) => sum + estimate.totalValue, 0);
  const save = (saved: Estimate) => { queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() }); setShowForm(false); setEditing(undefined); if (!editing) setLocation(`/estimates/${saved.id}`); };
  return <div className="animate-rise"><PageTitle eyebrow="Financial workspace" title="Estimates" description="Build cost-backed estimates that can later reconcile with connected systems." action={canEdit ? <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={16} /> New estimate</Button> : undefined} /><div className="mb-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible estimates</p><p className="mt-2 text-2xl font-semibold">{estimates.length}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible value</p><p className="mono mt-2 text-2xl font-semibold">{currency.format(total)}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Needs attention</p><p className="mt-2 text-2xl font-semibold">{estimates.filter((estimate) => estimate.integrationStatus === 'error' || estimate.integrationStatus === 'pending').length}</p></div></div><div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Search estimates" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search estimate, customer, provider" className="h-10 border-transparent bg-secondary/65 pl-9" /></label><Select value={stage || 'all'} onValueChange={(value) => setStage(value === 'all' ? '' : value)}><SelectTrigger aria-label="Filter by estimate stage" className="h-10 border-transparent bg-secondary/65 md:w-44"><SelectValue placeholder="All stages" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All stages</SelectItem>{stages.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={integrationStatus || 'all'} onValueChange={(value) => setIntegrationStatus(value === 'all' ? '' : value)}><SelectTrigger aria-label="Filter by integration status" className="h-10 border-transparent bg-secondary/65 md:w-48"><SelectValue placeholder="All integrations" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All integrations</SelectItem>{integrationStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>{(search || stage || integrationStatus) && <Button variant="ghost" onClick={() => { setSearch(''); setStage(''); setIntegrationStatus(''); }}>Clear</Button>}</div>{query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : estimates.length === 0 ? <EmptyState icon={Calculator} title="No estimates match that view" text={search || stage || integrationStatus ? 'Try a different search or clear your filters.' : 'Create the first estimate for this customer environment.'} action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> Add estimate</Button> : undefined} /> : <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[1.45fr_1fr_125px_135px_130px_145px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">{['Estimate', 'Owner', 'Stage', 'Value', 'Due', 'Integration', ''].map((item) => <span key={item} className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{item}</span>)}</div><div className="divide-y divide-border">{estimates.map((estimate) => <div key={estimate.id} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.45fr_1fr_125px_135px_130px_145px_44px] md:items-center md:gap-4"><Link href={`/estimates/${estimate.id}`} className="min-w-0"><p className="mono text-[10px] text-accent">{estimate.estimateNumber}</p><p className="truncate text-sm font-bold">{estimate.name}</p><p className="truncate text-xs text-muted-foreground">{estimate.customerName}{estimate.bidNumber ? ` · ${estimate.bidNumber}` : ''}</p></Link><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound size={13} />{estimate.owner?.displayName || estimate.owner?.email || 'Unassigned'}</p><Badge tone={tone(estimate.stage)}>{label(stages, estimate.stage)}</Badge><p className="mono text-sm font-medium">{currency.format(estimate.totalValue)}</p><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} />{shortDate(estimate.dueDate)}</p><Badge tone={statusTone(estimate.integrationStatus)}>{estimate.integrationProviderKey || label(integrationStatuses, estimate.integrationStatus)}</Badge><div className="flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100">{canEdit && <Button variant="ghost" className="p-2" aria-label={`Edit ${estimate.name}`} onClick={() => { setEditing(estimate); setShowForm(true); }}><Pencil size={15} /></Button>}{(activeRole === 'owner' || activeRole === 'admin') && <Button variant="ghost" className="p-2" aria-label={`Delete ${estimate.name}`} onClick={() => { if (window.confirm(`Delete ${estimate.name}?`)) remove.mutate({ estimateId: estimate.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListEstimatesQueryKey() }) }); }}><Trash2 size={15} /></Button>}</div></div>)}</div></div>}{showForm && <EstimateForm estimate={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} onSaved={save} />}</div>;
}

export function Estimates() {
  const params = useParams<{ id?: string }>();
  const id = params.id ? Number(params.id) : null;
  if (params.id && (!Number.isInteger(id) || (id ?? 0) < 1)) return <NotFound />;
  return id && Number.isFinite(id) ? <EstimateDetail id={id} /> : <EstimateList />;
}

export default Estimates;