import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Building2, CheckCircle2, Copy, CreditCard, Eye, Mail, Megaphone, Pause, Play, Plus, Rocket, ShieldAlert, Trash2, Workflow } from 'lucide-react';
import { Link, useLocation } from 'wouter';
import {
  BusinessType,
  PlatformCustomerStatus,
  UpdatePlatformCustomerInputStatus,
  getListPlatformBillingPlansQueryKey,
  getListPlatformCustomersQueryKey,
  getGetPlatformCustomerQueryKey,
  getGetTenantContextQueryKey,
  useCreatePlatformBillingPlan,
  useCreatePlatformCustomer,
  useListPlatformBillingPlans,
  useListPlatformCustomers,
  useUpdatePlatformCustomer,
  useGetPlatformCustomer,
  useSwitchTenant,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
import { BUSINESS_TYPE_OPTIONS, businessTypeLabel } from '@/lib/business-profile';
import { PlatformCustomerAccess } from '@/pages/platform-customer-access';

const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';

function isPlatformPermissionError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { status?: unknown }).status === 403;
}

function platformPermissionMessage(error: unknown): string {
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : null;
  const message = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  return typeof message === 'string' && message.trim() ? message : 'Platform administrator permission required.';
}

function platformCustomerCreationMessage(error: unknown): string {
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : null;
  const message = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  return typeof message === 'string' && message.trim()
    ? message
    : 'Customer workspace setup failed. No workspace was created. Please try again.';
}

