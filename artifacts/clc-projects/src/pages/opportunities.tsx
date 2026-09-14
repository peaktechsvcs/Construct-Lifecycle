import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, BriefcaseBusiness, CalendarDays, CheckCircle2, Clock3, Mail, MessageSquareText, Pencil, Phone, Plus, Search, Trash2, UserRound } from 'lucide-react';
import {
  Opportunity,
  OpportunityStage,
  OpportunityInput,
  OpportunityUpdate,
  OpportunityActivityInputActivityType,
  useListOpportunities,
  getListOpportunitiesQueryKey,
  useCreateOpportunity,
  useGetOpportunity,
  getGetOpportunityQueryKey,
  useGetOpportunityPreconstruction,
  getGetOpportunityPreconstructionQueryKey,
  useCreateOpportunityActivity,
  useUpdateOpportunityActivity,
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
import NotFound from '@/pages/not-found';

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

const crmTone = (status: string) => {
  if (status === 'synced') return 'green' as const;
  if (status === 'error') return 'red' as const;
  if (status === 'pending') return 'orange' as const;
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
  leadSource: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  qualification: 'unqualified' | 'qualified' | 'disqualified';
  nextAction: string;
  nextActionDate: string;
  crmProviderKey: string;
  crmIntegrationStatus: 'manual' | 'pending' | 'synced' | 'error';
  crmExternalReference: string;
};

const emptyForm: FormState = {
  businessCustomerId: '',
  name: '',
  description: '',
  stage: 'new',
  estimatedValue: '',
  expectedCloseDate: '',
  ownerUserId: '',
  leadSource: '',
  contactName: '',
  contactEmail: '',
  contactPhone: '',
  qualification: 'unqualified',
  nextAction: '',
  nextActionDate: '',
  crmProviderKey: '',
  crmIntegrationStatus: 'manual',
  crmExternalReference: '',
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
    leadSource: opportunity.leadSource ?? '',
    contactName: opportunity.contactName ?? '',
    contactEmail: opportunity.contactEmail ?? '',
    contactPhone: opportunity.contactPhone ?? '',
    qualification: opportunity.qualification,
    nextAction: opportunity.nextAction ?? '',
    nextActionDate: opportunity.nextActionDate?.slice(0, 10) ?? '',
    crmProviderKey: opportunity.crmProviderKey ?? '',
    crmIntegrationStatus: opportunity.crmIntegrationStatus,
    crmExternalReference: opportunity.crmExternalReference ?? '',
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
      leadSource: form.leadSource.trim() || undefined,
      contactName: form.contactName.trim() || undefined,
      contactEmail: form.contactEmail.trim() || undefined,
      contactPhone: form.contactPhone.trim() || undefined,
      qualification: form.qualification,
      nextAction: form.nextAction.trim() || undefined,
      nextActionDate: form.nextActionDate || undefined,
      crmProviderKey: form.crmProviderKey.trim() || undefined,
      crmIntegrationStatus: form.crmIntegrationStatus,
      crmExternalReference: form.crmExternalReference.trim() || undefined,
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
        <div className="grid gap-4 md:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Primary contact</span>
            <Input maxLength={160} value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Decision maker" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Contact email</span>
            <Input type="email" maxLength={320} value={form.contactEmail} onChange={(e) => set('contactEmail', e.target.value)} placeholder="name@customer.com" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Contact phone</span>
            <Input maxLength={40} value={form.contactPhone} onChange={(e) => set('contactPhone', e.target.value)} placeholder="Optional phone" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Lead source</span>
            <Input maxLength={120} value={form.leadSource} onChange={(e) => set('leadSource', e.target.value)} placeholder="Referral, website, event…" />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Qualification</span>
            <Select value={form.qualification} onValueChange={(value) => set('qualification', value as FormState['qualification'])}>
              <SelectTrigger aria-label="Opportunity qualification"><SelectValue /></SelectTrigger>
              <SelectContent className="bg-popover"><SelectItem value="unqualified">Unqualified</SelectItem><SelectItem value="qualified">Qualified</SelectItem><SelectItem value="disqualified">Disqualified</SelectItem></SelectContent>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Next action date</span>
            <Input type="date" value={form.nextActionDate} onChange={(e) => set('nextActionDate', e.target.value)} />
          </label>
          <label className="block md:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Next action</span>
            <Input maxLength={240} value={form.nextAction} onChange={(e) => set('nextAction', e.target.value)} placeholder="Schedule site walk with the customer" />
          </label>
        </div>
        <section className="rounded-lg border border-border bg-secondary/35 p-4">
          <p className="mono mb-3 text-[10px] uppercase tracking-[.13em] text-muted-foreground">CRM connection</p>
          <div className="grid gap-4 md:grid-cols-3">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Provider key</span><Input maxLength={80} value={form.crmProviderKey} onChange={(e) => set('crmProviderKey', e.target.value)} placeholder="hubspot or salesforce" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Sync status</span><Select value={form.crmIntegrationStatus} onValueChange={(value) => set('crmIntegrationStatus', value as FormState['crmIntegrationStatus'])}><SelectTrigger aria-label="CRM sync status"><SelectValue /></SelectTrigger><SelectContent className="bg-popover"><SelectItem value="manual">Manual</SelectItem><SelectItem value="pending">Ready to connect</SelectItem><SelectItem value="synced">Synced</SelectItem><SelectItem value="error">Sync error</SelectItem></SelectContent></Select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">External CRM ID</span><Input maxLength={180} value={form.crmExternalReference} onChange={(e) => set('crmExternalReference', e.target.value)} placeholder="Opportunity ID" /></label>
          </div>
        </section>
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
  const graph = useGetOpportunityPreconstruction(id, { query: { queryKey: getGetOpportunityPreconstructionQueryKey(id) } });
  const [editing, setEditing] = useState(false);
  const remove = useDeleteOpportunity();

  if (query.isLoading) return <LoadingPanel lines={7} />;
  if (query.isError || !query.data) return <ErrorPanel onRetry={() => query.refetch()} />;
  const opportunity = query.data;
  const graphData = graph.data;
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
          <p className="mono mb-4 text-[10px] uppercase tracking-[.13em] text-muted-foreground">Relationship details</p>
          <div className="space-y-4 text-sm">
            <p><span className="block text-xs text-muted-foreground">Primary contact</span>{opportunity.contactName || 'Not assigned'}{opportunity.contactEmail && <span className="block text-xs text-muted-foreground">{opportunity.contactEmail}</span>}{opportunity.contactPhone && <span className="block text-xs text-muted-foreground">{opportunity.contactPhone}</span>}</p>
            <p><span className="block text-xs text-muted-foreground">Lead source / qualification</span>{opportunity.leadSource || 'No source recorded'} · {opportunity.qualification}</p>
            <p><span className="block text-xs text-muted-foreground">Next action</span>{opportunity.nextAction || 'No next action'}{opportunity.nextActionDate && <span className="block text-xs text-muted-foreground">{shortDate(opportunity.nextActionDate)}</span>}</p>
            <div className="border-t border-border pt-4"><span className="mb-2 block text-xs text-muted-foreground">CRM connection</span><div className="flex items-center gap-2"><Badge tone={crmTone(opportunity.crmIntegrationStatus)}>{opportunity.crmProviderKey || 'Manual'}</Badge>{opportunity.crmExternalReference && <span className="mono text-xs text-muted-foreground">{opportunity.crmExternalReference}</span>}</div></div>
            <p><span className="block text-xs text-muted-foreground">Created / updated</span>{shortDate(opportunity.createdAt)} · {shortDate(opportunity.updatedAt)}</p>
          </div>
        </section>
      </div>
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_1fr]">
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Preconstruction graph</p>
              <p className="mt-1 text-sm text-muted-foreground">One path from opportunity to scope coverage, estimate, and proposal.</p>
            </div>
            {graphData && <div className="flex flex-wrap gap-2">{[
              ['Bids', graphData.summary.bidCount],
              ['Scopes', graphData.summary.scopeCount],
              ['Estimates', graphData.summary.estimateCount],
              ['Proposals', graphData.summary.proposalCount],
            ].map(([label, value]) => <span key={label} className="mono rounded-md bg-secondary px-2 py-1 text-[10px] text-muted-foreground">{label} {value}</span>)}</div>}
          </div>
          {graph.isLoading ? <LoadingPanel lines={4} /> : graph.isError ? <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-muted-foreground">Linked pipeline records are temporarily unavailable. The opportunity itself is still available.</div> : (graphData?.nodes.length ?? 0) === 0 ? <EmptyState icon={ArrowRight} title="No linked preconstruction records" text="Create a bid from this opportunity to keep takeoff, estimating, and proposals connected." /> : (
            <div className="space-y-2">
              {graphData?.nodes.map((node) => {
                const href = node.recordType === 'bid' ? `/bids/${node.id}` : node.recordType === 'estimate' ? `/estimates/${node.id}` : `/proposals/${node.id}`;
                const tone = node.recordType === 'proposal' ? 'violet' : node.recordType === 'estimate' ? 'teal' : 'neutral';
                return <Link key={`${node.recordType}-${node.id}`} href={href} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-secondary/40">
                  <span className="mono w-20 text-[10px] uppercase tracking-[.12em] text-accent">{node.recordType}</span>
                  <span className="min-w-0 flex-1"><span className="mono block text-[10px] text-muted-foreground">{node.recordNumber}</span><span className="block truncate text-sm font-semibold">{node.name}</span></span>
                  <Badge tone={tone}>{node.stage.replaceAll('_', ' ')}</Badge>
                  <span className="mono text-sm font-semibold">{currency.format(node.value)}</span>
                  {node.coverageGapCount !== null && node.coverageGapCount > 0 && <Badge tone="orange">{node.coverageGapCount} coverage gap{node.coverageGapCount === 1 ? '' : 's'}</Badge>}
                  <ArrowRight size={15} className="text-muted-foreground" />
                </Link>;
              })}
            </div>
          )}
        </section>
        <OpportunityActivityPanel
          opportunityId={id}
          activities={graphData?.activities ?? []}
          canEdit={canEdit}
          onChanged={() => {
            queryClient.invalidateQueries({ queryKey: getGetOpportunityPreconstructionQueryKey(id) });
            queryClient.invalidateQueries({ queryKey: getGetOpportunityQueryKey(id) });
          }}
        />
      </div>
      {editing && <OpportunityForm opportunity={opportunity} onClose={() => setEditing(false)} onSaved={(saved) => { queryClient.setQueryData(getGetOpportunityQueryKey(id), saved); queryClient.invalidateQueries({ queryKey: getListOpportunitiesQueryKey() }); setEditing(false); }} />}
    </div>
  );
}

