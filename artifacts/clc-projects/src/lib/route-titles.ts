import { useEffect } from 'react';
import { useLocation } from 'wouter';

export const APP_TITLE = 'Construct Lifecycle';
export const DEFAULT_DESCRIPTION =
  'Construct Lifecycle helps construction teams manage work from bid through closeout in one connected workspace.';
export const PUBLIC_SITE_URL = 'https://constructlifecycle.com';
export const PUBLIC_SHARE_IMAGE_URL = `${PUBLIC_SITE_URL}/og-image.png`;

const title = (label: string) => `${label} · ${APP_TITLE}`;

export interface RouteMetadata {
  title: string;
  description: string;
}

const metadata = (routeTitle: string, description: string): RouteMetadata => ({
  title: routeTitle,
  description,
});

export const routeMetadata = {
  landing: metadata(APP_TITLE, DEFAULT_DESCRIPTION),
  signIn: metadata(
    title('Sign in'),
    'Sign in to Construct Lifecycle to manage construction projects from bid through closeout.',
  ),
  signUp: metadata(
    title('Create your account'),
    'Create a Construct Lifecycle account to manage construction work from bid through closeout.',
  ),
  pricing: metadata(
    title('Plans & billing'),
    'Compare Construct Lifecycle plans for managing your construction lifecycle from bid through closeout.',
  ),
  pricingSuccess: metadata(
    title('Subscription verification'),
    'Confirm your Construct Lifecycle subscription before returning to your workspace.',
  ),
  pricingCanceled: metadata(
    title('Checkout canceled'),
    'Your Construct Lifecycle checkout was canceled. Review plans and return when you are ready.',
  ),
  invitation: metadata(
    title('Invitation'),
    'Accept your Construct Lifecycle workspace invitation and join your construction team.',
  ),
  loading: metadata(title('Loading'), 'Loading your Construct Lifecycle workspace.'),
  workspaceAccess: metadata(
    title('You do not have access to a workspace'),
    'Your Construct Lifecycle account is signed in, but it is not assigned to a Construct Lifecycle workspace.',
  ),
  platformAccess: metadata(
    title('Platform administrator access required'),
    'Construct Lifecycle platform administrator access is required to open this recovery console.',
  ),
  error: metadata(
    title('Something went wrong'),
    'Construct Lifecycle encountered an error while loading this page. Try again to continue.',
  ),
  notFound: metadata(
    title('404 Page Not Found'),
    'The Construct Lifecycle page you requested could not be found.',
  ),
  margin: metadata(
    title('Margin'),
    'Analyze quoted and purchased work, forecast margin, and margin risk across your construction workspace.',
  ),
  revenue: metadata(
    title('Revenue'),
    'Track contracted, invoiced, and received project revenue with forecast context across your construction workspace.',
  ),
  changeOrders: metadata(
    title('Change orders'),
    'Control construction scope, price, and schedule changes with a clear approval trail.',
  ),
  commitments: metadata(
    title('Commitments'),
    'Track committed spend, invoices, payments, and outstanding obligations across your construction workspace.',
  ),
  costs: metadata(
    title('Costs'),
    'Compare planned, committed, forecast, and recorded project costs across your construction workspace.',
  ),
  openItems: metadata(
    title('Open Items'),
    'Coordinate RFIs and project issues across your construction workspace.',
  ),
  finalBilling: metadata(
    title('Final Billing'),
    'Manage the owner pay-application register and financial handoff for project closeout.',
  ),
} as const;

export const routeTitles = {
  landing: routeMetadata.landing.title,
  signIn: routeMetadata.signIn.title,
  signUp: routeMetadata.signUp.title,
  pricing: routeMetadata.pricing.title,
  pricingSuccess: routeMetadata.pricingSuccess.title,
  pricingCanceled: routeMetadata.pricingCanceled.title,
  invitation: routeMetadata.invitation.title,
  loading: routeMetadata.loading.title,
  workspaceAccess: routeMetadata.workspaceAccess.title,
  platformAccess: routeMetadata.platformAccess.title,
  error: routeMetadata.error.title,
  notFound: routeMetadata.notFound.title,
  margin: routeMetadata.margin.title,
  revenue: routeMetadata.revenue.title,
  changeOrders: routeMetadata.changeOrders.title,
  commitments: routeMetadata.commitments.title,
  costs: routeMetadata.costs.title,
  openItems: routeMetadata.openItems.title,
  finalBilling: routeMetadata.finalBilling.title,
} as const;

