import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, CalendarDays, Pencil, Plus, Search, Trash2, UserRound } from 'lucide-react';
import {
  Opportunity,
  OpportunityStage,
  OpportunityInput,
  OpportunityUpdate,
  useListOpportunities,
  getListOpportunitiesQueryKey,
  useCreateOpportunity,
  useGetOpportunity,
  getGetOpportunityQueryKey,
  useUpdateOpportunity,
  useDeleteOpportunity,
  useListBusinessCustomers,
  getListBusinessCustomersQueryKey,
  useListTenantMembers,
  getListTenantMembersQueryKey,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, Modal, PageTitle, currency, shortDate } from '@/components/app-ui';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Textarea } from '@workspace/construct-lifecycle-design-system/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';
import { useTenant } from '@/providers/tenant-provider';

const stages: { value: OpportunityStage; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'qualified', label: 'Qualified' },
  { value: 'proposal', label: 'Proposal' },
  { value: 'negotiation', label: 'Negotiation' },
  { value: 'won', label: 'Won' },
  { value: 'lost', label: 'Lost' },
];

const stageTone = (stage: string) => {
  if (stage === 'won') return 'green' as const;
  if (stage === 'lost') return 'red' as const;
  if (stage === 'proposal' || stage === 'negotiation') return 'violet' as const;
  if (stage === 'qualified') return 'teal' as const;
  return 'neutral' as const;
};

const fieldClass = 'w-full rounded-md border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-ring';

type FormState = {
  businessCustomerId: string;
  name: string;
  description: string;
  stage: OpportunityStage;
  estimatedValue: string;
  expectedCloseDate: string;
  ownerUserId: string;
};

const emptyForm: FormState = {
  businessCustomerId: '',
  name: '',
  description: '',
  stage: 'new',
  estimatedValue: '',
  expectedCloseDate: '',
  ownerUserId: '',
};

function toForm(opportunity?: Opportunity): FormState {
  if (!opportunity) return emptyForm;
  return {
    businessCustomerId: String(opportunity.businessCustomerId),
    name: opportunity.name,
    description: opportunity.description ?? '',
    stage: opportunity.stage,
    estimatedValue: opportunity.estimatedValue ? String(opportunity.estimatedValue) : '',
    expectedCloseDate: opportunity.expectedCloseDate?.slice(0, 10) ?? '',
    ownerUserId: opportunity.ownerUserId ? String(opportunity.ownerUserId) : '',
  };
}

