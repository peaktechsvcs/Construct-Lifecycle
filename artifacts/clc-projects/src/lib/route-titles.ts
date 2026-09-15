import { useEffect } from 'react';

export const APP_TITLE = 'Construct Lifecycle';

const title = (label: string) => `${label} · ${APP_TITLE}`;

export const routeTitles = {
  landing: APP_TITLE,
  signIn: title('Sign in'),
  signUp: title('Create your account'),
  pricing: title('Plans & billing'),
  pricingSuccess: title('Subscription verification'),
  pricingCanceled: title('Checkout canceled'),
  invitation: title('Invitation'),
  loading: title('Loading'),
  workspaceAccess: title('You do not have access to a workspace'),
  platformAccess: title('Platform administrator access required'),
  error: title('Something went wrong'),
  notFound: title('404 Page Not Found'),
} as const;

export function comingSoonTitle(label: string) {
  return title(`${label} · Coming soon`);
}

export function useRouteTitle(routeTitle: string) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = routeTitle;
    return () => {
      document.title = previousTitle;
    };
  }, [routeTitle]);
}