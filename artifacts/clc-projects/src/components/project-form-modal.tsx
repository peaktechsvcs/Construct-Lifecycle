import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus, Search, X } from 'lucide-react';
import {
  BusinessCustomerInput, Project, ProjectInput, ProjectStage, ProposalStatus, BidOutcome,
  ContractStatus, BillingStatus, CloseoutStatus,
  useCreateProject, useUpdateProject,
  useListBusinessCustomers, getListBusinessCustomersQueryKey,
  useListTenantMembers, getListTenantMembersQueryKey,
  getListProjectsQueryKey, getGetProjectQueryKey, getGetDashboardSummaryQueryKey, getGetDashboardDrilldownQueryKey,
} from '@workspace/api-client-react';
import { Modal, Button } from '@/components/app-ui';
import { useTenant } from '@/providers/tenant-provider';
import { useWorkflow } from '@/hooks/use-workflow';

type ProjectForm = {
  customerName: string; businessCustomerId?: number; newCustomer?: BusinessCustomerInput; projectName: string; address: string; category: string;
  productCategories: string; ownerUserId: string; stage: string; proposalStatus: string;
  proposalDetails: string; bidOutcome: string; contractStatus: string; contractValue: string;
  contractDetails: string; contractStart: string; contractEnd: string; deliveryPercent: string;
  requirementsSummary: string; billingStatus: string; invoicedAmount: string;
  receivedAmount: string; billingDetails: string; closeoutStatus: string;
  closeoutDetails: string; nextFollowUp: string;
};

const emptyProjectForm: ProjectForm = {
  customerName: '', projectName: '', address: '', category: 'Residential',
  productCategories: '', ownerUserId: '', stage: 'opportunity', proposalStatus: 'not_started',
  proposalDetails: '', bidOutcome: 'pending', contractStatus: 'none', contractValue: '0',
  contractDetails: '', contractStart: '', contractEnd: '', deliveryPercent: '0',
  requirementsSummary: '', billingStatus: 'not_started', invoicedAmount: '0',
  receivedAmount: '0', billingDetails: '', closeoutStatus: 'not_started',
  closeoutDetails: '', nextFollowUp: '',
};

const formFromProject = (project: Project): ProjectForm => ({
  customerName: project.customerName,
  businessCustomerId: project.businessCustomerId ?? undefined,
  projectName: project.projectName,
  address: project.address || '',
  category: project.category,
  productCategories: project.productCategories?.join(', ') || '',
  ownerUserId: project.ownerUserId ? String(project.ownerUserId) : '',
  stage: project.stage,
  proposalStatus: project.proposalStatus,
  proposalDetails: project.proposalDetails || '',
  bidOutcome: project.bidOutcome,
  contractStatus: project.contractStatus,
  contractValue: String(project.contractValue ?? 0),
  contractDetails: project.contractDetails || '',
  contractStart: project.contractStart?.slice(0, 10) || '',
  contractEnd: project.contractEnd?.slice(0, 10) || '',
  deliveryPercent: String(project.deliveryPercent ?? 0),
  requirementsSummary: project.requirementsSummary || '',
  billingStatus: project.billingStatus,
  invoicedAmount: String(project.invoicedAmount ?? 0),
  receivedAmount: String(project.receivedAmount ?? 0),
  billingDetails: project.billingDetails || '',
  closeoutStatus: project.closeoutStatus,
  closeoutDetails: project.closeoutDetails || '',
  nextFollowUp: project.nextFollowUp?.slice(0, 10) || '',
});

