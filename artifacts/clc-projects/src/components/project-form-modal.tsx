import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronDown, Plus } from 'lucide-react';
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
import { CustomerSelector } from '@/components/customer-selector';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/construct-lifecycle-design-system/components/ui/popover';
import {
  PRODUCT_CATEGORY_OPTIONS,
  PROJECT_CATEGORY_OPTIONS,
  optionsWithCurrentValue,
  productOptionsWithCurrentValues,
} from '@/lib/project-category-options';

type ProjectForm = {
  customerName: string; businessCustomerId?: number; newCustomer?: BusinessCustomerInput; projectName: string; address: string; category: string;
  productCategories: string[]; ownerUserId: string; stage: string; proposalStatus: string;
  proposalDetails: string; bidOutcome: string; contractStatus: string; contractValue: string;
  contractDetails: string; contractStart: string; contractEnd: string; deliveryPercent: string;
  requirementsSummary: string; billingStatus: string; invoicedAmount: string;
  receivedAmount: string; billingDetails: string; closeoutStatus: string;
  closeoutDetails: string; nextFollowUp: string;
};

const emptyProjectForm: ProjectForm = {
  customerName: '', projectName: '', address: '', category: 'Residential',
  productCategories: [], ownerUserId: '', stage: 'opportunity', proposalStatus: 'not_started',
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
  productCategories: project.productCategories ?? [],
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
  productCategories: form.productCategories,
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

  const set = <Key extends keyof ProjectForm>(key: Key, value: ProjectForm[Key]) =>
    setForm((current) => ({ ...current, [key]: value }));
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

  const select = (key: keyof ProjectForm, label: string, options: readonly { value: string; label: string }[]) => (
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

  const productCategoryOptions = productOptionsWithCurrentValues(form.productCategories);
  const productCategoryLabels = new Map(productCategoryOptions.map((option) => [option.value, option.label]));
  const productCategoryPicker = (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Product categories</span>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label="Product categories"
            className="flex min-h-11 w-full items-center justify-between gap-3 rounded-lg border border-input bg-background px-3 py-2.5 text-left text-sm outline-none focus-visible:ring-4 focus-visible:ring-primary/20"
          >
            <span className={form.productCategories.length ? 'flex flex-wrap gap-1.5' : 'text-muted-foreground'}>
              {form.productCategories.length
                ? form.productCategories.map((value) => (
                  <span key={value} className="rounded-md bg-secondary px-2 py-0.5 text-xs font-semibold">
                    {productCategoryLabels.get(value) ?? value}
                  </span>
                ))
                : 'Select product categories'}
            </span>
            <ChevronDown size={15} className="shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(360px,calc(100vw-2rem))] border-border bg-popover p-1 text-popover-foreground shadow-lg">
          <div className="max-h-64 overflow-y-auto">
            {productCategoryOptions.map((option) => {
              const selected = form.productCategories.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={selected}
                  className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => set('productCategories', selected
                    ? form.productCategories.filter((value) => value !== option.value)
                    : [...form.productCategories, option.value])}
                >
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`}>
                    {selected && <Check size={12} aria-hidden="true" />}
                  </span>
                  {option.label}
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
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
          {select('category', 'Category', optionsWithCurrentValue(PROJECT_CATEGORY_OPTIONS, form.category))}
          {productCategoryPicker}
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