function OpportunityActivityPanel({
  opportunityId,
  activities,
  canEdit,
  onChanged,
}: {
  opportunityId: number;
  activities: Array<{
    id: number;
    activityType: 'note' | 'call' | 'email' | 'meeting' | 'task';
    subject: string;
    body: string | null;
    occurredAt: string;
    nextActionDate: string | null;
    completed: boolean;
    actor: { displayName: string | null; email: string | null } | null;
  }>;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [activityType, setActivityType] = useState<OpportunityActivityInputActivityType>('note');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [nextActionDate, setNextActionDate] = useState('');
  const create = useCreateOpportunityActivity();
  const update = useUpdateOpportunityActivity();
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!subject.trim()) return;
    create.mutate({
      opportunityId,
      data: {
        activityType,
        subject: subject.trim(),
        body: body.trim() || undefined,
        nextActionDate: nextActionDate || undefined,
      },
    }, {
      onSuccess: () => {
        setSubject('');
        setBody('');
        setNextActionDate('');
        onChanged();
      },
    });
  };
  const activityIcon = (type: string) => type === 'call' ? Phone : type === 'email' ? Mail : type === 'task' ? CheckCircle2 : type === 'meeting' ? CalendarDays : MessageSquareText;
  return <section className="rounded-xl border border-border bg-card p-5">
    <div className="mb-4 flex items-start justify-between gap-3">
      <div><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Contact history</p><p className="mt-1 text-sm text-muted-foreground">Keep conversations, ownership, and next actions together.</p></div>
      <Badge tone={activities.filter((activity) => !activity.completed && activity.nextActionDate).length ? 'orange' : 'neutral'}>{activities.filter((activity) => !activity.completed && activity.nextActionDate).length} open</Badge>
    </div>
    {canEdit && <form onSubmit={submit} className="mb-5 space-y-3 rounded-lg border border-border bg-secondary/25 p-3">
      <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
        <Select value={activityType} onValueChange={(value) => setActivityType(value as OpportunityActivityInputActivityType)}>
          <SelectTrigger aria-label="Activity type"><SelectValue /></SelectTrigger>
          <SelectContent className="bg-popover"><SelectItem value="note">Note</SelectItem><SelectItem value="call">Call</SelectItem><SelectItem value="email">Email</SelectItem><SelectItem value="meeting">Meeting</SelectItem><SelectItem value="task">Task</SelectItem></SelectContent>
        </Select>
        <Input aria-label="Activity subject" required maxLength={240} value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What happened or what needs to happen next?" />
      </div>
      <Textarea aria-label="Activity details" maxLength={5000} rows={2} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Add context, decision notes, or a handoff detail." />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 size={14} /><span>Next action date</span><Input aria-label="Next action date" className="h-8 w-auto" type="date" value={nextActionDate} onChange={(event) => setNextActionDate(event.target.value)} /></label>
        <Button type="submit" className="h-8" disabled={create.isPending || !subject.trim()}><Plus size={14} />{create.isPending ? 'Recording…' : 'Record activity'}</Button>
      </div>
      {create.isError && <p role="alert" className="text-xs text-destructive">This activity could not be recorded.</p>}
    </form>}
    {activities.length === 0 ? <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">No contact history yet.</div> : <div className="space-y-3">
      {activities.map((activity) => {
        const Icon = activityIcon(activity.activityType);
        return <div key={activity.id} className={`flex gap-3 rounded-lg border p-3 ${activity.completed ? 'border-border/70 bg-secondary/20' : 'border-border'}`}>
          <Icon size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-start justify-between gap-2"><div><p className={`text-sm font-semibold ${activity.completed ? 'line-through text-muted-foreground' : ''}`}>{activity.subject}</p><p className="text-[11px] text-muted-foreground">{activity.activityType} · {new Date(activity.occurredAt).toLocaleDateString()} · {activity.actor?.displayName || activity.actor?.email || 'You'}</p></div>{canEdit && <Button variant="ghost" className="h-7 px-2 text-xs" disabled={update.isPending} onClick={() => update.mutate({ opportunityId, activityId: activity.id, data: { completed: !activity.completed } }, { onSuccess: onChanged })}>{activity.completed ? 'Reopen' : 'Complete'}</Button>}</div>
            {activity.body && <p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-muted-foreground">{activity.body}</p>}
            {activity.nextActionDate && <p className="mt-2 flex items-center gap-1.5 text-xs text-status-warning"><Clock3 size={13} />Next action {shortDate(activity.nextActionDate)}</p>}
          </div>
        </div>;
      })}
    </div>}
  </section>;
}

export function Opportunities() {
  const params = useParams<{ id?: string }>();
  const opportunityId = params.id ? Number(params.id) : null;
  if (params.id && (!Number.isInteger(opportunityId) || (opportunityId ?? 0) < 1)) return <NotFound />;
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