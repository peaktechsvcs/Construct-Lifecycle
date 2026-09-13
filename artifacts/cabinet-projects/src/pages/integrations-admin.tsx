import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Activity, Cable, CheckCircle2, CircleAlert, Clock3, Database, History, LockKeyhole, X } from 'lucide-react';
import {
  getListIntegrationActivityQueryKey,
  getListIntegrationJobsQueryKey,
  getListIntegrationsQueryKey,
  useConnectIntegration,
  useListIntegrationActivity,
  useListIntegrationJobs,
  useListIntegrations,
  useRevokeIntegration,
} from '@workspace/api-client-react';
import { useTenant } from '@/providers/tenant-provider';
import { Badge, EmptyState, ErrorPanel, LoadingPanel, PageTitle, Button, shortDate, fullDate } from '@/components/app-ui';

function connectionTone(status?: string | null): 'neutral' | 'teal' | 'orange' | 'green' | 'red' {
  if (status === 'connected') return 'green';
  if (status === 'warning') return 'orange';
  if (status === 'failed') return 'red';
  if (status === 'not_connected') return 'neutral';
  return 'neutral';
}

function connectionLabel(status?: string | null) {
  return status ? status.replaceAll('_', ' ') : 'Not connected';
}

function healthTone(status?: string | null): 'neutral' | 'teal' | 'orange' | 'green' | 'red' {
  if (status === 'healthy') return 'green';
  if (status === 'degraded') return 'orange';
  if (status === 'failed') return 'red';
  return 'neutral';
}

function healthLabel(status?: string | null) {
  if (status === 'unknown') return 'Awaiting sync';
  return status ? status.replaceAll('_', ' ') : 'No health data';
}

function stateTone(state: string): 'neutral' | 'teal' | 'orange' {
  if (state === 'connected') return 'teal';
  if (state === 'degraded') return 'orange';
  return 'neutral';
}

function stateLabel(state: string) {
  return state === 'cataloged' ? 'Cataloged' : state === 'degraded' ? 'Degraded' : 'Connected';
}

function formatDetail(value: Record<string, unknown>) {
  const entries = Object.entries(value);
  if (!entries.length) return 'No additional details recorded.';
  return entries.map(([key, item]) => `${key}: ${typeof item === 'string' ? item : JSON.stringify(item)}`).join(' · ');
}