const projectPayload = (form: ProjectForm): ProjectInput => ({
  businessCustomerId: form.businessCustomerId,
  newCustomer: form.newCustomer,
  customerName: form.customerName || undefined,
  projectName: form.projectName,
  address: form.address || undefined,
  category: form.category,
  productCategories: form.productCategories.split(',').map((s) => s.trim()).filter(Boolean),
  ownerUserId: form.ownerUserId ? Number(form.ownerUserId) : null,
  stage: form.stage as ProjectStage,
  proposalStatus: form.proposalStatus as ProposalStatus,
  proposalDetails: form.proposalDetails || undefined,
  bidOutcome: form.bidOutcome as BidOutcome,
  contractStatus: form.contractStatus as ContractStatus,
  contractValue: Number(form.contractValue) || 0,
  contractDetails: form.contractDetails || undefined,
  contractStart: form.contractStart || undefined,
  contractEnd: form.contractEnd || undefined,
  deliveryPercent: Math.min(100, Math.max(0, Number(form.deliveryPercent) || 0)),
  requirementsSummary: form.requirementsSummary || undefined,
  billingStatus: form.billingStatus as BillingStatus,
  invoicedAmount: Number(form.invoicedAmount) || 0,
  receivedAmount: Number(form.receivedAmount) || 0,
  billingDetails: form.billingDetails || undefined,
  closeoutStatus: form.closeoutStatus as CloseoutStatus,
  closeoutDetails: form.closeoutDetails || undefined,
  nextFollowUp: form.nextFollowUp || undefined,
});

function CustomerSelector({
  value,
  selectedId,
  onSelect,
  draft,
  onDraftChange,
}: {
  value: string;
  selectedId?: number;
  onSelect: (customer?: { id: number; companyName: string }) => void;
  draft?: BusinessCustomerInput;
  onDraftChange: (draft?: BusinessCustomerInput) => void;
}) {
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const customers = useListBusinessCustomers(search ? { search } : undefined, {
    query: { queryKey: getListBusinessCustomersQueryKey(search ? { search } : undefined), enabled: open },
  });
  const canCreate = useTenant().activeRole === 'owner' || useTenant().activeRole === 'admin';
  const selected = customers.data?.find((customer) => customer.id === selectedId);

  return (
    <div className="relative md:col-span-2">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Business customer</span>
      <div className="relative">
        <Search size={15} className="absolute left-3 top-3 text-muted-foreground" />
        <input
          data-testid="input-project-customer"
          value={draft?.companyName ?? (selected?.companyName || search)}
          onFocus={() => setOpen(true)}
          onChange={(event) => {
            setSearch(event.target.value);
            onSelect(undefined);
            onDraftChange(undefined);
            setOpen(true);
          }}
          placeholder="Search customers or type a new company"
          required
          className="w-full rounded-lg border border-input bg-background py-2.5 pl-9 pr-10 text-sm outline-none ring-primary/20 placeholder:text-muted-foreground/55 focus:ring-4"
        />
        {(selectedId || draft) && (
           <button type="button" aria-label="Clear selected customer" className="absolute right-3 top-2.5 text-muted-foreground" onClick={() => { onSelect(undefined); onDraftChange(undefined); setSearch(''); }}>
            <X size={15} />
          </button>
        )}
      </div>
      {open && (
        <div role="listbox" aria-label="Business customer results" className="absolute z-30 mt-1 w-full rounded-lg border border-border bg-card p-1 shadow-xl">
          {customers.data?.map((customer) => (
            <button
              type="button"
              role="option"
              aria-selected={customer.id === selectedId}
              key={customer.id}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary"
              onClick={() => { onSelect(customer); onDraftChange(undefined); setSearch(customer.companyName); setOpen(false); }}
            >
              <span className="min-w-0 flex-1 truncate">{customer.companyName}</span>
              <span className="text-[10px] text-muted-foreground">{customer.projectCount} projects</span>
              {customer.id === selectedId && <Check size={14} className="text-primary" />}
            </button>
          ))}
          {canCreate && search.trim() && !customers.data?.some((customer) => customer.companyName.toLowerCase() === search.trim().toLowerCase()) && (
            <button
              type="button"
              className="flex w-full items-center gap-2 rounded-md border-t border-border px-3 py-2.5 text-left text-sm font-semibold text-primary hover:bg-primary/5"
              onClick={() => { onSelect(undefined); onDraftChange({ companyName: search.trim() }); setOpen(false); }}
            >
              <Plus size={14} /> Create “{search.trim()}”
            </button>
          )}
          {!customers.isLoading && !customers.data?.length && !canCreate && (
            <p className="px-3 py-2 text-xs text-muted-foreground">No matching active customers.</p>
          )}
        </div>
      )}
      {draft && (
        <div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold text-primary">New customer details</p>
            <button type="button" aria-label="Remove new customer draft" onClick={() => onDraftChange(undefined)}><X size={14} /></button>
          </div>
          <div className="grid gap-2 md:grid-cols-3">
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">Primary contact<input aria-label="Primary contact" value={draft.primaryContact ?? ''} onChange={(e) => onDraftChange({ ...draft, primaryContact: e.target.value })} placeholder="Primary contact" className="rounded-md border border-input bg-background px-2.5 py-2 text-xs" /></label>
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">Email<input aria-label="Customer email" type="email" value={draft.email ?? ''} onChange={(e) => onDraftChange({ ...draft, email: e.target.value })} placeholder="Email" className="rounded-md border border-input bg-background px-2.5 py-2 text-xs" /></label>
            <label className="grid gap-1 text-[11px] font-semibold text-muted-foreground">Phone<input aria-label="Customer phone" value={draft.phone ?? ''} onChange={(e) => onDraftChange({ ...draft, phone: e.target.value })} placeholder="Phone" className="rounded-md border border-input bg-background px-2.5 py-2 text-xs" /></label>
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">This customer is created with the project so the form stays safe to cancel.</p>
        </div>
      )}
    </div>
  );
}

