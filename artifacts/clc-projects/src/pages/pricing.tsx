import { Link } from 'wouter';
import { ArrowLeft, CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import { StripePricingTable, isStripeTestMode } from '@/components/stripe-pricing-table';
import { Button } from '@workspace/construct-lifecycle-design-system/components/ui/button';
import { routeMetadata, useRouteMetadata } from '@/lib/route-titles';

function PricingHeader() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

  return (
    <header className="border-b border-border bg-card">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <img
            src={`${basePath}/logo-full-slogan.svg`}
            alt="Construct Lifecycle — From Bid to Closeout"
            className="h-9 w-auto max-w-[220px] object-contain sm:h-11"
          />
        </Link>
        <Button asChild variant="outline"><Link href="/sign-in">Sign in</Link></Button>
      </div>
    </header>
  );
}

export function PricingPage() {
  useRouteMetadata(routeMetadata.pricing);
  const testMode = isStripeTestMode();

  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <PricingHeader />
      <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <Button asChild variant="ghost" className="mb-6"><Link href="/"><ArrowLeft size={15} /> Back to Construct Lifecycle</Link></Button>
          <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-accent">Plans &amp; billing</p>
          <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">Choose the plan that fits your operation</h1>
          <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
            Start with the tools your construction-supply team needs from bid through closeout. Stripe securely handles checkout, payment methods, and invoices.
          </p>
        </div>

        {testMode && (
          <div className="mx-auto mt-8 flex max-w-3xl items-start gap-3 rounded-xl border border-status-warning/30 bg-status-warning/10 p-4 text-left" role="status">
            <ExternalLink size={17} className="mt-0.5 shrink-0 text-status-warning" />
            <div>
              <p className="text-sm font-semibold text-status-warning">Test mode</p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                This pricing page is connected to Stripe test mode. Do not use test checkout for a production subscription.
              </p>
            </div>
          </div>
        )}

        <section className="mx-auto mt-8 max-w-5xl" aria-labelledby="pricing-table-heading">
          <h2 id="pricing-table-heading" className="sr-only">Available subscription plans</h2>
          <StripePricingTable />
        </section>

        <div className="mx-auto mt-8 grid max-w-5xl gap-4 sm:grid-cols-3">
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-status-success" />
            <p className="text-sm leading-6 text-muted-foreground">Monthly and annual billing options are shown by Stripe.</p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <ShieldCheck size={18} className="mt-0.5 shrink-0 text-primary" />
            <p className="text-sm leading-6 text-muted-foreground">Card details stay in Stripe and never enter Construct Lifecycle.</p>
          </div>
          <div className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
            <ExternalLink size={18} className="mt-0.5 shrink-0 text-accent" />
            <p className="text-sm leading-6 text-muted-foreground">Manage invoices, payment methods, and cancellation in the Stripe portal.</p>
          </div>
        </div>

        <p className="mx-auto mt-8 max-w-3xl text-center text-xs leading-5 text-muted-foreground">
          Checkout completion is not proof of an active workspace entitlement. Construct Lifecycle activates billing after the verified Stripe webhook is processed.
        </p>
      </main>
    </div>
  );
}

export function PricingSuccessPage() {
  useRouteMetadata(routeMetadata.pricingSuccess);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-10">
        <CheckCircle2 size={42} className="mx-auto text-status-success" />
        <p className="mono mt-5 text-[10px] font-bold uppercase tracking-[.16em] text-accent">Checkout returned</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">We’re verifying your subscription</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Stripe has returned you to Construct Lifecycle. Access is updated only after the verified billing webhook is processed.
        </p>
        <Button asChild size="lg" className="mt-7"><Link href="/overview">Continue to workspace</Link></Button>
      </section>
    </div>
  );
}

export function PricingCanceledPage() {
  useRouteMetadata(routeMetadata.pricingCanceled);
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 text-center shadow-sm sm:p-10">
        <p className="mono text-[10px] font-bold uppercase tracking-[.16em] text-muted-foreground">Checkout canceled</p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">No changes were made</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Your workspace and existing billing state are unchanged. You can review plans again whenever you’re ready.</p>
        <Button asChild size="lg" variant="outline" className="mt-7"><Link href="/pricing">Return to plans</Link></Button>
      </section>
    </div>
  );
}