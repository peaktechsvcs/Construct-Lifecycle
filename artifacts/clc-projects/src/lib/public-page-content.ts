export const PUBLIC_SITE_URL = 'https://constructlifecycle.com';
export const PUBLIC_INDEXABLE_PATHS = ['/', '/pricing'] as const;

export type PublicPricingPlan = {
  name: string;
  description: string;
  monthlyPrice: string;
  annualPrice: string;
  features: readonly string[];
};

export const PUBLIC_PRICING_PLANS: readonly PublicPricingPlan[] = [
  {
    name: 'Standard',
    description: 'A connected workspace for construction teams managing work from bid through closeout.',
    monthlyPrice: '$49',
    annualPrice: '$490',
    features: [
      'Project workspace management',
      'Bid-to-closeout lifecycle workflows',
      'Billing and entitlement controls',
    ],
  },
];

export function renderPublicSitemap() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${PUBLIC_INDEXABLE_PATHS.map((pathname) => `  <url><loc>${PUBLIC_SITE_URL}${pathname === '/' ? '/' : pathname}</loc></url>`).join('\n')}
</urlset>
`;
}

function renderPlanCards() {
  return PUBLIC_PRICING_PLANS.map(
    (plan) => `
      <article>
        <h3>${plan.name}</h3>
        <p>${plan.description}</p>
        <p><strong>${plan.monthlyPrice}</strong> / month</p>
        <p><strong>${plan.annualPrice}</strong> / year</p>
        <h4>Included features</h4>
        <ul>
          ${plan.features.map((feature) => `<li>${feature}</li>`).join('')}
        </ul>
        <p><a href="/sign-up">Start with ${plan.name}</a></p>
      </article>
    `,
  ).join('');
}

export function renderPublicRouteBody(pathname: string) {
  if (pathname === '/pricing' || pathname === '/subscribe') {
    return `
      <header>
        <a href="/">Construct Lifecycle</a>
        <a href="/sign-in">Sign in</a>
      </header>
      <main>
        <p>Plans &amp; billing</p>
        <h1>Choose the plan that fits your operation</h1>
        <p>
          Start with the tools your construction-supply team needs from bid through closeout.
          Stripe securely handles checkout, payment methods, and invoices.
        </p>
        <section aria-labelledby="available-plans-heading">
          <h2 id="available-plans-heading">Available subscription plans</h2>
          ${renderPlanCards()}
        </section>
        <section aria-labelledby="secure-checkout-heading">
          <h2 id="secure-checkout-heading">Secure checkout</h2>
          <p>
            Card details stay in Stripe and never enter Construct Lifecycle.
            Interactive checkout options load below when Stripe is available.
          </p>
          <p><a href="/sign-up">Create an account to get started</a></p>
        </section>
      </main>
    `;
  }

  return `
    <header>
      <p>Construct Lifecycle</p>
    </header>
    <main>
      <h1>Construct Lifecycle</h1>
      <p>From Bid to Closeout.</p>
      <p>
        Manage construction work from bid through closeout in one connected workspace,
        including opportunities, projects, delivery, billing, compliance, and follow-up.
      </p>
      <nav aria-label="Account and product navigation">
        <a href="/sign-in">Sign in</a>
        <a href="/sign-up">Create an account</a>
        <a href="/pricing">View plans and pricing</a>
      </nav>
    </main>
  `;
}