function OpportunityForm({
  opportunity,
  onClose,
  onSaved,
}: {
  opportunity?: Opportunity;
  onClose: () => void;
  onSaved: (saved: Opportunity) => void;
}) {
  const [form, setForm] = useState<FormState>(() => toForm(opportunity));
  const customers = useListBusinessCustomers(undefined, { query: { queryKey: getListBusinessCustomersQueryKey() } });
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const create = useCreateOpportunity();
  const update = useUpdateOpportunity();
  const isEditing = Boolean(opportunity);
  const pending = create.isPending || update.isPending;

  useEffect(() => setForm(toForm(opportunity)), [opportunity]);

  const set = (key: keyof FormState, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const base = {
      businessCustomerId: Number(form.businessCustomerId),
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      stage: form.stage,
      estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : 0,
      expectedCloseDate: form.expectedCloseDate || undefined,
      ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : undefined,
    };
    if (!base.businessCustomerId || !base.name) return;
    const onSuccess = (saved: Opportunity) => onSaved(saved);
    if (opportunity) {
      const data: OpportunityUpdate = { ...base, expectedCloseDate: base.expectedCloseDate || null, ownerUserId: base.ownerUserId ?? null };
      update.mutate({ opportunityId: opportunity.id, data }, { onSuccess });
    } else {
      create.mutate({ data: base as OpportunityInput }, { onSuccess });
    }
  };

  return (
    <Modal title={isEditing ? 'Edit opportunity' : 'New opportunity'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Opportunity name</span>
            <Input autoFocus required maxLength={180} value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="North campus expansion" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Business customer</span>
            <Select value={form.businessCustomerId} onValueChange={(value) => set('businessCustomerId', value)}>
              <SelectTrigger aria-label="Business customer"><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent className="bg-popover">
                {(customers.data ?? []).map((customer) => <SelectItem key={customer.id} value={String(customer.id)}>{customer.companyName}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Stage</span>
            <Select value={form.stage} onValueChange={(value) => set('stage', value as OpportunityStage)}>
              <SelectTrigger aria-label="Opportunity stage"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover">{stages.map((stage) => <SelectItem key={stage.value} value={stage.value}>{stage.label}</SelectItem>)}</SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner</span>
            <Select value={form.ownerUserId || 'unassigned'} onValueChange={(value) => set('ownerUserId', value === 'unassigned' ? '' : value)}>
              <SelectTrigger aria-label="Opportunity owner"><SelectValue placeholder="Unassigned" /></SelectTrigger>
              <SelectContent className="bg-popover">
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {(members.data ?? []).map((member) => <SelectItem key={member.userId} value={String(member.userId)}>{member.displayName || member.email || `Member ${member.userId}`}</SelectItem>)}
              </SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Estimated value</span>
            <Input type="number" min="0" step="1" value={form.estimatedValue} onChange={(e) => set('estimatedValue', e.target.value)} placeholder="0" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Expected close date</span>
            <Input type="date" value={form.expectedCloseDate} onChange={(e) => set('expectedCloseDate', e.target.value)} />
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Description</span>
          <Textarea maxLength={5000} value={form.description} onChange={(e) => set('description', e.target.value)} placeholder="What does the team need to know about this opportunity?" rows={4} />
        </label>
        {(create.isError || update.isError) && <p role="alert" className="text-xs text-destructive">This opportunity could not be saved. Check the fields and try again.</p>}
        <div className="flex justify-end gap-3 border-t border-border pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={pending || !form.name.trim() || !form.businessCustomerId}>{pending ? 'Saving…' : isEditing ? 'Save changes' : 'Create opportunity'}</Button>
        </div>
      </form>
    </Modal>
  );
}

function OpportunityDetail({ id }: { id: number }) {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { activeRole } = useTenant();
  const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const query = useGetOpportunity(id, { query: { queryKey: getGetOpportunityQueryKey(id) } });
  const [editing, setEditing] = useState(false);
  const remove = useDeleteOpportunity();

  if (query.isLoading) return <LoadingPanel lines={7} />;
  if (query.isError || !query.data) return <ErrorPanel onRetry={() => query.refetch()} />;
  const opportunity = query.data;
  const stageName = stages.find((item) => item.value === opportunity.stage)?.label ?? opportunity.stage;
  const deleteRecord = () => {
    if (!window.confirm(`Delete ${opportunity.name}?`)) return;
    remove.mutate({ opportunityId: opportunity.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey() });
        setLocation('/opportunities');
      },
    });
  };
  return (
    <div className="animate-rise">
      <PageTitle eyebrow={opportunity.opportunityNumber} title={opportunity.name} description={`${opportunity.customerName} · Opportunity record`} action={<div className="flex gap-2">{canEdit && <Button variant="outline" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</Button>}{(activeRole === 'owner' || activeRole === 'admin') && <Button variant="danger" onClick={deleteRecord} disabled={remove.isPending}><Trash2 size={15} /> Delete</Button>}</div>} />
      <div className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center justify-between"><span className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Pipeline status</span><Badge tone={stageTone(opportunity.stage)}>{stageName}</Badge></div>
          <dl className="grid gap-5 sm:grid-cols-2">
            <div><dt className="text-xs text-muted-foreground">Estimated value</dt><dd className="mono mt-1 text-xl font-semibold">{currency.format(opportunity.estimatedValue)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Expected close</dt><dd className="mt-1 text-sm font-semibold">{shortDate(opportunity.expectedCloseDate)}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Owner</dt><dd className="mt-1 text-sm font-semibold">{opportunity.owner?.displayName || opportunity.owner?.email || 'Unassigned'}</dd></div>
            <div><dt className="text-xs text-muted-foreground">Customer</dt><dd className="mt-1 text-sm font-semibold">{opportunity.customerName}</dd></div>
          </dl>
          {opportunity.description && <div className="mt-6 border-t border-border pt-5"><p className="mb-1 text-xs text-muted-foreground">Description</p><p className="whitespace-pre-wrap text-sm leading-6">{opportunity.description}</p></div>}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <p className="mono mb-4 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Record details</p>
          <div className="space-y-4 text-sm"><p><span className="block text-xs text-muted-foreground">Created</span>{shortDate(opportunity.createdAt)}</p><p><span className="block text-xs text-muted-foreground">Last updated</span>{shortDate(opportunity.updatedAt)}</p></div>
        </section>
      </div>
      {editing && <OpportunityForm opportunity={opportunity} onClose={() => setEditing(false)} onSaved={(saved) => { queryClient.setQueryData(getGetOpportunityQueryKey(id), saved); queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey() }); setEditing(false); }} />}
    </div>
  );
}

export function Opportunities() {
  const params = useParams<{ id?: string }>();
  const opportunityId = params.id ? Number(params.id) : null;
  if (opportunityId && Number.isFinite(opportunityId)) return <OpportunityDetail id={opportunityId} />;
  return <OpportunityList />;
}

