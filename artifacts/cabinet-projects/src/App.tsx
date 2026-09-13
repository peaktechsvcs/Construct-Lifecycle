import { useEffect, useRef, useState } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';

import { TenantProvider } from '@/providers/tenant-provider';
import { Shell } from '@/components/shell';
import NotFound from '@/pages/not-found';
import { LandingPage } from '@/pages/landing';
import { Dashboard } from '@/pages/dashboard';
import { DashboardDrilldown } from '@/pages/dashboard-drilldown';
import { Projects } from '@/pages/projects';
import { ProjectDetail } from '@/pages/project-detail';
import { Customers } from '@/pages/customers';
import { CustomerDetail } from '@/pages/customer-detail';
import { FollowUps } from '@/pages/follow-ups';
import { PlatformCustomers } from '@/pages/platform-customers';
import { PlatformReleases } from '@/pages/platform-releases';
import { AcceptInvitation } from '@/pages/accept-invitation';
import { ComingSoonPage } from '@/pages/coming-soon';
import { SettingsPage } from '@/pages/settings';

const queryClient = new QueryClient();

// REQUIRED — Clerk Keys
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const AUTH_RETURN_KEY = 'construct-lc.auth-return';

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo-full-slogan.svg`,
  },
  variables: {
    colorPrimary: "hsl(198, 80%, 43%)", // Construct Blue
    colorBackground: "hsl(0, 0%, 100%)",
    colorForeground: "hsl(222, 47%, 11%)",
    colorMutedForeground: "hsl(215, 16%, 47%)",
    colorInput: "hsl(214, 32%, 91%)",
    colorInputForeground: "hsl(222, 47%, 11%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorNeutral: "hsl(214, 32%, 91%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-2xl w-[440px] max-w-full overflow-hidden border border-border shadow-lg",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-foreground font-bold text-2xl tracking-tight",
    headerSubtitle: "text-muted-foreground",
    socialButtonsBlockButtonText: "text-foreground font-semibold",
    formFieldLabel: "text-foreground font-semibold text-xs",
    footerActionLink: "text-primary font-bold",
    footerActionText: "text-muted-foreground text-sm",
    dividerText: "text-muted-foreground text-xs font-semibold",
    identityPreviewEditButton: "text-primary hover:bg-secondary",
    formFieldSuccessText: "text-emerald-600 text-xs",
    alertText: "text-destructive text-sm",
    logoBox: "mb-6 flex justify-center",
    logoImage: "h-12 object-contain",
    socialButtonsBlockButton: "rounded-lg border border-border bg-card hover:bg-secondary transition-colors",
    formButtonPrimary: "rounded-lg bg-primary text-primary-foreground hover:opacity-90 font-bold shadow-sm transition-opacity",
    formFieldInput: "rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20",
    footerAction: "mt-4 pt-4 border-t border-border",
    dividerLine: "bg-border",
    alert: "bg-destructive/10 border border-destructive/30 rounded-lg p-3",
    otpCodeFieldInput: "rounded-lg border border-input focus:ring-4 focus:ring-primary/20",
    formFieldRow: "mb-4",
    main: "p-6",
  },
};

function SignInPage() {
  const [fallbackRedirectUrl] = useState(
    () => sessionStorage.getItem(AUTH_RETURN_KEY) || `${basePath}/overview`,
  );
  useEffect(() => {
    sessionStorage.removeItem(AUTH_RETURN_KEY);
  }, []);
  return (
    <div className="auth-grid flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} fallbackRedirectUrl={fallbackRedirectUrl} />
    </div>
  );
}

function SignUpPage() {
  const [fallbackRedirectUrl] = useState(
    () => sessionStorage.getItem(AUTH_RETURN_KEY) || `${basePath}/overview`,
  );
  useEffect(() => {
    sessionStorage.removeItem(AUTH_RETURN_KEY);
  }, []);
  return (
    <div className="auth-grid flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} fallbackRedirectUrl={fallbackRedirectUrl} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/overview" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

function ProtectedRoute({ component: Component }: { component: React.ComponentType }) {
  return (
    <>
      <Show when="signed-in">
        <Component />
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
    </>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function AppRouter() {
  const [location] = useLocation();

  return (
    <ErrorBoundary resetKey={location}>
      <Switch>
        <Route path="/" component={HomeRedirect} />
        <Route path="/sign-in/*?" component={SignInPage} />
        <Route path="/sign-up/*?" component={SignUpPage} />

        {/* Protected Routes inside Shell */}
        <Route path="/overview">
          <Shell><ProtectedRoute component={Dashboard} /></Shell>
        </Route>
        <Route path="/dashboard/drilldown/:type">
          <Shell><ProtectedRoute component={DashboardDrilldown} /></Shell>
        </Route>
        <Route path="/projects">
          <Shell><ProtectedRoute component={Projects} /></Shell>
        </Route>
        <Route path="/projects/:id">
          <Shell><ProtectedRoute component={ProjectDetail} /></Shell>
        </Route>
        <Route path="/customers">
          <Shell><ProtectedRoute component={Customers} /></Shell>
        </Route>
        <Route path="/customers/:id">
          <Shell><ProtectedRoute component={CustomerDetail} /></Shell>
        </Route>
        <Route path="/follow-ups">
          <Shell><ProtectedRoute component={FollowUps} /></Shell>
        </Route>
        <Route path="/settings">
          <Shell><ProtectedRoute component={SettingsPage} /></Shell>
        </Route>
        <Route path="/settings/administration/:adminSection">
          <Shell><ProtectedRoute component={SettingsPage} /></Shell>
        </Route>
        <Route path="/settings/access">
          <Redirect to="/settings/administration/access" />
        </Route>
        <Route path="/settings/:section">
          <Shell><ProtectedRoute component={SettingsPage} /></Shell>
        </Route>
        <Route path="/administration/organization/branding">
          <Redirect to="/settings/branding" />
        </Route>
        <Route path="/administration/organization/integrations">
          <Redirect to="/settings/integrations" />
        </Route>
        <Route path="/administration/organization/access">
          <Redirect to="/settings/administration/access" />
        </Route>
        <Route path="/coming-soon/roles">
          <Redirect to="/settings/administration/roles" />
        </Route>
        <Route path="/coming-soon/settings">
          <Redirect to="/settings" />
        </Route>
        <Route path="/administration/platform/customers">
          <Shell><ProtectedRoute component={PlatformCustomers} /></Shell>
        </Route>
        <Route path="/administration/platform/releases">
          <Shell><ProtectedRoute component={PlatformReleases} /></Shell>
        </Route>
        <Route path="/coming-soon/:item">
          <Shell><ProtectedRoute component={ComingSoonPage} /></Shell>
        </Route>
        <Route path="/accept-invitation/:token">
          <AcceptInvitation />
        </Route>

        <Route component={NotFound} />
      </Switch>
    </ErrorBoundary>
  );
}

function App() {
  const [, setLocation] = useLocation();
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: { start: { title: "Welcome back", subtitle: "Construct Lifecycle — From Bid to Closeout" } },
        signUp: { start: { title: "Create your account", subtitle: "Construct Lifecycle — From Bid to Closeout" } },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <TenantProvider>
          <TooltipProvider>
            <AppRouter />
            <Toaster />
          </TooltipProvider>
        </TenantProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

// Wrapper to provide Wouter Router top-level
export default function AppWithRouter() {
  return (
    <WouterRouter base={basePath}>
      <App />
    </WouterRouter>
  );
}
