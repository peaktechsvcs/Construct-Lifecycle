import { useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ClipboardList, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import {
  Bid, BidInput, BidScope, BidScopeInput, BidScopeStatus, BidScopeMode, BidScopeUpdate, BidStage, BidType, BidIntegrationCoverage, BidUpdate, BusinessCustomerInput,
  useListBids, getListBidsQueryKey, useCreateBid, useGetBid, getGetBidQueryKey,
  useUpdateBid, useDeleteBid,
  useListTenantMembers, getListTenantMembersQueryKey, useListOpportunities, getListOpportunitiesQueryKey,
  useListBidScopes, getListBidScopesQueryKey, useCreateBidScope, useUpdateBidScope, useDeleteBidScope,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import NotFound from '@/pages/not-found';
import { BidAttachmentsPanel } from '@/components/bid-attachments-panel';
import { CustomerSelector } from '@/components/customer-selector';

const stages: { value: BidStage; label: string }[] = [
  { value: 'invited', label: 'Invited' }, { value: 'qualifying', label: 'Qualifying' },
  { value: 'takeoff', label: 'Takeoff' }, { value: 'estimating', label: 'Estimating' },
  { value: 'review', label: 'Review' }, { value: 'submitted', label: 'Submitted' },
  { value: 'awarded', label: 'Awarded' }, { value: 'lost', label: 'Lost' },
];
const coverage: { value: BidIntegrationCoverage; label: string }[] = [
  { value: 'none', label: 'Not covered' }, { value: 'partial', label: 'Partial coverage' }, { value: 'full', label: 'Full coverage' },
];
const scopeStatuses: { value: BidScopeStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' }, { value: 'active', label: 'Active' }, { value: 'submitted', label: 'Submitted' },
  { value: 'awarded', label: 'Awarded' }, { value: 'lost', label: 'Lost' },
];
const tone = (stage: string) => stage === 'awarded' ? 'green' as const : stage === 'lost' ? 'red' as const : stage === 'submitted' || stage === 'review' ? 'violet' as const : stage === 'takeoff' || stage === 'estimating' ? 'teal' as const : 'neutral' as const;
const label = (items: { value: string; label: string }[], value: string) => items.find((item) => item.value === value)?.label ?? value;

type FormState = {
  businessCustomerId: string; customerName: string; newCustomer?: BusinessCustomerInput; opportunityId: string; name: string; description: string; stage: BidStage;
  bidType: BidType; scopeMode: BidScopeMode; specialty: string; estimatedValue: string; dueDate: string;
  ownerUserId: string; takeoffProvider: string; takeoffCoverage: BidIntegrationCoverage;
  estimatingProvider: string; estimatingCoverage: BidIntegrationCoverage;
};
const emptyForm: FormState = { businessCustomerId: '', customerName: '', opportunityId: '', name: '', description: '', stage: 'invited', bidType: 'general', scopeMode: 'full', specialty: '', estimatedValue: '', dueDate: '', ownerUserId: '', takeoffProvider: '', takeoffCoverage: 'none', estimatingProvider: '', estimatingCoverage: 'none' };
const toForm = (bid?: Bid): FormState => bid ? {
  businessCustomerId: String(bid.businessCustomerId), customerName: bid.customerName, opportunityId: bid.opportunityId ? String(bid.opportunityId) : '', name: bid.name,
  description: bid.description ?? '', stage: bid.stage, bidType: bid.bidType, scopeMode: bid.scopeMode, specialty: bid.specialty ?? '',
  estimatedValue: bid.estimatedValue ? String(bid.estimatedValue) : '', dueDate: bid.dueDate?.slice(0, 10) ?? '',
  ownerUserId: bid.ownerUserId ? String(bid.ownerUserId) : '', takeoffProvider: bid.takeoffProvider ?? '', takeoffCoverage: bid.takeoffCoverage,
  estimatingProvider: bid.estimatingProvider ?? '', estimatingCoverage: bid.estimatingCoverage,
} : emptyForm;

function BidForm({ bid, onClose, onSaved }: { bid?: Bid; onClose: () => void; onSaved: (bid: Bid) => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(bid));
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const opportunities = useListOpportunities(undefined, { query: { queryKey: getListOpportunitiesQueryKey() } });
  const create = useCreateBid(); const update = useUpdateBid(); const pending = create.isPending || update.isPending;
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
       businessCustomerId: form.businessCustomerId ? Number(form.businessCustomerId) : undefined, newCustomer: form.newCustomer,
       opportunityId: form.opportunityId ? Number(form.opportunityId) : undefined,
      name: form.name.trim(), description: form.description.trim() || undefined, stage: form.stage, bidType: form.bidType, scopeMode: form.scopeMode,
      specialty: form.specialty.trim() || undefined, estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : 0, dueDate: form.dueDate || undefined,
      ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : undefined, takeoffProvider: form.takeoffProvider.trim() || undefined,
      takeoffCoverage: form.takeoffCoverage, estimatingProvider: form.estimatingProvider.trim() || undefined, estimatingCoverage: form.estimatingCoverage,
    };
    if (bid) {
      const data: BidUpdate = { ...base, opportunityId: base.opportunityId ?? null, description: base.description ?? null, dueDate: base.dueDate ?? null, ownerUserId: base.ownerUserId ?? null, specialty: base.specialty ?? null, takeoffProvider: base.takeoffProvider ?? null, estimatingProvider: base.estimatingProvider ?? null };
      update.mutate({ bidId: bid.id, data }, { onSuccess: onSaved });
    } else create.mutate({ data: base as BidInput }, { onSuccess: onSaved });
  };
    const select = (key: keyof FormState, value: string) => <Select value={String(form[key]) || 'none'} onValueChange={(v) => set(key, v === 'none' ? '' : v)}><SelectTrigger aria-label={key}><SelectValue /></SelectTrigger><SelectContent className="bg-popover">{key === 'opportunityId' && <><SelectItem value="none">No opportunity</SelectItem>{(opportunities.data ?? []).filter((x) => !form.businessCustomerId || x.businessCustomerId === Number(form.businessCustomerId)).map((x) => <SelectItem key={x.id} value={String(x.id)}>{x.opportunityNumber} · {x.name}</SelectItem>)}</>}{key === 'ownerUserId' && <><SelectItem value="none">Unassigned</SelectItem>{(members.data ?? []).map((x) => <SelectItem key={x.userId} value={String(x.userId)}>{x.displayName || x.email || `Member ${x.userId}`}</SelectItem>)}</>}{key === 'stage' && stages.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}{key === 'bidType' && <><SelectItem value="general">General</SelectItem><SelectItem value="specialty">Specialty</SelectItem></>}{key === 'scopeMode' && <><SelectItem value="full">Full scope</SelectItem><SelectItem value="partial">Partial scope</SelectItem></>}{(key === 'takeoffCoverage' || key === 'estimatingCoverage') && coverage.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>;
   const field = (key: keyof FormState, title: string, props: Record<string, string> = {}) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{title}</span><Input {...props} value={String(form[key] ?? '')} onChange={(e) => set(key, e.target.value)} /></label>;
  return <Modal title={bid ? 'Edit bid' : 'New bid'} onClose={onClose}><form onSubmit={submit} className="space-y-4">
     <div className="grid gap-4 md:grid-cols-2">{field('name', 'Bid name', { required: 'true', placeholder: 'Central plant renovation' })}<CustomerSelector value={form.customerName} selectedId={form.businessCustomerId ? Number(form.businessCustomerId) : undefined} draft={form.newCustomer} onSelect={setCustomer} onDraftChange={setCustomerDraft} allowCreate={!bid} /><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Opportunity</span>{select('opportunityId', form.opportunityId)}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Stage</span>{select('stage', form.stage)}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Bid type</span>{select('bidType', form.bidType)}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Scope</span>{select('scopeMode', form.scopeMode)}</label>{field('specialty', 'Specialty', { placeholder: 'Electrical, HVAC, concrete…' })}{field('estimatedValue', 'Estimated value', { type: 'number', min: '0', step: '1', placeholder: '0' })}{field('dueDate', 'Due date', { type: 'date' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span>{select('ownerUserId', form.ownerUserId)}</label></div>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="Scope, assumptions, and submission notes" /></label>
    <div className="rounded-lg border border-border bg-secondary/35 p-4"><p className="mono mb-3 text-[10px] uppercase tracking-[.13em] text-muted-foreground">System coverage</p><div className="grid gap-4 md:grid-cols-2">{field('takeoffProvider', 'Takeoff system', { placeholder: 'Provider name' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Takeoff coverage</span>{select('takeoffCoverage', form.takeoffCoverage)}</label>{field('estimatingProvider', 'Estimating system', { placeholder: 'Provider name' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Estimating coverage</span>{select('estimatingCoverage', form.estimatingCoverage)}</label></div></div>
     {(create.isError || update.isError) && <p role="alert" className="text-xs text-destructive">This bid could not be saved. Check the fields and try again.</p>}<div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !form.name.trim() || (!form.businessCustomerId && !form.newCustomer)}>{pending ? 'Saving…' : bid ? 'Save changes' : 'Create bid'}</Button></div>
   </form></Modal>;
}

type ScopeFormState = {
  name: string; description: string; amount: string; ownerUserId: string; status: BidScopeStatus;
  takeoffProvider: string; takeoffCoverage: BidIntegrationCoverage;
  estimatingProvider: string; estimatingCoverage: BidIntegrationCoverage;
};
const emptyScopeForm: ScopeFormState = {
  name: '', description: '', amount: '', ownerUserId: '', status: 'draft',
  takeoffProvider: '', takeoffCoverage: 'none', estimatingProvider: '', estimatingCoverage: 'none',
};
const toScopeForm = (scope?: BidScope): ScopeFormState => scope ? {
  name: scope.name, description: scope.description ?? '', amount: String(scope.amount), ownerUserId: scope.ownerUserId ? String(scope.ownerUserId) : '',
  status: scope.status, takeoffProvider: scope.takeoffProvider ?? '', takeoffCoverage: scope.takeoffCoverage,
  estimatingProvider: scope.estimatingProvider ?? '', estimatingCoverage: scope.estimatingCoverage,
} : emptyScopeForm;

function ScopeForm({ bidId, scope, onClose, onSaved }: { bidId: number; scope?: BidScope; onClose: () => void; onSaved: (scope: BidScope) => void }) {
  const [form, setForm] = useState<ScopeFormState>(() => toScopeForm(scope));
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const create = useCreateBidScope(); const update = useUpdateBidScope(); const pending = create.isPending || update.isPending;
  const set = (key: keyof ScopeFormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const select = (key: keyof ScopeFormState) => <Select value={String(form[key]) || 'none'} onValueChange={(value) => set(key, value === 'none' ? '' : value)}><SelectTrigger aria-label={key}><SelectValue /></SelectTrigger><SelectContent className="bg-popover">
    {key === 'ownerUserId' && <><SelectItem value="none">Unassigned</SelectItem>{(members.data ?? []).map((member) => <SelectItem key={member.userId} value={String(member.userId)}>{member.displayName || member.email || `Member ${member.userId}`}</SelectItem>)}</>}
    {key === 'status' && scopeStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
    {(key === 'takeoffCoverage' || key === 'estimatingCoverage') && coverage.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
  </SelectContent></Select>;
  const field = (key: keyof ScopeFormState, title: string, props: Record<string, string> = {}) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{title}</span><Input {...props} value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.name.trim()) return;
    const base = {
      name: form.name.trim(), description: form.description.trim() || undefined, amount: form.amount ? Number(form.amount) : 0,
      ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : undefined, status: form.status,
      takeoffProvider: form.takeoffProvider.trim() || undefined, takeoffCoverage: form.takeoffCoverage,
      estimatingProvider: form.estimatingProvider.trim() || undefined, estimatingCoverage: form.estimatingCoverage,
    };
    if (scope) {
      const data: BidScopeUpdate = {
        ...base, description: base.description ?? null, ownerUserId: base.ownerUserId ?? null,
        takeoffProvider: base.takeoffProvider ?? null, estimatingProvider: base.estimatingProvider ?? null,
      };
      update.mutate({ bidId, scopeId: scope.id, data }, { onSuccess: onSaved });
    } else {
      create.mutate({ bidId, data: base as BidScopeInput }, { onSuccess: onSaved });
    }
  };
  return <Modal title={scope ? 'Edit specialty scope' : 'Add specialty scope'} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">
      {field('name', 'Scope name', { required: 'true', placeholder: 'Electrical package' })}
      {field('amount', 'Scope amount', { type: 'number', min: '0', step: '1', placeholder: '0' })}
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span>{select('ownerUserId')}</label>
      <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Status</span>{select('status')}</label>
    </div>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Package assumptions, exclusions, and handoff notes" /></label>
    <div className="rounded-lg border border-border bg-secondary/35 p-4"><p className="mono mb-3 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Scope coverage</p><div className="grid gap-4 md:grid-cols-2">{field('takeoffProvider', 'Takeoff system', { placeholder: 'Provider name' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Takeoff coverage</span>{select('takeoffCoverage')}</label>{field('estimatingProvider', 'Estimating system', { placeholder: 'Provider name' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Estimating coverage</span>{select('estimatingCoverage')}</label></div></div>
    {(create.isError || update.isError) && <p role="alert" className="text-xs text-destructive">This specialty scope could not be saved. Check the coverage and owner fields.</p>}
    <div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !form.name.trim()}>{pending ? 'Saving…' : scope ? 'Save scope' : 'Add scope'}</Button></div>
  </form></Modal>;
}

function BidDetail({ id }: { id: number }) {
  const [, setLocation] = useLocation(); const qc = useQueryClient(); const { activeRole } = useTenant();
  const query = useGetBid(id, { query: { queryKey: getGetBidQueryKey(id) } }); const remove = useDeleteBid(); const [editing, setEditing] = useState(false);
  if (query.isLoading) return <LoadingPanel lines={8} />; if (query.isError || !query.data) return <ErrorPanel onRetry={() => query.refetch()} />;
   const bid = query.data; const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member'; const canDelete = activeRole === 'owner' || activeRole === 'admin';
  const del = () => { if (!window.confirm(`Delete ${bid.name}?`)) return; remove.mutate({ bidId: id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListBidsQueryKey() }); setLocation('/bids'); } }); };
   return <div className="animate-rise"><PageTitle eyebrow={bid.bidNumber} title={bid.name} description={`${bid.customerName} · Bid record`} action={<div className="flex gap-2">{canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}{canDelete && <Button variant="danger" onClick={del}><Trash2 size={15} /> Delete</Button>}</div>} /><div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]"><section className="rounded-xl border border-border bg-card p-5"><div className="mb-5 flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Pipeline status</span><Badge tone={tone(bid.stage)}>{label(stages, bid.stage)}</Badge></div><dl className="grid gap-5 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Estimated value</dt><dd className="mono mt-1 text-xl font-semibold">{currency.format(bid.estimatedValue)}</dd>{bid.scopeCount > 0 && <p className="mt-1 text-[10px] text-muted-foreground">Rolled up from {bid.scopeCount} specialty scopes</p>}</div><div><dt className="text-xs text-muted-foreground">Due date</dt><dd className="mt-1 text-sm font-semibold">{shortDate(bid.dueDate)}</dd></div><div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="mt-1 text-sm font-semibold">{bid.owner?.displayName || bid.owner?.email || 'Unassigned'}</dd></div><div><dt className="text-xs text-muted-foreground">Opportunity</dt><dd className="mt-1 text-sm font-semibold">{bid.opportunityName || 'No linked opportunity'}</dd></div></dl>{bid.description && <div className="mt-6 border-t border-border pt-5"><p className="mb-1 text-xs text-muted-foreground">Description</p><p className="whitespace-pre-wrap text-sm leading-6">{bid.description}</p></div>}</section><section className="rounded-xl border border-border bg-card p-5"><div className="mb-4 flex items-center justify-between"><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Coverage map</p>{bid.hasCoverageGap ? <Badge tone="orange">{bid.coverageGapCount} gap{bid.coverageGapCount === 1 ? '' : 's'}</Badge> : <Badge tone="green">Fully covered</Badge>}</div><div className="space-y-4"><Coverage label="Takeoff" provider={bid.takeoffProvider} value={bid.takeoffCoverage} /><Coverage label="Estimating" provider={bid.estimatingProvider} value={bid.estimatingCoverage} /></div><div className="mt-6 border-t border-border pt-5 text-sm"><p><span className="block text-xs text-muted-foreground">Bid type</span>{label([{ value: 'general', label: 'General' }, { value: 'specialty', label: 'Specialty' }], bid.bidType)}{bid.specialty ? ` · ${bid.specialty}` : ''}</p><p className="mt-4"><span className="block text-xs text-muted-foreground">Scope mode</span>{bid.scopeMode === 'full' ? 'Full scope' : 'Partial scope'}</p></div></section></div><BidAttachmentsPanel bid={bid} canEdit={canEdit} /><BidScopePanel bid={bid} canEdit={canEdit} />{editing && <BidForm bid={bid} onClose={() => setEditing(false)} onSaved={(saved) => { qc.setQueryData(getGetBidQueryKey(id), saved); qc.invalidateQueries({ queryKey: getListBidsQueryKey() }); setEditing(false); }} />}</div>;
}

function BidScopePanel({ bid, canEdit }: { bid: Bid; canEdit: boolean }) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BidScope>();
  const scopesQuery = useListBidScopes(bid.id, { query: { queryKey: getListBidScopesQueryKey(bid.id), staleTime: 30000 } });
  const remove = useDeleteBidScope();
  const scopes = scopesQuery.data ?? bid.scopes;
  const scopeTotal = scopes.reduce((sum, scope) => sum + scope.amount, 0);
  const gaps = scopes.filter((scope) => scope.takeoffCoverage !== 'full' || scope.estimatingCoverage !== 'full').length;
  const save = (scope: BidScope) => {
    qc.invalidateQueries({ queryKey: getListBidScopesQueryKey(bid.id) });
    qc.invalidateQueries({ queryKey: getGetBidQueryKey(bid.id) });
    qc.invalidateQueries({ queryKey: getListBidsQueryKey() });
    setShowForm(false); setEditing(undefined);
  };
  if (bid.bidType !== 'specialty') return null;
  return <section className="mt-5 rounded-xl border border-border bg-card p-5"><div className="mb-4 flex flex-wrap items-start justify-between gap-3"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Specialty scopes</p><p className="mt-1 text-xs text-muted-foreground">Split this bid into owned work packages with independent system coverage.</p></div>{canEdit && <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={15} /> Add scope</Button>}</div><div className="mb-4 grid gap-3 sm:grid-cols-3"><div className="rounded-lg bg-secondary/55 p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Scope total</p><p className="mono mt-1 text-lg font-semibold">{currency.format(scopeTotal)}</p></div><div className="rounded-lg bg-secondary/55 p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Packages</p><p className="mt-1 text-lg font-semibold">{scopes.length}</p></div><div className="rounded-lg bg-secondary/55 p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Coverage gaps</p><p className={`mt-1 text-lg font-semibold ${gaps ? 'text-status-warning' : ''}`}>{gaps}</p></div></div>{scopesQuery.isLoading ? <LoadingPanel lines={3} /> : scopesQuery.isError ? <ErrorPanel onRetry={() => scopesQuery.refetch()} /> : scopes.length === 0 ? <div className="rounded-lg border border-dashed border-border p-5 text-center"><p className="text-sm font-semibold">No specialty scopes yet</p><p className="mt-1 text-xs text-muted-foreground">Add electrical, HVAC, concrete, or other packages to track ownership and coverage separately.</p></div> : <div className="space-y-3">{scopes.map((scope) => <div key={scope.id} className="rounded-lg border border-border p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-bold">{scope.name}</h3><Badge tone={tone(scope.status)}>{label(scopeStatuses, scope.status)}</Badge>{(scope.takeoffCoverage !== 'full' || scope.estimatingCoverage !== 'full') && <Badge tone="orange">Coverage gap</Badge>}</div><p className="mt-1 text-xs text-muted-foreground">{scope.owner?.displayName || scope.owner?.email || 'Unassigned'} · {currency.format(scope.amount)}</p>{scope.description && <p className="mt-2 text-xs leading-5 text-muted-foreground">{scope.description}</p>}</div>{canEdit && <div className="flex gap-1"><Button variant="ghost" className="p-2" aria-label={`Edit ${scope.name}`} onClick={() => { setEditing(scope); setShowForm(true); }}><Pencil size={15} /></Button><Button variant="ghost" className="p-2" aria-label={`Delete ${scope.name}`} onClick={() => { if (window.confirm(`Delete ${scope.name}?`)) remove.mutate({ bidId: bid.id, scopeId: scope.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListBidScopesQueryKey(bid.id) }); qc.invalidateQueries({ queryKey: getGetBidQueryKey(bid.id) }); qc.invalidateQueries({ queryKey: getListBidsQueryKey() }); } }); }}><Trash2 size={15} /></Button></div>}</div><div className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-2"><Coverage label="Takeoff" provider={scope.takeoffProvider} value={scope.takeoffCoverage} /><Coverage label="Estimating" provider={scope.estimatingProvider} value={scope.estimatingCoverage} /></div></div>)}</div>}{showForm && <ScopeForm bidId={bid.id} scope={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} onSaved={save} />}</section>;
}
function Coverage({ label: name, provider, value }: { label: string; provider?: string | null; value: BidIntegrationCoverage }) { return <div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{name}</p><p className="text-xs text-muted-foreground">{provider || 'No system assigned'}</p></div><Badge tone={value === 'full' ? 'green' : value === 'partial' ? 'orange' : 'neutral'}>{label(coverage, value)}</Badge></div>; }

function BidList() {
  const [, setLocation] = useLocation(); const qc = useQueryClient(); const { activeRole } = useTenant(); const [search, setSearch] = useState(''); const [stage, setStage] = useState(''); const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<Bid>();
   const params = useMemo(() => ({ search: search || undefined, stage: stage ? stage as BidStage : undefined }), [search, stage]); const query = useListBids(params, { query: { queryKey: getListBidsQueryKey(params) } }); const remove = useDeleteBid(); const bids = query.data ?? []; const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member'; const total = bids.reduce((sum, bid) => sum + bid.estimatedValue, 0);
  const save = (saved: Bid) => { qc.invalidateQueries({ queryKey: getListBidsQueryKey() }); setShowForm(false); setEditing(undefined); if (!editing) setLocation(`/bids/${saved.id}`); };
   return <div className="animate-rise"><PageTitle eyebrow="Submission workspace" title="Bids" description="Turn customer opportunities into scoped, owned submissions." action={canEdit ? <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={16} /> New bid</Button> : undefined} /><div className="mb-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible bids</p><p className="mt-2 text-2xl font-semibold">{bids.length}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible pipeline</p><p className="mono mt-2 text-2xl font-semibold">{currency.format(total)}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Coverage gaps</p><p className="mt-2 text-2xl font-semibold">{bids.filter((x) => x.hasCoverageGap).length}</p></div></div><div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Search bids" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search bid, customer, or opportunity" className="h-10 border-transparent bg-secondary/65 pl-9" /></label><Select value={stage || 'all'} onValueChange={(v) => setStage(v === 'all' ? '' : v)}><SelectTrigger aria-label="Filter by stage" className="h-10 border-transparent bg-secondary/65 md:w-48"><SelectValue placeholder="All stages" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All stages</SelectItem>{stages.map((x) => <SelectItem key={x.value} value={x.value}>{x.label}</SelectItem>)}</SelectContent></Select>{(search || stage) && <Button variant="ghost" onClick={() => { setSearch(''); setStage(''); }}>Clear</Button>}</div>{query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : bids.length === 0 ? <EmptyState icon={ClipboardList} title="No bids match that view" text={search || stage ? 'Try a different search or clear your filter.' : 'Create the first scoped submission for your pipeline.'} action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> Add bid</Button> : undefined} /> : <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[1.35fr_1fr_125px_120px_130px_150px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">{['Bid', 'Owner', 'Stage', 'Value', 'Due', 'Coverage', ''].map((x) => <span key={x} className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{x}</span>)}</div><div className="divide-y divide-border">{bids.map((bid) => <div key={bid.id} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.35fr_1fr_125px_120px_130px_150px_44px] md:items-center md:gap-4"><Link href={`/bids/${bid.id}`} className="min-w-0"><p className="mono text-[10px] text-accent">{bid.bidNumber}</p><p className="truncate text-sm font-bold">{bid.name}</p><p className="truncate text-xs text-muted-foreground">{bid.customerName}{bid.opportunityName ? ` · ${bid.opportunityName}` : ''}</p></Link><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound size={13} />{bid.owner?.displayName || bid.owner?.email || 'Unassigned'}</p><Badge tone={tone(bid.stage)}>{label(stages, bid.stage)}</Badge><p className="mono text-sm font-medium">{currency.format(bid.estimatedValue)}</p><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} />{shortDate(bid.dueDate)}</p><div className="flex flex-wrap gap-1">{bid.scopeCount > 0 ? <><Badge tone={bid.hasCoverageGap ? 'orange' : 'green'}>{bid.scopeCount} scopes</Badge><Badge tone={bid.hasCoverageGap ? 'orange' : 'green'}>{bid.coverageGapCount} gaps</Badge></> : <><Badge tone={bid.takeoffCoverage === 'full' ? 'green' : 'orange'}>T {bid.takeoffCoverage}</Badge><Badge tone={bid.estimatingCoverage === 'full' ? 'green' : 'orange'}>E {bid.estimatingCoverage}</Badge></>}</div><div className="flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100">{canEdit && <Button variant="ghost" className="p-2" aria-label={`Edit ${bid.name}`} onClick={() => { setEditing(bid); setShowForm(true); }}><Pencil size={15} /></Button>}{(activeRole === 'owner' || activeRole === 'admin') && <Button variant="ghost" className="p-2" aria-label={`Delete ${bid.name}`} onClick={() => { if (window.confirm(`Delete ${bid.name}?`)) remove.mutate({ bidId: bid.id }, { onSuccess: () => qc.invalidateQueries({ queryKey: getListBidsQueryKey() }) }); }}><Trash2 size={15} /></Button>}</div></div>)}</div></div>}{showForm && <BidForm bid={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} onSaved={save} />}</div>;
}
export function Bids() { const params = useParams<{ id?: string }>(); const id = params.id ? Number(params.id) : null; if (params.id && (!Number.isInteger(id) || (id ?? 0) < 1)) return <NotFound />; return id && Number.isFinite(id) ? <BidDetail id={id} /> : <BidList />; }
export default Bids;