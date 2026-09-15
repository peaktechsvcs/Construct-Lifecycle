import { useEffect } from 'react';

export const APP_TITLE = 'Construct Lifecycle';
export const DEFAULT_DESCRIPTION =
  'Construct Lifecycle helps construction teams manage work from bid through closeout in one connected workspace.';

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

export function useRouteMetadata(route: RouteMetadata) {
  useEffect(() => {
    const previousTitle = document.title;
    const shareUrl = new URL(window.location.pathname, window.location.origin);
    const metaUpdates = [
      updateMeta('meta[name="description"]', 'name', 'description'),
      updateMeta('meta[property="og:title"]', 'property', 'og:title'),
      updateMeta('meta[property="og:description"]', 'property', 'og:description'),
      updateMeta('meta[property="og:url"]', 'property', 'og:url'),
      updateMeta('meta[name="twitter:title"]', 'name', 'twitter:title'),
      updateMeta('meta[name="twitter:description"]', 'name', 'twitter:description'),
    ];

    document.title = route.title;
    metaUpdates[0].element.content = route.description;
    metaUpdates[1].element.content = route.title;
    metaUpdates[2].element.content = route.description;
    metaUpdates[3].element.content = shareUrl.href;
    metaUpdates[4].element.content = route.title;
    metaUpdates[5].element.content = route.description;

    return () => {
      document.title = previousTitle;
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
  }, [route.title, route.description]);
}

export function useRouteTitle(routeTitle: string) {
  useRouteMetadata({ title: routeTitle, description: DEFAULT_DESCRIPTION });
}