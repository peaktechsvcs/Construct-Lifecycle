import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@clerk/react';
import { useLocation, useParams } from 'wouter';
import { Check, Link2 } from 'lucide-react';
import { useAcceptTenantInvitation, useGetInvitationDetails, getGetInvitationDetailsQueryKey, getGetTenantContextQueryKey } from '@workspace/api-client-react';
import { Button, ErrorPanel, LoadingPanel } from '@/components/app-ui';
import { routeTitles, useRouteTitle } from '@/lib/route-titles';
export function AcceptInvitation() {
  const { token = '' } = useParams<{ token: string }>(); const [, setLocation] = useLocation(); const qc = useQueryClient(); const { isLoaded, isSignedIn } = useAuth(); const [accepted, setAccepted] = useState(false);
  useRouteTitle(routeTitles.invitation);
  const details = useGetInvitationDetails(token, { query: { queryKey: getGetInvitationDetailsQueryKey(token), enabled: !!token && isLoaded && !!isSignedIn } }); const accept = useAcceptTenantInvitation();
  useEffect(() => { if (accepted) { qc.clear(); setLocation('/overview'); } }, [accepted, qc, setLocation]);
  if (!isLoaded) return <div className="mx-auto flex min-h-[100dvh] max-w-lg items-center px-4"><LoadingPanel lines={4} /></div>;
  if (!isSignedIn) return <div className="grid min-h-[100dvh] place-items-center bg-background px-4"><section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 shadow-xl"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 size={20} /></div><p className="mono text-[10px] uppercase tracking-[.18em] text-accent">Invitation</p><h1 className="mt-2 text-2xl font-bold">Sign in to accept this invitation</h1><p className="mt-2 text-sm text-muted-foreground">Sign in or create an account to join the customer workspace. This invitation link will be preserved.</p><Button className="mt-7 w-full" onClick={() => { sessionStorage.setItem('construct-lc.auth-return', window.location.pathname); setLocation('/sign-in'); }}>Continue to sign in</Button></section></div>;
  if (details.isLoading) return <div className="mx-auto flex min-h-[100dvh] max-w-lg items-center px-4"><LoadingPanel lines={4} /></div>;
  if (details.isError || !details.data) return <div className="mx-auto flex min-h-[100dvh] max-w-lg items-center px-4"><ErrorPanel onRetry={() => details.refetch()} /></div>;
  return <div className="grid min-h-[100dvh] place-items-center bg-background px-4"><section className="w-full max-w-lg rounded-2xl border border-border bg-card p-7 shadow-xl"><div className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Link2 size={20} /></div><p className="mono text-[10px] uppercase tracking-[.18em] text-accent">Invitation</p><h1 className="mt-2 text-2xl font-bold">Join {details.data.tenantName}</h1><p className="mt-2 text-sm text-muted-foreground">You have been invited as a <strong className="text-foreground">{details.data.role}</strong> using {details.data.email}.</p><Button className="mt-7 w-full" disabled={accept.isPending || details.data.status !== 'pending'} onClick={() => accept.mutate({ token }, { onSuccess: () => setAccepted(true) })}><Check size={16} /> {accept.isPending ? 'Accepting…' : details.data.status === 'pending' ? 'Accept invitation' : `Invitation ${details.data.status}`}</Button>{accept.isError && <p role="alert" className="mt-3 text-xs text-destructive">This invitation could not be accepted. It may have expired.</p>}</section></div>;
}