function OpportunityList() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { activeRole } = useTenant();
  const canEdit = activeRole === 'owner' || activeRole === 'admin' || activeRole === 'member';
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [ownerUserId, setOwnerUserId] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Opportunity>();
  const params = useMemo(() => ({ search: search || undefined, stage: stage ? stage as OpportunityStage : undefined, ownerUserId: ownerUserId ? Number(ownerUserId) : undefined }), [search, stage, ownerUserId]);
  const query = useListOpportunities(params, { query: { queryKey: getListOpportunitiesQueryKey(params) } });
  const members = useListTenantMembers({ query: { queryKey: getListTenantMembersQueryKey() } });
  const remove = useDeleteOpportunity();
  const opportunities = query.data ?? [];
  const total = opportunities.reduce((sum, item) => sum + (item.estimatedValue || 0), 0);
  const clear = () => { setSearch(''); setStage(''); setOwnerUserId(''); };
  const save = (saved: Opportunity) => { queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey() }); setShowForm(false); setEditing(undefined); if (!editing) setLocation(`/opportunities/${saved.id}`); };

  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Pipeline workspace" title="Opportunities" description="The accountable path from first conversation to awarded work." action={canEdit ? <Button onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={16} /> New opportunity</Button> : undefined} />
      <div className="mb-5 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible opportunities</p><p className="mt-2 text-2xl font-semibold">{opportunities.length}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Visible pipeline</p><p className="mono mt-2 text-2xl font-semibold">{currency.format(total)}</p></div>
        <div className="rounded-xl border border-border bg-card p-4"><p className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Open stages</p><p className="mt-2 text-2xl font-semibold">{opportunities.filter((item) => item.stage !== 'won' && item.stage !== 'lost').length}</p></div>
      </div>
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row">
        <label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><Input aria-label="Search opportunities" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search opportunity or customer" className="h-10 border-transparent bg-secondary/65 pl-9 focus:border-primary/30 focus:bg-background" /></label>
        <Select value={stage || 'all'} onValueChange={(value) => setStage(value === 'all' ? '' : value)}><SelectTrigger aria-label="Filter by stage" className="h-10 border-transparent bg-secondary/65 md:w-44"><SelectValue placeholder="All stages" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All stages</SelectItem>{stages.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select>
        <Select value={ownerUserId || 'all'} onValueChange={(value) => setOwnerUserId(value === 'all' ? '' : value)}><SelectTrigger aria-label="Filter by owner" className="h-10 border-transparent bg-secondary/65 md:w-48"><SelectValue placeholder="All owners" /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="all">All owners</SelectItem>{(members.data ?? []).map((member) => <SelectItem key={member.userId} value={String(member.userId)}>{member.displayName || member.email || `Member ${member.userId}`}</SelectItem>)}</SelectContent></Select>
        {(search || stage || ownerUserId) && <Button variant="ghost" onClick={clear}>Clear</Button>}
      </div>
       {query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : opportunities.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No opportunities match that view" text={search || stage || ownerUserId ? 'Try a different search or clear your filters.' : 'Capture the first accountable step toward awarded work.'} action={canEdit ? <Button onClick={() => setShowForm(true)}><Plus size={15} /> Add opportunity</Button> : undefined} /> : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1.5fr_1fr_130px_130px_130px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">{['Opportunity', 'Owner', 'Stage', 'Value', 'Close date', ''].map((label) => <span key={label} className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">{label}</span>)}</div>
           <div className="divide-y divide-border">{opportunities.map((opportunity) => <div key={opportunity.id} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.5fr_1fr_130px_130px_130px_44px] md:items-center md:gap-4">
            <Link href={`/opportunities/${opportunity.id}`} className="min-w-0"><p className="mono text-[10px] text-accent">{opportunity.opportunityNumber}</p><p className="truncate text-sm font-bold">{opportunity.name}</p><p className="truncate text-xs text-muted-foreground">{opportunity.customerName}</p></Link>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><UserRound size={13} />{opportunity.owner?.displayName || opportunity.owner?.email || 'Unassigned'}</p>
            <Badge tone={stageTone(opportunity.stage)}>{stages.find((item) => item.value === opportunity.stage)?.label ?? opportunity.stage}</Badge>
            <p className="mono text-sm font-medium">{currency.format(opportunity.estimatedValue)}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><CalendarDays size={13} />{shortDate(opportunity.expectedCloseDate)}</p>
             <div className="flex justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">{canEdit && <Button variant="ghost" className="p-2" aria-label={`Edit ${opportunity.name}`} onClick={() => { setEditing(opportunity); setShowForm(true); }}><Pencil size={15} /></Button>}{(activeRole === 'owner' || activeRole === 'admin') && <Button variant="ghost" className="p-2" aria-label={`Delete ${opportunity.name}`} onClick={() => { if (window.confirm(`Delete ${opportunity.name}?`)) remove.mutate({ opportunityId: opportunity.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey() }) }); }}><Trash2 size={15} /></Button>}</div>
          </div>)}</div>
        </div>
      )}
      {showForm && <OpportunityForm opportunity={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} onSaved={save} />}
    </div>
  );
}

export default Opportunities;