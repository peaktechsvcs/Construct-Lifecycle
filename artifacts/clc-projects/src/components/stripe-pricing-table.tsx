import { createElement, useEffect, useState } from 'react';

const STRIPE_PRICING_TABLE_SCRIPT = 'https://js.stripe.com/v3/pricing-table.js';

type StripePricingTableProps = {
  className?: string;
  clientReferenceId?: string;
};

function getPricingTableConfig() {
  return {
    publishableKey: String(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ?? '').trim(),
    pricingTableId: String(import.meta.env.VITE_STRIPE_PRICING_TABLE_ID ?? '').trim(),
  };
}

export function StripePricingTable({ className = '', clientReferenceId }: StripePricingTableProps) {
  const [scriptFailed, setScriptFailed] = useState(false);
  const { publishableKey, pricingTableId } = getPricingTableConfig();
  const isProductionWithTestConfig = import.meta.env.PROD && publishableKey.startsWith('pk_test_');

  useEffect(() => {
    if (!publishableKey || !pricingTableId || isProductionWithTestConfig) return;

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${STRIPE_PRICING_TABLE_SCRIPT}"]`,
    );
    if (existingScript) return;

    const script = document.createElement('script');
    script.src = STRIPE_PRICING_TABLE_SCRIPT;
    script.async = true;
    script.onerror = () => setScriptFailed(true);
    document.head.appendChild(script);
  }, [isProductionWithTestConfig, pricingTableId, publishableKey]);

  if (isProductionWithTestConfig) {
    return (
      <div className={`rounded-xl border border-status-warning/30 bg-status-warning/10 p-5 text-sm ${className}`} role="alert">
        <p className="font-semibold text-status-warning">Live pricing is not configured</p>
        <p className="mt-1 leading-6 text-muted-foreground">
          This environment has test-mode Stripe settings and cannot start production subscriptions.
        </p>
      </div>
    );
  }

  if (!publishableKey || !pricingTableId) {
    return (
      <div className={`rounded-xl border border-border bg-card p-5 text-sm ${className}`} role="status">
        <p className="font-semibold text-foreground">Pricing is temporarily unavailable</p>
        <p className="mt-1 leading-6 text-muted-foreground">
          A platform administrator needs to configure the Stripe Pricing Table for this environment.
        </p>
      </div>
    );
  }

  if (scriptFailed) {
    return (
      <div className={`rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-sm ${className}`} role="alert">
        <p className="font-semibold text-destructive">Pricing could not be loaded</p>
        <p className="mt-1 leading-6 text-muted-foreground">
          Refresh the page to try again. No payment details were collected by Construct Lifecycle.
        </p>
      </div>
    );
  }

  return (
    <div className={`min-w-0 overflow-hidden rounded-xl border border-border bg-card p-1 sm:p-3 ${className}`}>
      {createElement('stripe-pricing-table', {
        'pricing-table-id': pricingTableId,
        'publishable-key': publishableKey,
        ...(clientReferenceId ? { 'client-reference-id': clientReferenceId } : {}),
      })}
    </div>
  );
}

export function isStripeTestMode() {
  return getPricingTableConfig().publishableKey.startsWith('pk_test_');
}