export function ProjectFormModal({
  project,
  initialCustomer,
  onClose,
  onCreated,
}: {
  project?: Project;
  initialCustomer?: { id: number; companyName: string };
  onClose: () => void;
  onCreated?: () => void;
}) {
  const [form, setForm] = useState<ProjectForm>(
    project
      ? formFromProject(project)
      : { ...emptyProjectForm, businessCustomerId: initialCustomer?.id, customerName: initialCustomer?.companyName || '' },
  );
  const create = useCreateProject();
  const update = useUpdateProject();
  const qc = useQueryClient();
  const workflow = useWorkflow();
  const tenant = useTenant();
  const members = useListTenantMembers({
    query: {
      queryKey: getListTenantMembersQueryKey(),
      enabled: tenant.activeRole === 'owner' || tenant.activeRole === 'admin' || tenant.activeRole === 'member',
    },
  });
  const stageOptions = workflow.states.map((state) => ({ value: state.stableKey, label: state.displayName }));

  const set = (key: keyof ProjectForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const setCustomer = (customer?: { id: number; companyName: string }) =>
    setForm((current) => ({
      ...current,
      businessCustomerId: customer?.id,
      customerName: customer?.companyName ?? '',
      newCustomer: undefined,
    }));
  const setCustomerDraft = (draft?: BusinessCustomerInput) =>
    setForm((current) => ({
      ...current,
      ...(draft
        ? {
          businessCustomerId: undefined,
          customerName: draft.companyName ?? current.customerName,
          newCustomer: draft,
        }
        : {
          newCustomer: undefined,
        }),
    }));

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data = projectPayload(form);
    if (project) {
      update.mutate(
        { projectId: project.id, data },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) });
            onClose();
          },
        },
      );
    } else {
      create.mutate(
        { data },
        {
          onSuccess: () => {
            qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
            qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
            qc.invalidateQueries({ queryKey: getGetDashboardDrilldownQueryKey() });
            onCreated ? onCreated() : onClose();
          },
        },
      );
    }
  };

  const pending = create.isPending || update.isPending;
  const mutationError = create.error || update.error;

  const input = (key: keyof ProjectForm, label: string, type = 'text', placeholder = '') => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        data-testid={`input-project-${key}`}
        type={type}
        value={String(form[key] ?? '')}
        placeholder={placeholder}
        onChange={(e) => set(key, e.target.value)}
        className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none ring-primary/20 placeholder:text-muted-foreground/55 focus:ring-4"
      />
    </label>
  );

  const select = (key: keyof ProjectForm, label: string, options: { value: string; label: string }[]) => (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <div className="relative">
        <select
          data-testid={`select-project-${key}`}
          value={String(form[key] ?? '')}
          onChange={(e) => set(key, e.target.value)}
          className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-primary/20"
        >
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground" />
      </div>
    </label>
  );

  return (
    <Modal title={project ? `Edit ${project.projectNumber}` : 'Create a new project'} onClose={onClose}>
      <form onSubmit={submit} className="space-y-6">
        <div className="grid gap-4 md:grid-cols-2">
          <CustomerSelector
            value={form.customerName}
            selectedId={form.businessCustomerId}
            onSelect={setCustomer}
            draft={form.newCustomer}
            onDraftChange={setCustomerDraft}
          />
          {input('projectName', 'Project name', 'text', 'e.g. Pacific Heights kitchen')}
          {input('address', 'Jobsite address', 'text', 'Street, city, state')}
           {select(
             'ownerUserId',
             'Assigned to',
             [{ value: '', label: 'Unassigned' }, ...(members.data ?? []).map((member) => ({
               value: String(member.userId),
               label: member.displayName || member.email || `User ${member.userId}`,
             }))],
           )}
        </div>
        {mutationError && <p role="alert" className="rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs text-destructive">This project could not be saved. Check the required fields and try again.</p>}
        <div className="grid gap-4 md:grid-cols-2">
          {input('category', 'Category', 'text', 'Residential or commercial')}
          {input('productCategories', 'Product categories', 'text', 'Materials, finishes, equipment')}
        </div>
        <div className="ink-rule pt-5">
          <p className="mb-4 text-sm font-bold">Lifecycle & value</p>
          <div className="grid gap-4 md:grid-cols-3">
            {select('stage', 'Current stage', stageOptions)}
            {select('proposalStatus', 'Proposal status',
              Object.entries(ProposalStatus).map(([v, l]) => ({ value: v, label: l.replace(/_/g, ' ') })))}
            {select('bidOutcome', 'Bid outcome',
              Object.entries(BidOutcome).map(([v, l]) => ({ value: v, label: l.replace(/_/g, ' ') })))}
            {select('contractStatus', 'Contract status',
              Object.entries(ContractStatus).map(([v, l]) => ({ value: v, label: l.replace(/_/g, ' ') })))}
            {input('contractValue', 'Contract value', 'number')}
            {input('deliveryPercent', 'Delivery progress %', 'number')}
          </div>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {input('contractStart', 'Contract start', 'date')}
          {input('contractEnd', 'Contract end', 'date')}
          {select('billingStatus', 'Billing status',
            Object.entries(BillingStatus).map(([v, l]) => ({ value: v, label: l.replace(/_/g, ' ') })))}
          {select('closeoutStatus', 'Closeout status',
            Object.entries(CloseoutStatus).map(([v, l]) => ({ value: v, label: l.replace(/_/g, ' ') })))}
          {input('invoicedAmount', 'Invoiced amount', 'number')}
          {input('receivedAmount', 'Received amount', 'number')}
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {input('nextFollowUp', 'Next follow-up', 'date')}
          {input('proposalDetails', 'Proposal notes', 'text', 'Scope, exclusions, decision context')}
          {input('requirementsSummary', 'Requirements summary', 'text', 'Materials, measurements, lead times')}
          {input('billingDetails', 'Billing notes', 'text', 'Deposit, invoice timing, terms')}
        </div>
        <div className="flex justify-end gap-3 border-t border-border pt-5">
          <Button data-testid="button-cancel-project" type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="button-save-project"
            type="submit"
            disabled={pending || (!form.businessCustomerId && !form.newCustomer) || !form.projectName}
          >
            {pending ? 'Saving…' : project ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
