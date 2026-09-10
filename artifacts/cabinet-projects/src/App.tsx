import { useEffect, useRef } from 'react';
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
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
import { Projects } from '@/pages/projects';
import { ProjectDetail } from '@/pages/project-detail';
import { FollowUps } from '@/pages/follow-ups';
import { BrandingAdmin } from '@/pages/branding-admin';

const queryClient = new QueryClient();

// REQUIRED — Clerk Keys
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo-full.png`,
  },
  variables: {
    colorPrimary: "hsl(221, 83%, 53%)", // Construct LC Vivid Blue
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
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 bg-[url('/grid-pattern.svg')]">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 bg-[url('/grid-pattern.svg')]">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
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
        <Route path="/overview"><Shell><ProtectedRoute component={Dashboard} /></Shell></Route>
        <Route path="/projects"><Shell><ProtectedRoute component={Projects} /></Shell></Route>
        <Route path="/projects/:id"><Shell><ProtectedRoute component={ProjectDetail} /></Shell></Route>
        <Route path="/follow-ups"><Shell><ProtectedRoute component={FollowUps} /></Shell></Route>
        <Route path="/administration/organization/branding"><Shell><ProtectedRoute component={BrandingAdmin} /></Shell></Route>
        
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
        signIn: { start: { title: "Welcome back", subtitle: "Sign in to Construct LC" } },
        signUp: { start: { title: "Create your account", subtitle: "Join Construct LC today" } },
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