export function PlatformCustomers() {
  const qc = useQueryClient();
  const customers = useListPlatformCustomers({ query: { queryKey: getListPlatformCustomersQueryKey() } });
  const plans = useListPlatformBillingPlans({ query: { queryKey: getListPlatformBillingPlansQueryKey(), retry: false } });
  const create = useCreatePlatformCustomer();
  const update = useUpdatePlatformCustomer();
  const [selectedCustomerId, setSelectedCustomerId] = useState<number | null>(null);
  const selectedCustomer = useGetPlatformCustomer(selectedCustomerId ?? 0, {
    query: {
      enabled: selectedCustomerId !== null,
      queryKey: getGetPlatformCustomerQueryKey(selectedCustomerId ?? 0),
    },
  });
  const createPlan = useCreatePlatformBillingPlan();
  const switchTenant = useSwitchTenant();
  const [, setLocation] = useLocation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [businessTypes, setBusinessTypes] = useState<BusinessType[]>([BusinessType['general-contractor']]);
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [planName, setPlanName] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [annualAmount, setAnnualAmount] = useState('');
  const [onboardedCustomer, setOnboardedCustomer] = useState<{ id: number; name: string; invitationToken?: string | null } | null>(null);

  if (customers.isLoading) return <><PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." /><LoadingPanel lines={6} /></>;
  if (customers.isError) {
    if (isPlatformPermissionError(customers.error)) {
      return (
        <div className="animate-rise">
          <PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." />
          <div role="alert" className="rounded-xl border border-status-warning/30 bg-card p-6 shadow-[0_1px_0_hsl(var(--border))]">
            <div className="flex items-start gap-4">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-status-warning/10 text-status-warning"><ShieldAlert size={19} /></span>
              <div><h2 className="text-base font-bold">Platform access required</h2><p className="mt-1 text-sm text-muted-foreground">{platformPermissionMessage(customers.error)}</p><p className="mt-3 text-xs leading-5 text-muted-foreground">Ask an existing platform administrator to grant this account access, then retry.</p><Button className="mt-4" variant="outline" onClick={() => customers.refetch()}>Retry</Button></div>
            </div>
          </div>
        </div>
      );
    }
    return <ErrorPanel onRetry={() => customers.refetch()} />;
  }

  const refresh = () => qc.invalidateQueries({ queryKey: getListPlatformCustomersQueryKey() });
  const openWorkflowManager = (tenantId: number) => {
    switchTenant.mutate({ data: { tenantId } }, {
      onSuccess: (context) => {
        qc.setQueryData(getGetTenantContextQueryKey(), context);
        qc.clear();
        setLocation('/settings/administration/workflows');
      },
    });
  };
  const refreshPlans = () => qc.invalidateQueries({ queryKey: getListPlatformBillingPlansQueryKey() });
  const toggleBusinessType = (businessType: BusinessType) => {
    setBusinessTypes((current) =>
      current.includes(businessType)
        ? current.filter((item) => item !== businessType)
        : [...current, businessType],
    );
  };
  return (
    <div className="animate-rise">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." />
        <Link href="/administration/platform/features" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs font-bold text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <Megaphone size={14} /> Feature visibility
        </Link>
      </div>
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-bold">Customer workspaces</h2>
          {(customers.data ?? []).length === 0 ? <EmptyState icon={Building2} title="No customers yet" text="Create a customer workspace to get started." /> : <div className="space-y-3">{(customers.data ?? []).map((customer) => <div key={customer.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{customer.name}</p><p className="mono truncate text-[10px] text-muted-foreground">{customer.slug} · {customer.memberCount} members · {customer.pendingInvitationCount} pending · {customer.environments.length} environments</p><div className="mt-2 flex flex-wrap gap-1.5">{customer.businessTypes.map((businessType) => <Badge key={businessType} tone="teal">{businessTypeLabel(businessType)}</Badge>)}</div></div><Badge tone={customer.status === PlatformCustomerStatus.active ? 'green' : 'red'}>{customer.status}</Badge><Button variant="outline" onClick={() => setSelectedCustomerId(customer.id)}><Eye size={14} /> Inspect</Button><Button variant="outline" disabled={customer.status !== 'active' || switchTenant.isPending} onClick={() => openWorkflowManager(customer.id)}><Workflow size={14} /> Manage workflow</Button><Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ tenantId: customer.id, data: { status: customer.status === 'active' ? UpdatePlatformCustomerInputStatus.suspended : UpdatePlatformCustomerInputStatus.active } }, { onSuccess: refresh })}>{customer.status === 'active' ? <><Pause size={14} /> Suspend</> : <><Play size={14} /> Reactivate</>}</Button></div>)}</div>}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Plus size={16} /></span><h2 className="text-base font-bold">Create customer</h2></div>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); if (businessTypes.length === 0) return; create.mutate({ data: { name, slug, ownerEmail: ownerEmail || null, businessTypes } }, { onSuccess: (result) => { setName(''); setSlug(''); setOwnerEmail(''); setBusinessTypes([BusinessType['general-contractor']]); setOnboardedCustomer({ id: result.customer.id, name: result.customer.name, invitationToken: result.invitationToken }); refresh(); if (result.invitationToken) setLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${result.invitationToken}`); } }); }}>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Customer name</span><input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Slug</span><input required pattern="[a-z0-9][a-z0-9-]{2,62}" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} className={inputClass} placeholder="acme-builders" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner email <span className="font-normal text-muted-foreground">(optional)</span></span><input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} className={inputClass} /></label>
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-xs font-semibold text-muted-foreground">Business type <span className="font-normal">(select all that apply)</span></legend>
              {BUSINESS_TYPE_OPTIONS.map((option) => (
                <label key={option.value} className="flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40 has-[:checked]:border-primary/50 has-[:checked]:bg-primary/5">
                  <input
                    type="checkbox"
                    checked={businessTypes.includes(option.value)}
                    onChange={() => toggleBusinessType(option.value)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold">{option.label}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{option.description}</span>
                  </span>
                </label>
              ))}
              {businessTypes.length === 0 && <p role="alert" className="text-xs text-destructive">Select at least one business type.</p>}
            </fieldset>
            <Button type="submit" disabled={create.isPending || businessTypes.length === 0}><Plus size={15} /> {create.isPending ? 'Creating…' : 'Create customer'}</Button>
            {create.isError && <p role="alert" className="text-xs text-destructive">{platformCustomerCreationMessage(create.error)}</p>}
          </form>
          {link && <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-semibold">One-time owner invitation link</p><div className="mt-2 flex gap-2"><input readOnly value={link} aria-label="Owner invitation link" className={`${inputClass} text-xs`} /><Button variant="outline" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</Button></div></div>}
        </section>
      </div>
      {selectedCustomerId !== null && selectedCustomer.isLoading && <section className="mt-6 rounded-xl border border-border bg-card p-5"><LoadingPanel lines={5} /></section>}
      {selectedCustomerId !== null && selectedCustomer.isError && <section className="mt-6 rounded-xl border border-border bg-card p-5"><ErrorPanel onRetry={() => selectedCustomer.refetch()} /></section>}
      {selectedCustomerId !== null && selectedCustomer.data && (
        <PlatformCustomerAccess tenantId={selectedCustomerId} details={selectedCustomer.data} />
      )}
      {onboardedCustomer && (
        <section className="mt-6 rounded-xl border border-primary/25 bg-primary/5 p-5">
          <div className="flex flex-wrap items-start gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Rocket size={19} /></span>
            <div className="min-w-0 flex-1">
              <p className="mono text-[10px] font-bold uppercase tracking-[.14em] text-primary">Onboarding started</p>
              <h2 className="mt-1 text-base font-bold">{onboardedCustomer.name} is ready for setup</h2>
              <p className="mt-1 text-sm leading-6 text-muted-foreground">Both customer environments and their default lifecycle workflows are provisioned. Finish the workflow review, then share the owner invitation.</p>
              <div className="mt-4 grid gap-2 sm:grid-cols-3">
                <div className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 size={15} className="text-status-success" /> Workspace created</div>
                <div className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 size={15} className="text-status-success" /> Environments ready</div>
                <div className="flex items-center gap-2 text-xs font-semibold"><CheckCircle2 size={15} className="text-status-success" /> Default workflows ready</div>
              </div>
              <div className="mt-5 flex flex-wrap gap-2">
                <Button onClick={() => openWorkflowManager(onboardedCustomer.id)} disabled={switchTenant.isPending}><Workflow size={14} /> Review workflow <ArrowRight size={14} /></Button>
                {onboardedCustomer.invitationToken && <Button variant="outline" onClick={() => setLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${onboardedCustomer.invitationToken}`)}>View owner invite</Button>}
              </div>
            </div>
          </div>
        </section>
      )}
      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><CreditCard size={16} /></span><div><h2 className="text-base font-bold">Subscription plans</h2><p className="text-xs text-muted-foreground">Products and monthly/annual prices are created in Stripe.</p></div></div>
        <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
          <div>{plans.isLoading ? <LoadingPanel lines={3} /> : plans.isError ? <p className="text-xs text-muted-foreground">Plan catalog is unavailable until the Stripe connection is ready.</p> : (plans.data ?? []).length === 0 ? <EmptyState icon={CreditCard} title="No plans published" text="Create the first plan to make checkout available to customer administrators." /> : <div className="grid gap-3 md:grid-cols-2">{plans.data!.map((plan) => <div key={plan.productId} className="rounded-lg border border-border bg-background p-4"><div className="flex items-start justify-between gap-3"><p className="text-sm font-bold">{plan.name}</p><Badge tone={plan.active ? 'green' : 'neutral'}>{plan.active ? 'active' : 'inactive'}</Badge></div><p className="mt-2 text-xs text-muted-foreground">{plan.prices.length} recurring prices · {Object.keys(plan.entitlements).length} entitlements</p></div>)}</div>}</div>
          <form className="space-y-4 rounded-lg border border-border bg-background p-4" onSubmit={(event) => { event.preventDefault(); createPlan.mutate({ data: { name: planName, monthlyAmount: Math.round(Number(monthlyAmount) * 100), annualAmount: Math.round(Number(annualAmount) * 100), entitlements: { projects: true, billing: true }, limits: {} } }, { onSuccess: () => { setPlanName(''); setMonthlyAmount(''); setAnnualAmount(''); refreshPlans(); } }); }}>
            <p className="text-sm font-bold">Create a plan</p>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Plan name</span><input required minLength={2} value={planName} onChange={(event) => setPlanName(event.target.value)} className={inputClass} placeholder="Growth" /></label>
            <div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Monthly (USD)</span><input required min="0" step="0.01" type="number" value={monthlyAmount} onChange={(event) => setMonthlyAmount(event.target.value)} className={inputClass} /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Annual (USD)</span><input required min="0" step="0.01" type="number" value={annualAmount} onChange={(event) => setAnnualAmount(event.target.value)} className={inputClass} /></label></div>
            <Button type="submit" disabled={createPlan.isPending}>{createPlan.isPending ? 'Creating…' : 'Create Stripe plan'}</Button>
            {createPlan.isError && <p role="alert" className="text-xs text-destructive">Plan creation failed. Check the Stripe connection and try again.</p>}
          </form>
        </div>
      </section>
    </div>
  );
}