export function IntegrationsAdmin() {
  const qc = useQueryClient();
  const { activeTenant, activeEnvironment } = useTenant();
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const integrationsQuery = useListIntegrations({
    query: { queryKey: getListIntegrationsQueryKey(), staleTime: 30000 },
  });
  const connectIntegration = useConnectIntegration();
  const revokeIntegration = useRevokeIntegration();
  const activityParams = useMemo(
    () => ({ providerKey: selectedProvider || 'unselected', limit: 20 }),
    [selectedProvider],
  );
  const activityQuery = useListIntegrationActivity(activityParams, {
    query: {
      queryKey: getListIntegrationActivityQueryKey(activityParams),
      enabled: Boolean(selectedProvider),
      staleTime: 30000,
    },
  });
  const jobsQuery = useListIntegrationJobs(activityParams, {
    query: {
      queryKey: getListIntegrationJobsQueryKey(activityParams),
      enabled: Boolean(selectedProvider),
      staleTime: 30000,
    },
  });

  const catalog = integrationsQuery.data ?? [];
  const selected = catalog.find((item) => item.providerKey === selectedProvider) ?? null;
  const connectedCount = catalog.filter((item) => item.connection?.status === 'connected').length;
  const degradedCount = catalog.filter((item) => item.state === 'degraded').length;
  const activityCount = catalog.reduce((total, item) => total + item.activity.activityCount, 0);
  const selectedIsConnected = selected?.connection?.status === 'connected';

  const refreshIntegration = () => {
    qc.invalidateQueries({ queryKey: getListIntegrationsQueryKey() });
    if (selectedProvider) {
      qc.invalidateQueries({ queryKey: getListIntegrationActivityQueryKey({ providerKey: selectedProvider, limit: 20 }) });
      qc.invalidateQueries({ queryKey: getListIntegrationJobsQueryKey({ providerKey: selectedProvider, limit: 20 }) });
    }
  };

  const handleConnect = () => {
    if (!selectedProvider) return;
    setActionError(null);
    connectIntegration.mutate({ providerKey: selectedProvider }, {
      onSuccess: refreshIntegration,
      onError: (error) => setActionError(error instanceof Error ? error.message : 'The integration could not be connected.'),
    });
  };

  const handleRevoke = () => {
    if (!selectedProvider || !window.confirm('Disconnect this integration from the active customer environment?')) return;
    setActionError(null);
    revokeIntegration.mutate({ providerKey: selectedProvider }, {
      onSuccess: refreshIntegration,
      onError: (error) => setActionError(error instanceof Error ? error.message : 'The integration could not be disconnected.'),
    });
  };

  if (integrationsQuery.isLoading) {
    return (
      <div className="animate-rise">
        <PageTitle eyebrow="Settings / Integrations" title="Integrations" description="Review the systems available to this customer environment and their recorded activity." />
        <LoadingPanel lines={6} />
      </div>
    );
  }

  if (integrationsQuery.isError) {
    return (
      <div className="animate-rise">
        <PageTitle eyebrow="Settings / Integrations" title="Integrations" description="Review the systems available to this customer environment and their recorded activity." />
        <div className="mb-4 rounded-xl border border-status-warning/25 bg-status-warning/10 px-4 py-3 text-sm text-foreground">
          <p className="font-semibold">Access to integrations is unavailable.</p>
          <p className="mt-1 text-xs text-muted-foreground">Your role may not have permission to view this customer administration area.</p>
        </div>
        <ErrorPanel onRetry={() => integrationsQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Settings / Integrations"
        title="Integrations"
        description="Understand which external systems are entitled in this customer environment, what they cover, and whether activity has been recorded."
      />

      <section className="mb-6 flex flex-col gap-4 rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(var(--border))] md:flex-row md:items-center md:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><LockKeyhole size={18} /></span>
          <div className="min-w-0">
            <p className="mono text-[10px] font-medium uppercase tracking-[.16em] text-muted-foreground">Active customer environment</p>
            <p className="mt-1 truncate text-base font-bold">{activeTenant?.name || 'Current customer'}</p>
            <p className="mt-1 text-xs text-muted-foreground">{activeEnvironment?.name || 'Loading environment'} · Owner and admin connection controls</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-5 border-t border-border pt-4 sm:grid-cols-4 md:border-l md:border-t-0 md:pl-6 md:pt-0 md:pt-0">
          <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Entitled</p><p className="mt-1 text-xl font-bold">{catalog.length}</p></div>
          <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Connected</p><p className="mt-1 text-xl font-bold">{connectedCount}</p></div>
          <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Degraded</p><p className={`mt-1 text-xl font-bold ${degradedCount ? 'text-status-warning' : ''}`}>{degradedCount}</p></div>
          <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Activity</p><p className="mt-1 text-xl font-bold">{activityCount}</p></div>
        </div>
      </section>

      {catalog.length === 0 ? (
        <EmptyState icon={Cable} title="No entitled integrations" text="There are no integration catalog entries available in this customer environment." />
      ) : (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <section className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="border-b border-border px-5 py-4">
              <h2 className="text-sm font-bold">Entitled catalog</h2>
              <p className="mt-1 text-xs text-muted-foreground">Catalog entitlement is separate from connection state.</p>
            </div>
            <div className="divide-y divide-border">
              {catalog.map((item) => {
                const isSelected = item.providerKey === selectedProvider;
                return (
                  <button
                    type="button"
                    key={item.providerKey}
                    onClick={() => setSelectedProvider(item.providerKey)}
                    className={`block w-full p-5 text-left transition-colors hover:bg-secondary/50 ${isSelected ? 'bg-primary/5' : ''}`}
                    aria-pressed={isSelected}
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-bold">{item.name}</h3>
                          <Badge tone="violet">Entitled</Badge>
                          <Badge tone={stateTone(item.state)}>{stateLabel(item.state)}</Badge>
                          {item.connection && <Badge tone={healthTone(item.connection.healthStatus)}>{healthLabel(item.connection.healthStatus)}</Badge>}
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">{item.categoryLabel} · {item.description}</p>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          {item.capabilities.map((capability) => <span key={capability} className="rounded-md bg-secondary px-2 py-1 text-[10px] font-medium text-secondary-foreground">{capability}</span>)}
                        </div>
                      </div>
                      <div className="shrink-0 text-left md:text-right">
                        <p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Recorded activity</p>
                        <p className="mt-1 text-sm font-bold">{item.activity.activityCount}</p>
                        <p className="mt-1 text-[10px] text-muted-foreground">{item.activity.lastActivityAt ? fullDate(item.activity.lastActivityAt) : 'None recorded'}</p>
                      </div>
                    </div>
                    {item.connection?.lastError && <p className="mt-3 flex items-start gap-2 rounded-md bg-status-danger/10 px-3 py-2 text-xs text-status-danger"><CircleAlert size={14} className="mt-0.5 shrink-0" />{item.connection.lastError}</p>}
                  </button>
                );
              })}
            </div>
          </section>

          <aside className="rounded-xl border border-border bg-card">
            {!selected ? (
              <EmptyState icon={Database} title="Select an integration" text="Choose an entitled catalog entry to inspect its connection and activity details." />
            ) : (
              <>
                <div className="flex items-start justify-between border-b border-border px-5 py-4">
                  <div><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Integration detail</p><h2 className="mt-1 text-base font-bold">{selected.name}</h2></div>
                  <Button variant="ghost" className="h-8 w-8 p-0" aria-label="Close integration detail" onClick={() => setSelectedProvider(null)}><X size={15} /></Button>
                </div>
                <div className="space-y-5 p-5">
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
                     <div className="rounded-lg bg-secondary/60 p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Connection</p><div className="mt-2 flex items-center gap-2">{selected.connection?.status === 'connected' ? <CheckCircle2 size={15} className="text-status-success" /> : <CircleAlert size={15} className="text-status-warning" />}<span className="text-sm font-semibold">{connectionLabel(selected.connection?.status)}</span></div>{selected.connection?.connectionType && <p className="mt-1 text-xs text-muted-foreground">{selected.connection.connectionType}</p>}</div>
                     <div className="rounded-lg bg-secondary/60 p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Current health</p><div className="mt-2 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${selected.connection?.healthStatus === 'healthy' ? 'bg-status-success' : selected.connection?.healthStatus === 'failed' ? 'bg-status-danger' : selected.connection?.healthStatus === 'degraded' ? 'bg-status-warning' : 'bg-muted-foreground'}`} /><span className="text-sm font-semibold">{healthLabel(selected.connection?.healthStatus)}</span></div><p className="mt-1 text-xs text-muted-foreground">{selected.connection?.lastSuccessfulSyncAt ? `Last successful sync ${fullDate(selected.connection.lastSuccessfulSyncAt)}` : 'No successful sync recorded'}</p></div>
                  </div>
                   {selected.connection && (
                     <div className="grid gap-3 sm:grid-cols-3">
                       <div className="rounded-lg border border-border bg-background p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Retries</p><p className="mt-2 text-lg font-bold">{selected.connection.retryCount}</p><p className="mt-1 text-[10px] text-muted-foreground">{selected.connection.nextRetryAt ? `Next ${fullDate(selected.connection.nextRetryAt)}` : 'No retry queued'}</p></div>
                       <div className="rounded-lg border border-border bg-background p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Dead letters</p><p className={`mt-2 text-lg font-bold ${selected.connection.deadLetterCount ? 'text-status-danger' : ''}`}>{selected.connection.deadLetterCount}</p><p className="mt-1 text-[10px] text-muted-foreground">Requires operator review</p></div>
                       <div className="rounded-lg border border-border bg-background p-3"><p className="mono text-[9px] uppercase tracking-wider text-muted-foreground">Latest error</p><p className="mt-2 text-xs font-semibold leading-4">{selected.connection.lastError || 'No actionable error'}</p><p className="mt-1 text-[10px] text-muted-foreground">{selected.connection.lastFailureAt ? fullDate(selected.connection.lastFailureAt) : 'No failure recorded'}</p></div>
                     </div>
                   )}
                   {selected.supportsConnection && (
                     <div className="rounded-lg border border-border bg-background p-4">
                       <p className="text-xs font-bold">Environment access</p>
                       <p className="mt-1 text-xs leading-5 text-muted-foreground">
                         Replit manages provider authorization. This action attaches or removes that authorization for the active environment only; no provider credentials are stored here.
                       </p>
                       {actionError && <p className="mt-3 rounded-md bg-status-danger/10 px-3 py-2 text-xs text-status-danger">{actionError}</p>}
                       <div className="mt-4 flex flex-wrap gap-2">
                         {selectedIsConnected ? (
                           <Button variant="ghost" onClick={handleRevoke} disabled={revokeIntegration.isPending}>
                             {revokeIntegration.isPending ? 'Disconnecting…' : 'Disconnect environment'}
                           </Button>
                         ) : (
                           <Button onClick={handleConnect} disabled={connectIntegration.isPending}>
                             {connectIntegration.isPending ? 'Connecting…' : 'Connect provider'}
                           </Button>
                         )}
                       </div>
                     </div>
                   )}
                  <div><div className="mb-3 flex items-center gap-2"><Activity size={15} className="text-primary" /><h3 className="text-xs font-bold">Recent activity</h3></div>{activityQuery.isLoading ? <LoadingPanel lines={3} /> : activityQuery.isError ? <ErrorPanel onRetry={() => activityQuery.refetch()} /> : activityQuery.data?.length ? <div className="space-y-3">{activityQuery.data.map((entry) => <div key={entry.id} className="border-l-2 border-primary/25 pl-3"><p className="text-xs font-semibold">{entry.action}</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{formatDetail(entry.details)}</p><p className="mono mt-1 flex items-center gap-1 text-[9px] uppercase tracking-wider text-muted-foreground"><Clock3 size={10} />{shortDate(entry.createdAt)}</p></div>)}</div> : <p className="text-xs text-muted-foreground">No activity has been recorded for this integration.</p>}</div>
                   <div><div className="mb-3 flex items-center gap-2"><History size={15} className="text-primary" /><h3 className="text-xs font-bold">Job history</h3></div>{jobsQuery.isLoading ? <LoadingPanel lines={3} /> : jobsQuery.isError ? <ErrorPanel onRetry={() => jobsQuery.refetch()} /> : jobsQuery.data?.length ? <div className="space-y-3">{jobsQuery.data.map((job) => <div key={job.id} className="rounded-md border border-border bg-background p-3"><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold">{job.jobType}</p><Badge tone={job.status === 'dead_letter' || job.status === 'failed' ? 'red' : job.status === 'retry' ? 'orange' : job.status === 'succeeded' ? 'green' : 'neutral'}>{job.status.replaceAll('_', ' ')}</Badge></div><p className="mt-1 text-[10px] text-muted-foreground">Attempt {job.attempts} of {job.maxAttempts} · Updated {shortDate(job.updatedAt)}</p>{job.lastError && <p className="mt-2 text-[10px] leading-4 text-status-danger">{job.lastError}</p>}</div>)}</div> : <p className="text-xs text-muted-foreground">No connector jobs have been recorded for this provider.</p>}</div>
                </div>
              </>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}