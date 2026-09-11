import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Building2, Copy, CreditCard, Pause, Play, Plus, ShieldAlert } from 'lucide-react';
import {
  PlatformCustomerStatus,
  UpdatePlatformCustomerInputStatus,
  getListPlatformBillingPlansQueryKey,
  getListPlatformCustomersQueryKey,
  useCreatePlatformBillingPlan,
  useCreatePlatformCustomer,
  useListPlatformBillingPlans,
  useListPlatformCustomers,
  useUpdatePlatformCustomer,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';

const inputClass = 'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';

function isPlatformPermissionError(error: unknown): boolean {
  return !!error && typeof error === 'object' && (error as { status?: unknown }).status === 403;
}

function platformPermissionMessage(error: unknown): string {
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : null;
  const message = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  return typeof message === 'string' && message.trim() ? message : 'Platform administrator permission required.';
}

export function PlatformCustomers() {
  const qc = useQueryClient();
  const customers = useListPlatformCustomers({ query: { queryKey: getListPlatformCustomersQueryKey() } });
  const plans = useListPlatformBillingPlans({ query: { queryKey: getListPlatformBillingPlansQueryKey(), retry: false } });
  const create = useCreatePlatformCustomer();
  const update = useUpdatePlatformCustomer();
  const createPlan = useCreatePlatformBillingPlan();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [planName, setPlanName] = useState('');
  const [monthlyAmount, setMonthlyAmount] = useState('');
  const [annualAmount, setAnnualAmount] = useState('');

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
  const refreshPlans = () => qc.invalidateQueries({ queryKey: getListPlatformBillingPlansQueryKey() });
  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Platform" title="Customers" description="Onboard and control customer workspaces." />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-4 text-base font-bold">Customer workspaces</h2>
          {(customers.data ?? []).length === 0 ? <EmptyState icon={Building2} title="No customers yet" text="Create a customer workspace to get started." /> : <div className="space-y-3">{(customers.data ?? []).map((customer) => <div key={customer.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4"><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{customer.name}</p><p className="mono truncate text-[10px] text-muted-foreground">{customer.slug} · {customer.memberCount} members · {customer.pendingInvitationCount} pending</p></div><Badge tone={customer.status === PlatformCustomerStatus.active ? 'green' : 'red'}>{customer.status}</Badge><Button variant="outline" disabled={update.isPending} onClick={() => update.mutate({ tenantId: customer.id, data: { status: customer.status === 'active' ? UpdatePlatformCustomerInputStatus.suspended : UpdatePlatformCustomerInputStatus.active } }, { onSuccess: refresh })}>{customer.status === 'active' ? <><Pause size={14} /> Suspend</> : <><Play size={14} /> Reactivate</>}</Button></div>)}</div>}
        </section>
        <section className="rounded-xl border border-border bg-card p-5">
          <div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Plus size={16} /></span><h2 className="text-base font-bold">Create customer</h2></div>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); create.mutate({ data: { name, slug, ownerEmail: ownerEmail || null } }, { onSuccess: (result) => { setName(''); setSlug(''); setOwnerEmail(''); refresh(); if (result.invitationToken) setLink(`${window.location.origin}${import.meta.env.BASE_URL}accept-invitation/${result.invitationToken}`); } }); }}>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Customer name</span><input required minLength={2} value={name} onChange={(event) => setName(event.target.value)} className={inputClass} /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Slug</span><input required pattern="[a-z0-9][a-z0-9-]{2,62}" value={slug} onChange={(event) => setSlug(event.target.value.toLowerCase())} className={inputClass} placeholder="acme-builders" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Owner email <span className="font-normal text-muted-foreground">(optional)</span></span><input type="email" value={ownerEmail} onChange={(event) => setOwnerEmail(event.target.value)} className={inputClass} /></label>
            <Button type="submit" disabled={create.isPending}><Plus size={15} /> {create.isPending ? 'Creating…' : 'Create customer'}</Button>
            {create.isError && <p role="alert" className="text-xs text-destructive">Customer could not be created. Try again.</p>}
          </form>
          {link && <div className="mt-5 rounded-lg border border-primary/20 bg-primary/5 p-4"><p className="text-xs font-semibold">One-time owner invitation link</p><div className="mt-2 flex gap-2"><input readOnly value={link} aria-label="Owner invitation link" className={`${inputClass} text-xs`} /><Button variant="outline" onClick={() => { navigator.clipboard.writeText(link); setCopied(true); }}><Copy size={14} /> {copied ? 'Copied' : 'Copy'}</Button></div></div>}
        </section>
      </div>
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