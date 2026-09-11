import { useQueryClient } from '@tanstack/react-query';
import { CreditCard, ExternalLink, FileText, RotateCcw, ShieldCheck, X } from 'lucide-react';
import {
  getGetBillingQueryKey,
  getListBillingInvoicesQueryKey,
  useCancelBillingSubscription,
  useCreateBillingPortal,
  useGetBilling,
  useListBillingInvoices,
  useReactivateBillingSubscription,
} from '@workspace/api-client-react';
import { Badge, Button, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
import { StripePricingTable } from '@/components/stripe-pricing-table';
import { useTenant } from '@/providers/tenant-provider';

const money = (amount: number | null | undefined, currency = 'usd') =>
  amount == null ? 'Contact us' : new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount / 100);

export function BillingAdmin() {
  const qc = useQueryClient();
  const { activeTenant } = useTenant();
  const billing = useGetBilling({ query: { queryKey: getGetBillingQueryKey(), retry: false } });
  const invoices = useListBillingInvoices({ query: { queryKey: getListBillingInvoicesQueryKey(), retry: false } });
  const portal = useCreateBillingPortal();
  const cancel = useCancelBillingSubscription();
  const reactivate = useReactivateBillingSubscription();

  if (billing.isLoading) return <LoadingPanel lines={7} />;
  if (billing.isError || !billing.data) return <ErrorPanel onRetry={() => billing.refetch()} />;

  const account = billing.data.billing;
  const subscription = account?.subscription;
  const refresh = () => qc.invalidateQueries({ queryKey: getGetBillingQueryKey() });
  const openPortal = () => portal.mutate({
    data: { returnUrl: `${window.location.origin}${import.meta.env.BASE_URL}settings/billing` },
  }, { onSuccess: (result) => { if (result.url) window.location.assign(result.url); } });

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Settings / Billing"
        title="Subscription & Billing"
        description="Manage the Construct Lifecycle plan for this workspace. Stripe hosts subscription selection and payment details."
        action={<Button variant="outline" onClick={openPortal} disabled={portal.isPending}><ExternalLink size={15} /> {portal.isPending ? 'Opening…' : 'Open billing portal'}</Button>}
      />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <p className="mono text-[10px] uppercase tracking-[.14em] text-accent">Stripe Pricing Table</p>
                <h2 className="mt-1 text-lg font-bold">{subscription ? 'Review available plans' : 'Choose the right operating level'}</h2>
              </div>
              {subscription && <Badge tone={subscription.status === 'active' || subscription.status === 'trialing' ? 'green' : 'orange'}>{subscription.status || 'unknown'}</Badge>}
            </div>
            <StripePricingTable clientReferenceId={activeTenant?.id ? String(activeTenant.id) : undefined} />
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Stripe handles plan selection and checkout. A successful browser return does not activate entitlements until the verified Stripe webhook is processed.
            </p>
          </section>

          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-5 flex items-center gap-3 border-b border-border pb-4"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><FileText size={16} /></span><div><h2 className="text-base font-bold">Billing history</h2><p className="text-xs text-muted-foreground">Invoices synced from Stripe.</p></div></div>
            {invoices.isLoading ? <LoadingPanel lines={3} /> : (invoices.data ?? []).length === 0 ? <EmptyState icon={FileText} title="No invoices yet" text="Invoices will appear here after the first billing event." /> : <div className="space-y-2">{invoices.data!.map((invoice) => <div key={invoice.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background px-3 py-3"><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{invoice.number || invoice.id}</p><p className="text-xs text-muted-foreground">{invoice.status || 'pending'} · {invoice.created ? new Date(invoice.created * 1000).toLocaleDateString() : '—'}</p></div><p className="text-sm font-bold">{money(invoice.amountPaid ?? invoice.amountDue, invoice.currency || 'usd')}</p>{invoice.hostedInvoiceUrl && <a className="text-xs font-semibold text-primary hover:underline" href={invoice.hostedInvoiceUrl} target="_blank" rel="noreferrer">View</a>}</div>)}</div>}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><CreditCard size={16} /></span><h2 className="text-base font-bold">Current billing</h2></div>
            <dl className="space-y-3 text-sm">
              <div><dt className="text-xs text-muted-foreground">Customer</dt><dd className="mt-1 font-semibold">{account?.name || account?.email || 'Not set up yet'}</dd></div>
              <div><dt className="text-xs text-muted-foreground">Payment method</dt><dd className="mt-1 font-semibold">{account?.paymentMethod && typeof account.paymentMethod.last4 === 'string' ? `${String(account.paymentMethod.brand || 'Card')} ending in ${account.paymentMethod.last4}` : 'Managed in Stripe'}</dd></div>
              {subscription?.cancelAtPeriodEnd && <div className="rounded-lg border border-status-warning/30 bg-status-warning/10 p-3 text-xs text-status-warning">Cancellation is scheduled at the end of the current period.</div>}
            </dl>
            <div className="mt-5 flex flex-wrap gap-2">
              {subscription?.cancelAtPeriodEnd ? <Button variant="outline" onClick={() => reactivate.mutate(undefined, { onSuccess: refresh })} disabled={reactivate.isPending}><RotateCcw size={14} /> Reactivate</Button> : subscription ? <Button variant="danger" onClick={() => cancel.mutate(undefined, { onSuccess: refresh })} disabled={cancel.isPending}><X size={14} /> Cancel at period end</Button> : null}
            </div>
            {(cancel.isError || reactivate.isError) && <p role="alert" className="mt-3 text-xs text-destructive">The subscription could not be updated. Try again.</p>}
          </section>
          <section className="rounded-xl border border-primary/20 bg-primary/[0.04] p-5">
            <div className="flex items-start gap-3"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-primary" /><div><p className="text-sm font-bold">Billing data is isolated</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Construct Lifecycle stores only the Stripe customer relationship and billing audit trail. Card numbers and CVV never enter this workspace.</p></div></div>
          </section>
        </aside>
      </div>
    </div>
  );
}