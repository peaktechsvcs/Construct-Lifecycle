import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarDays, FileText, Pencil, Plus, Search, Send, Trash2, UserRound } from 'lucide-react';
import {
  Proposal, ProposalInput, ProposalIntegrationKind, ProposalIntegrationStatus, ProposalStage, ProposalUpdate,
  useCreateProposal, useDeleteProposal, useGetProposal, useListBids, useListBusinessCustomers, useListEstimates,
  useListProposals, useListTenantMembers, useUpdateProposal,
  getGetProposalQueryKey, getListBidsQueryKey, getListBusinessCustomersQueryKey, getListEstimatesQueryKey,
  getListProposalsQueryKey, getListTenantMembersQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';
import NotFound from '@/pages/not-found';

const stages: { value: ProposalStage; label: string }[] = [
  { value: 'draft', label: 'Draft' }, { value: 'internal_review', label: 'Internal review' },
  { value: 'ready', label: 'Ready to send' }, { value: 'sent', label: 'Sent' },
  { value: 'viewed', label: 'Viewed' }, { value: 'accepted', label: 'Accepted' },
  { value: 'declined', label: 'Declined' }, { value: 'expired', label: 'Expired' },
];
const integrationKinds: { value: ProposalIntegrationKind; label: string }[] = [
  { value: 'document', label: 'Document' }, { value: 'crm', label: 'CRM' },
  { value: 'accounting', label: 'Accounting' }, { value: 'e_signature', label: 'E-signature' }, { value: 'other', label: 'Other' },
];
const integrationStatuses: { value: ProposalIntegrationStatus; label: string }[] = [
  { value: 'manual', label: 'Manual' }, { value: 'pending', label: 'Ready to connect' },
  { value: 'synced', label: 'Synced' }, { value: 'error', label: 'Sync error' },
];
const label = (items: { value: string; label: string }[], value: string) => items.find((item) => item.value === value)?.label ?? value;
const tone = (stage: string) => stage === 'accepted' ? 'green' as const : stage === 'declined' || stage === 'expired' ? 'red' as const : stage === 'sent' || stage === 'viewed' ? 'violet' as const : stage === 'ready' ? 'teal' as const : 'neutral' as const;
const integrationTone = (status: ProposalIntegrationStatus) => status === 'synced' ? 'green' as const : status === 'error' ? 'red' as const : status === 'pending' ? 'orange' as const : 'neutral' as const;

type FormState = {
  businessCustomerId: string; estimateId: string; bidId: string; name: string; description: string;
  stage: ProposalStage; proposalValue: string; validUntil: string; recipientName: string; recipientEmail: string;
  ownerUserId: string; integrationProviderKey: string; integrationKind: ProposalIntegrationKind;
  integrationStatus: ProposalIntegrationStatus; externalReference: string;
};
const emptyForm: FormState = {
  businessCustomerId: '', estimateId: '', bidId: '', name: '', description: '', stage: 'draft', proposalValue: '',
  validUntil: '', recipientName: '', recipientEmail: '', ownerUserId: '', integrationProviderKey: '',
  integrationKind: 'document', integrationStatus: 'manual', externalReference: '',
};
const toForm = (proposal?: Proposal): FormState => proposal ? {
  businessCustomerId: String(proposal.businessCustomerId), estimateId: proposal.estimateId ? String(proposal.estimateId) : '',
  bidId: proposal.bidId ? String(proposal.bidId) : '', name: proposal.name, description: proposal.description ?? '',
  stage: proposal.stage, proposalValue: proposal.proposalValue ? String(proposal.proposalValue) : '',
  validUntil: proposal.validUntil?.slice(0, 10) ?? '', recipientName: proposal.recipientName ?? '',
  recipientEmail: proposal.recipientEmail ?? '', ownerUserId: proposal.ownerUserId ? String(proposal.ownerUserId) : '',
  integrationProviderKey: proposal.integrationProviderKey ?? '', integrationKind: proposal.integrationKind ?? 'document',
  integrationStatus: proposal.integrationStatus, externalReference: proposal.externalReference ?? '',
} : emptyForm;

function ProposalForm({ proposal, onClose, onSaved }: { proposal?: Proposal; onClose: () => void; onSaved: (proposal: Proposal) => void }) {
  const [form, setForm] = useState<FormState>(() => toForm(proposal));
  const customers = useListBusinessCustomers(undefined, { query: { queryKey: getListBusinessCustomersQueryKey() } });
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const estimates = useListEstimates(undefined, { query: { queryKey: getListEstimatesQueryKey() } });
  const bids = useListBids(undefined, { query: { queryKey: getListBidsQueryKey() } });
  const create = useCreateProposal(); const update = useUpdateProposal(); const pending = create.isPending || update.isPending;
  const customerId = Number(form.businessCustomerId);
  const availableEstimates = (estimates.data ?? []).filter((estimate) => !customerId || estimate.businessCustomerId === customerId);
  const availableBids = (bids.data ?? []).filter((bid) => !customerId || bid.businessCustomerId === customerId);
  useEffect(() => setForm(toForm(proposal)), [proposal]);
  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!form.businessCustomerId || !form.name.trim()) return;
    const base = {
      businessCustomerId: customerId, estimateId: form.estimateId ? Number(form.estimateId) : undefined,
      bidId: form.bidId ? Number(form.bidId) : undefined, name: form.name.trim(),
      description: form.description.trim() || undefined, stage: form.stage,
      proposalValue: form.proposalValue ? Number(form.proposalValue) : 0, validUntil: form.validUntil || undefined,
      recipientName: form.recipientName.trim() || undefined, recipientEmail: form.recipientEmail.trim() || undefined,
      ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : undefined,
      integrationProviderKey: form.integrationProviderKey.trim() || undefined,
      integrationKind: form.integrationProviderKey.trim() ? form.integrationKind : undefined,
      integrationStatus: form.integrationStatus, externalReference: form.externalReference.trim() || undefined,
    };
    if (proposal) {
      const data: ProposalUpdate = { ...base, estimateId: base.estimateId ?? null, bidId: base.bidId ?? null, description: base.description ?? null, validUntil: base.validUntil ?? null, recipientName: base.recipientName ?? null, recipientEmail: base.recipientEmail ?? null, ownerUserId: base.ownerUserId ?? null, integrationProviderKey: base.integrationProviderKey ?? null, integrationKind: base.integrationKind ?? null, externalReference: base.externalReference ?? null };
      update.mutate({ proposalId: proposal.id, data }, { onSuccess: onSaved });
    } else create.mutate({ data: base as ProposalInput }, { onSuccess: onSaved });
  };
  const select = (key: keyof FormState) => <Select value={String(form[key]) || 'none'} onValueChange={(value) => set(key, value === 'none' ? '' : value)}><SelectTrigger aria-label={key}><SelectValue /></SelectTrigger><SelectContent className="bg-popover">
    {key === 'businessCustomerId' && <><SelectItem value="none">Select customer</SelectItem>{(customers.data ?? []).map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.companyName}</SelectItem>)}</>}
    {key === 'estimateId' && <><SelectItem value="none">No linked estimate</SelectItem>{availableEstimates.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.estimateNumber} · {item.name}</SelectItem>)}</>}
    {key === 'bidId' && <><SelectItem value="none">No linked bid</SelectItem>{availableBids.map((item) => <SelectItem key={item.id} value={String(item.id)}>{item.bidNumber} · {item.name}</SelectItem>)}</>}
    {key === 'ownerUserId' && <><SelectItem value="none">Unassigned</SelectItem>{(members.data ?? []).map((item) => <SelectItem key={item.userId} value={String(item.userId)}>{item.displayName || item.email || `Member ${item.userId}`}</SelectItem>)}</>}
    {key === 'stage' && stages.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
    {key === 'integrationKind' && integrationKinds.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
    {key === 'integrationStatus' && integrationStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
  </SelectContent></Select>;
  const field = (key: keyof FormState, title: string, props: Record<string, string> = {}) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{title}</span><Input {...props} value={form[key]} onChange={(event) => set(key, event.target.value)} /></label>;
  return <Modal title={proposal ? 'Edit proposal' : 'New proposal'} onClose={onClose}><form onSubmit={submit} className="space-y-4">
    <div className="grid gap-4 md:grid-cols-2">{field('name', 'Proposal name', { required: 'true', placeholder: 'North campus proposal' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Business customer</span>{select('businessCustomerId')}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Estimate</span>{select('estimateId')}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Bid</span>{select('bidId')}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Stage</span>{select('stage')}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span>{select('ownerUserId')}</label>{field('proposalValue', 'Proposal value', { type: 'number', min: '0', step: '0.01', placeholder: '0.00' })}{field('validUntil', 'Valid until', { type: 'date' })}</div>
    <div className="grid gap-4 md:grid-cols-2">{field('recipientName', 'Recipient name', { placeholder: 'Customer decision maker' })}{field('recipientEmail', 'Recipient email', { type: 'email', placeholder: 'name@customer.com' })}</div>
    <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span><Textarea rows={3} value={form.description} onChange={(event) => set('description', event.target.value)} placeholder="Scope, assumptions, exclusions, and next steps" /></label>
    <section className="rounded-lg border border-border bg-secondary/35 p-4"><p className="mono mb-3 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Integration envelope</p><div className="grid gap-4 md:grid-cols-2">{field('integrationProviderKey', 'Provider key', { placeholder: 'hubspot, salesforce, docusign' })}<label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Integration kind</span>{select('integrationKind')}</label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Sync status</span>{select('integrationStatus')}</label>{field('externalReference', 'External reference', { placeholder: 'CRM opportunity or document ID' })}</div><p className="mt-3 text-xs leading-5 text-muted-foreground">CRM integrations can track the opportunity record alongside proposal delivery, while document and e-signature systems can manage the customer-facing handoff.</p></section>
    {(create.isError || update.isError) && <p role="alert" className="text-xs text-destructive">This proposal could not be saved. Check the linked records and integration fields.</p>}<div className="flex justify-end gap-3 border-t border-border pt-4"><Button type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button type="submit" disabled={pending || !form.name.trim() || !form.businessCustomerId}>{pending ? 'Saving…' : proposal ? 'Save changes' : 'Create proposal'}</Button></div>
  </form></Modal>;
}

function ProposalDetail({ id }: { id: number }) {
  const [, setLocation] = useLocation(); const queryClient = useQueryClient(); const { activeRole } = useTenant();
  const query = useGetProposal(id, { query: { queryKey: getGetProposalQueryKey(id) } }); const remove = useDeleteProposal(); const [editing, setEditing] = useState(false);
  if (query.isLoading) return <LoadingPanel lines={8} />; if (query.isError || !query.data) return <ErrorPanel onRetry={() => query.refetch()} />;
  const proposal = query.data; const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member'; const canDelete = activeRole === 'owner' || activeRole === 'admin';
  const del = () => { if (!window.confirm(`Delete ${proposal.name}?`)) return; remove.mutate({ proposalId: id }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListProposalsQueryKey() }); setLocation('/proposals'); } }); };
  return <div className="animate-rise"><PageTitle eyebrow={proposal.proposalNumber} title={proposal.name} description={`${proposal.customerName} · Proposal record`} action={<div className="flex gap-2">{canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}{canDelete && <Button variant="danger" onClick={del}><Trash2 size={15} /> Delete</Button>}</div>} /><div className="grid gap-5 lg:grid-cols-[1.35fr_1fr]"><section className="rounded-xl border border-border bg-card p-5"><div className="mb-5 flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Proposal pipeline</span><Badge tone={tone(proposal.stage)}>{label(stages, proposal.stage)}</Badge></div><dl className="grid gap-5 sm:grid-cols-2"><div><dt className="text-xs text-muted-foreground">Proposal value</dt><dd className="mono mt-1 text-xl font-semibold">{currency.format(proposal.proposalValue)}</dd></div><div><dt className="text-xs text-muted-foreground">Valid until</dt><dd className="mt-1 text-sm font-semibold">{shortDate(proposal.validUntil)}</dd></div><div><dt className="text-xs text-muted-foreground">Estimate</dt><dd className="mt-1 text-sm font-semibold">{proposal.estimateNumber || 'No linked estimate'}</dd></div><div><dt className="text-xs text-muted-foreground">Bid</dt><dd className="mt-1 text-sm font-semibold">{proposal.bidNumber || 'No linked bid'}</dd></div><div><dt className="text-xs text-muted-foreground">Recipient</dt><dd className="mt-1 text-sm font-semibold">{proposal.recipientName || proposal.recipientEmail || 'Not assigned'}</dd></div><div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="mt-1 text-sm font-semibold">{proposal.owner?.displayName || proposal.owner?.email || 'Unassigned'}</dd></div></dl>{proposal.description && <div className="mt-6 border-t border-border pt-5"><p className="mb-1 text-xs text-muted-foreground">Description</p><p className="whitespace-pre-wrap text-sm leading-6">{proposal.description}</p></div>}</section><section className="rounded-xl border border-border bg-card p-5"><div className="mb-4 flex items-center gap-2"><Send size={17} className="text-primary" /><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Integration readiness</p></div><div className="rounded-lg border border-border bg-secondary/35 p-4"><div className="flex items-center justify-between gap-3"><div><p className="text-sm font-semibold">{proposal.integrationProviderKey || 'Manual proposal'}</p><p className="mt-1 text-xs text-muted-foreground">{proposal.integrationKind ? label(integrationKinds, proposal.integrationKind) : 'No provider assigned'}</p></div><Badge tone={integrationTone(proposal.integrationStatus)}>{label(integrationStatuses, proposal.integrationStatus)}</Badge></div>{proposal.externalReference && <p className="mt-4 border-t border-border pt-4 text-xs text-muted-foreground">External reference <span className="mono ml-1 text-foreground">{proposal.externalReference}</span></p>}{proposal.sentAt && <p className="mt-2 text-xs text-muted-foreground">Sent {shortDate(proposal.sentAt)}</p>}{proposal.respondedAt && <p className="mt-2 text-xs text-muted-foreground">Responded {shortDate(proposal.respondedAt)}</p>}</div><p className="mt-5 text-sm leading-6 text-muted-foreground">A CRM can retain the opportunity and proposal relationship while document or e-signature providers handle delivery and acceptance.</p></section></div>{editing && <ProposalForm proposal={proposal} onClose={() => setEditing(false)} onSaved={(saved) => { queryClient.setQueryData(getGetProposalQueryKey(id), saved); queryClient.invalidateQueries({ queryKey: getListProposalsQueryKey() }); setEditing(false); }} />}</div>;
}

function ProposalList() {
  const [, setLocation] = useLocation(); const queryClient = useQueryClient(); const { activeRole } = useTenant(); const [search, setSearch] = useState(''); const [stage, setStage] = useState(''); const [integrationStatus, setIntegrationStatus] = useState(''); const [showForm, setShowForm] = useState(false); const [editing, setEditing] = useState<Proposal>();
  const params = useMemo(() => ({ search: search || undefined, stage: stage ? stage as ProposalStage : undefined, integrationStatus: integrationStatus ? integrationStatus as ProposalIntegrationStatus : undefined }), [search, stage, integrationStatus]); const query = useListProposals(params, { query: { queryKey: getListProposalsQueryKey(params) } }); const remove = useDeleteProposal(); const proposals = query.data ?? []; const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member'; const total = proposals.reduce((sum, item) => sum + item.proposalValue, 0); const save = (saved: Proposal) => { queryClient.invalidateQueries({ queryKey: getListProposalsQueryKey() }); setShowForm(false); setEditing(undefined); if (!editing) setLocation(`/proposals/${saved.id}`); };
  return <div className="animate-rise"><PageTitle eyebrow="Customer handoff" title="Proposals" description="Prepare, send, and track customer-facing offers with linked IDs." action={canEdit ? <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={16} /> New proposal</Button> : undefined} /><div className="mb-5 grid gap-3 md:grid-cols-3"><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible proposals</p><p className="mt-2 text-2xl font-semibold">{proposals.length}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible value</p><p className="mono mt-2 text-2xl font-semibold">{currency.format(total)}</p></div><div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Needs attention</p><p className="mt-2 text-2xl font-semibold">{proposals.filter((item) => item.integrationStatus === 'error' || item.integrationStatus === 'pending').length}</p></div></div><div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Search proposals" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search proposal, customer, estimate, CRM ID" className="h-10 border-transparent bg-secondary/65 pl-9" /></label><Select value={stage || 'all'} onValueChange={(value) => setStage(value === 'all' ? '' : value)}><SelectTrigger aria-label="Filter by proposal stage" className="h-10 border-transparent bg-secondary/65 md:w-48"><SelectValue placeholder="All stages" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All stages</SelectItem>{stages.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={integrationStatus || 'all'} onValueChange={(value) => setIntegrationStatus(value === 'all' ? '' : value)}><SelectTrigger aria-label="Filter by integration status" className="h-10 border-transparent bg-secondary/65 md:w-48"><SelectValue placeholder="All integrations" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All integrations</SelectItem>{integrationStatuses.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>{(search || stage || integrationStatus) && <Button variant="ghost" onClick={() => { setSearch(''); setStage(''); setIntegrationStatus(''); }}>Clear</Button>}</div>{query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : proposals.length === 0 ? <EmptyState icon={FileText} title="No proposals match that view" text={search || stage || integrationStatus ? 'Try a different search or clear your filters.' : 'Create the first customer-facing proposal.'} action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> Add proposal</Button> : undefined} /> : <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[1.45fr_1fr_125px_135px_130px_145px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">{['Proposal', 'Owner', 'Stage', 'Value', 'Valid until', 'Integration', ''].map((item) => <span key={item} className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{item}</span>)}</div><div className="divide-y divide-border">{proposals.map((proposal) => <div key={proposal.id} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.45fr_1fr_125px_135px_130px_145px_44px] md:items-center md:gap-4"><Link href={`/proposals/${proposal.id}`} className="min-w-0"><p className="mono text-[10px] text-accent">{proposal.proposalNumber}</p><p className="truncate text-sm font-bold">{proposal.name}</p><p className="truncate text-xs text-muted-foreground">{proposal.customerName}{proposal.estimateNumber ? ` · ${proposal.estimateNumber}` : ''}{proposal.bidNumber ? ` · ${proposal.bidNumber}` : ''}</p></Link><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound size={13} />{proposal.owner?.displayName || proposal.owner?.email || 'Unassigned'}</p><Badge tone={tone(proposal.stage)}>{label(stages, proposal.stage)}</Badge><p className="mono text-sm font-medium">{currency.format(proposal.proposalValue)}</p><p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} />{shortDate(proposal.validUntil)}</p><Badge tone={integrationTone(proposal.integrationStatus)}>{proposal.integrationProviderKey || label(integrationStatuses, proposal.integrationStatus)}</Badge><div className="flex justify-end gap-1 md:opacity-0 md:group-hover:opacity-100">{canEdit && <Button variant="ghost" className="p-2" aria-label={`Edit ${proposal.name}`} onClick={() => { setEditing(proposal); setShowForm(true); }}><Pencil size={15} /></Button>}{(activeRole === 'owner' || activeRole === 'admin') && <Button variant="ghost" className="p-2" aria-label={`Delete ${proposal.name}`} onClick={() => { if (window.confirm(`Delete ${proposal.name}?`)) remove.mutate({ proposalId: proposal.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListProposalsQueryKey() }) }); }}><Trash2 size={15} /></Button>}</div></div>)}</div></div>}{showForm && <ProposalForm proposal={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} onSaved={save} />}</div>;
}

export function Proposals() { const params = useParams<{ id?: string }>(); const id = params.id ? Number(params.id) : null; if (params.id && (!Number.isInteger(id) || (id ?? 0) < 1)) return <NotFound />; return id && Number.isFinite(id) ? <ProposalDetail id={id} /> : <ProposalList />; }
export default Proposals;