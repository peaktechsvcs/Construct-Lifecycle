import { createContext, useContext, type ReactNode } from 'react';

type BrowserAuthMode = 'authenticated' | 'platform' | 'signed-out' | 'no-tenant';

function getMode(): BrowserAuthMode {
  const value = new URLSearchParams(window.location.search).get('browserAuth');
  if (value === 'platform' || value === 'signed-out' || value === 'no-tenant') {
    window.sessionStorage.setItem('clc-browser-auth', value);
    return value;
  }
  const stored = window.sessionStorage.getItem('clc-browser-auth');
  return stored === 'platform' || stored === 'signed-out' || stored === 'no-tenant'
    ? stored
    : 'authenticated';
}

const AuthContext = createContext<BrowserAuthMode>('authenticated');

export function ClerkProvider({ children }: { children: ReactNode }) {
  return <AuthContext.Provider value={getMode()}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const mode = useContext(AuthContext);
  return {
    isLoaded: true,
    isSignedIn: mode !== 'signed-out',
    userId: mode === 'signed-out' ? null : 'browser-test-user',
  };
}

export function useUser() {
  const mode = useContext(AuthContext);
  if (mode === 'signed-out') return { isLoaded: true, isSignedIn: false, user: undefined };
  return {
    isLoaded: true,
    isSignedIn: true,
    user: {
      id: 'browser-test-user',
      fullName: 'Browser Test User',
      imageUrl: '',
      primaryEmailAddress: { emailAddress: 'browser-test@example.test' },
    },
  };
}

export function useClerk() {
  return {
    addListener: () => () => {},
    signOut: async () => {
      window.history.pushState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
  };
}

export function Show({
  when,
  children,
}: {
  when: 'signed-in' | 'signed-out';
  children: ReactNode;
}) {
  const signedIn = useAuth().isSignedIn;
  return (when === 'signed-in' ? signedIn : !signedIn) ? <>{children}</> : null;
}

export function SignIn() {
  return <h1>Sign in</h1>;
}

export function SignUp() {
  return <h1>Sign up</h1>;
}