export function comingSoonTitle(label: string) {
  return title(`${label} · Coming soon`);
}

export function comingSoonMetadata(label: string): RouteMetadata {
  return metadata(
    comingSoonTitle(label),
    `${label} is coming soon in Construct Lifecycle. Check back for updates on this construction workflow.`,
  );
}

function updateMeta(
  selector: string,
  attribute: 'name' | 'property',
  value: string,
): { element: HTMLMetaElement; previousContent: string | null; created: boolean } {
  const existing = document.head.querySelector<HTMLMetaElement>(selector);
  if (existing) {
    return { element: existing, previousContent: existing.getAttribute('content'), created: false };
  }
  const element = document.createElement('meta');
  element.setAttribute(attribute, value);
  document.head.appendChild(element);
  return { element, previousContent: null, created: true };
}

function updateCanonical(href: string) {
  const existing = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (existing) {
    return { element: existing, previousHref: existing.getAttribute('href'), created: false };
  }
  const element = document.createElement('link');
  element.rel = 'canonical';
  document.head.appendChild(element);
  return { element, previousHref: null, created: true };
}

function canonicalPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized === '/subscribe' ? '/pricing' : normalized;
}

function isIndexablePublicPath(pathname: string) {
  const normalized = pathname.replace(/\/+$/, '') || '/';
  return normalized === '/' || normalized === '/pricing';
}

export function useRouteMetadata(route: RouteMetadata) {
  const [location] = useLocation();
  const pathname = location.split('?')[0] || window.location.pathname;
  useEffect(() => {
    const previousTitle = document.title;
    const canonicalUrl = new URL(canonicalPath(pathname), PUBLIC_SITE_URL).href;
    const canonical = updateCanonical(canonicalUrl);
    const metaUpdates = [
      updateMeta('meta[name="description"]', 'name', 'description'),
      updateMeta('meta[property="og:title"]', 'property', 'og:title'),
      updateMeta('meta[property="og:description"]', 'property', 'og:description'),
      updateMeta('meta[property="og:url"]', 'property', 'og:url'),
      updateMeta('meta[property="og:site_name"]', 'property', 'og:site_name'),
      updateMeta('meta[property="og:image"]', 'property', 'og:image'),
      updateMeta('meta[property="og:image:alt"]', 'property', 'og:image:alt'),
      updateMeta('meta[name="twitter:title"]', 'name', 'twitter:title'),
      updateMeta('meta[name="twitter:description"]', 'name', 'twitter:description'),
      updateMeta('meta[name="twitter:image"]', 'name', 'twitter:image'),
      updateMeta('meta[name="twitter:image:alt"]', 'name', 'twitter:image:alt'),
      updateMeta('meta[name="robots"]', 'name', 'robots'),
    ];

    document.title = route.title;
    metaUpdates[0].element.content = route.description;
    metaUpdates[1].element.content = route.title;
    metaUpdates[2].element.content = route.description;
    metaUpdates[3].element.content = canonicalUrl;
    metaUpdates[4].element.content = APP_TITLE;
    metaUpdates[5].element.content = PUBLIC_SHARE_IMAGE_URL;
    metaUpdates[6].element.content = 'Construct Lifecycle — From Bid to Closeout';
    metaUpdates[7].element.content = route.title;
    metaUpdates[8].element.content = route.description;
    metaUpdates[9].element.content = PUBLIC_SHARE_IMAGE_URL;
    metaUpdates[10].element.content = 'Construct Lifecycle — From Bid to Closeout';
    metaUpdates[11].element.content = isIndexablePublicPath(pathname)
      ? 'index, follow'
      : 'noindex, nofollow';

    return () => {
      document.title = previousTitle;
      if (canonical.created) {
        canonical.element.remove();
      } else if (canonical.previousHref === null) {
        canonical.element.removeAttribute('href');
      } else {
        canonical.element.href = canonical.previousHref;
      }
      for (const update of metaUpdates) {
        if (update.created) {
          update.element.remove();
        } else if (update.previousContent === null) {
          update.element.removeAttribute('content');
        } else {
          update.element.content = update.previousContent;
        }
      }
    };
  }, [pathname, route.title, route.description]);
}

export function useRouteTitle(routeTitle: string) {
  useRouteMetadata({ title: routeTitle, description: DEFAULT_DESCRIPTION });
}