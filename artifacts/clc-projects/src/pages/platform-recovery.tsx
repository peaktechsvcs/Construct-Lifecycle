import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  FlaskConical,
  Globe,
  RefreshCw,
  Server,
  Shield,
  ShieldCheck,
  RotateCcw,
  Archive,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
  Layers,
  Activity,
  Database,
  HardDrive,
  Package,
  Key,
  List,
  FileText,
} from 'lucide-react';
import {
  useListPlatformCustomers,
  useListPlatformReleases,
  useGetEnvironmentResources,
  useListProvisioningEvents,
  useListProvisioningOperations,
  useListEnvironmentSnapshots,
  useProvisionEnvironment,
  useVerifyEnvironment,
  useEnforceEnvironmentIsolation,
  useCreateEnvironmentBackup,
  useRefreshDtdEnvironment,
  useRestoreEnvironmentSnapshot,
  useRollbackEnvironmentRelease,
  useGetProvisioningOperation,
  getListPlatformCustomersQueryKey,
  getListPlatformReleasesQueryKey,
  getGetEnvironmentResourcesQueryKey,
  getListProvisioningEventsQueryKey,
  getListProvisioningOperationsQueryKey,
  getListEnvironmentSnapshotsQueryKey,
  getGetProvisioningOperationQueryKey,
  RefreshEnvironmentInputSanitizationPolicy,
  ProvisioningOperationStatus,
  EnvironmentSnapshotStatus,
  EnvironmentReleaseAssignmentDeploymentStatus,
  type PlatformCustomer,
  type PlatformCustomerEnvironment,
  type EnvironmentResourceInventoryResourcesItem,
  type EnvironmentSnapshot,
  type EnvironmentReleaseAssignment,
  type ProvisioningEvent,
  type ProvisioningOperation,
} from '@workspace/api-client-react';
import { Button, Badge, LoadingPanel, ErrorPanel, PageTitle, EmptyState } from '@/components/app-ui';
import { Modal } from '@workspace/construct-lifecycle-design-system/components/ui/modal';
import { toast } from '@workspace/construct-lifecycle-design-system/hooks/use-toast';

// ─── helpers ────────────────────────────────────────────────────────────────

function newKey(): string {
  return crypto.randomUUID();
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

function fmtShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(iso));
}

/**
 * Safe type guard: checks whether an unknown error value has the shape of
 * ApiError (status number, data field). Avoids importing ApiError directly
 * since it is not re-exported from the package index.
 */
function isApiErrorLike(err: unknown): err is { status: number; data: unknown } {
  return (
    !!err &&
    typeof err === 'object' &&
    typeof (err as Record<string, unknown>).status === 'number' &&
    'data' in (err as Record<string, unknown>)
  );
}

function extractProvisioningOperationFrom502(err: unknown): ProvisioningOperation | null {
  if (!isApiErrorLike(err)) return null;
  if (err.status !== 502) return null;
  const d = err.data;
  if (
    d &&
    typeof d === 'object' &&
    typeof (d as Record<string, unknown>).id === 'number' &&
    typeof (d as Record<string, unknown>).status === 'string'
  ) {
    return d as ProvisioningOperation;
  }
  return null;
}

// ─── resource type icon ──────────────────────────────────────────────────────

const RESOURCE_ICONS: Record<string, React.ComponentType<{ size?: number; className?: string }>> = {
  runtime: Server,
  database: Database,
  storage: HardDrive,
  queue: Layers,
  secrets: Key,
  jobs: Package,
  logs: List,
};

// ─── canonical resource types ────────────────────────────────────────────────

const CANONICAL_RESOURCE_TYPES = [
  'runtime',
  'database',
  'storage',
  'queue',
  'secrets',
  'jobs',
  'logs',
] as const;

// ─── status display helpers ──────────────────────────────────────────────────

type ResourceStatus =
  | 'requested'
  | 'provisioning'
  | 'ready'
  | 'degraded'
  | 'failed'
  | 'deprovisioning'
  | 'deprovisioned';

const RESOURCE_STATUS_CONFIG: Record<
  ResourceStatus,
  { label: string; tone: 'green' | 'orange' | 'red' | 'neutral'; icon: React.ComponentType<{ size?: number; className?: string }> }
> = {
  ready: { label: 'Ready', tone: 'green', icon: CheckCircle2 },
  provisioning: { label: 'Provisioning', tone: 'orange', icon: Loader2 },
  requested: { label: 'Requested', tone: 'neutral', icon: Clock },
  degraded: { label: 'Degraded', tone: 'orange', icon: AlertTriangle },
  failed: { label: 'Failed', tone: 'red', icon: XCircle },
  deprovisioning: { label: 'Deprovisioning', tone: 'orange', icon: Loader2 },
  deprovisioned: { label: 'Deprovisioned', tone: 'neutral', icon: XCircle },
};

function ResourceStatusCell({ status }: { status: string }) {
  const cfg = RESOURCE_STATUS_CONFIG[status as ResourceStatus] ?? {
    label: status,
    tone: 'neutral' as const,
    icon: Clock,
  };
  const Icon = cfg.icon;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon size={12} className="shrink-0" aria-hidden="true" />
      <Badge tone={cfg.tone}>{cfg.label}</Badge>
    </span>
  );
}

function EnvKindBadge({ kind }: { kind: string }) {
  if (kind === 'dtd') {
    return (
      <span className="mono inline-flex items-center gap-1 rounded-sm bg-status-warning/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-status-warning border border-status-warning/25">
        <FlaskConical size={8} aria-hidden="true" />
        DTD
      </span>
    );
  }
  return (
    <span className="mono inline-flex items-center gap-1 rounded-sm bg-status-success/12 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[.12em] text-status-success border border-status-success/20">
      <Globe size={8} aria-hidden="true" />
      Prod
    </span>
  );
}

// ─── IdempotencyDisplay ──────────────────────────────────────────────────────

function IdempotencyDisplay({ ikey }: { ikey: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2">
      <p className="mono text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground mb-1">Idempotency key</p>
      <p className="mono text-xs break-all text-foreground font-semibold select-all">{ikey}</p>
    </div>
  );
}

// ─── TrackedOperation (the panel shown at page level while polling) ───────────

interface TrackedOperationInfo {
  operationId: number;
  actionLabel: string;
  environmentName: string;
  idempotencyKey: string;
  environmentId: number;
}

interface OperationStatusPanelProps {
  tracked: TrackedOperationInfo;
  onTerminal: () => void;
  auditEvents?: ProvisioningEvent[];
}

function OperationStatusPanel({ tracked, onTerminal, auditEvents }: OperationStatusPanelProps) {
  const { operationId, actionLabel, environmentName, idempotencyKey } = tracked;

  // Whether we've already fired invalidations for this operation — prevent loops
  const invalidatedRef = useRef(false);
  const qc = useQueryClient();

  const opQ = useGetProvisioningOperation(operationId, {
    query: {
      enabled: true,
      queryKey: getGetProvisioningOperationQueryKey(operationId),
      // Poll every 2 s while active; stop when terminal
      refetchInterval: (query) => {
        const data = query.state.data;
        if (!data) return 2000;
        const s = (data as ProvisioningOperation).status;
        if (s === ProvisioningOperationStatus.succeeded || s === ProvisioningOperationStatus.failed) return false;
        return 2000;
      },
      retry: (failureCount, error) => {
        // On 502 treat as terminal — do not retry
        if (isApiErrorLike(error) && error.status === 502) return false;
        return failureCount < 3;
      },
    },
  });

  // Extract operation from either a successful query result or a 502 body
  const failedOperation = extractProvisioningOperationFrom502(opQ.error);
  const op: ProvisioningOperation | null = opQ.data ?? failedOperation ?? null;

  const status = op?.status ?? null;
  const isTerminal =
    status === ProvisioningOperationStatus.succeeded ||
    status === ProvisioningOperationStatus.failed;
  const statusCheckFailed = opQ.isError && !failedOperation;

  // Invalidate all affected queries exactly once when terminal
  useEffect(() => {
    if (!isTerminal || invalidatedRef.current) return;
    invalidatedRef.current = true;
    const envId = tracked.environmentId;
    qc.invalidateQueries({ queryKey: getGetEnvironmentResourcesQueryKey(envId) });
    qc.invalidateQueries({ queryKey: getListProvisioningEventsQueryKey(envId) });
    qc.invalidateQueries({ queryKey: getListProvisioningOperationsQueryKey(envId) });
    qc.invalidateQueries({ queryKey: getListEnvironmentSnapshotsQueryKey(envId) });
    qc.invalidateQueries({ queryKey: getListPlatformCustomersQueryKey() });
    qc.invalidateQueries({ queryKey: getListPlatformReleasesQueryKey() });
  }, [isTerminal, tracked.environmentId, qc]);

  const isPolling =
    status === ProvisioningOperationStatus.requested ||
    status === ProvisioningOperationStatus.running ||
    (!op && opQ.isFetching);

  const statusTone =
    status === ProvisioningOperationStatus.succeeded
      ? 'green'
      : status === ProvisioningOperationStatus.failed
      ? 'red'
      : 'orange';

  const statusLabel =
    status === ProvisioningOperationStatus.succeeded
      ? 'Succeeded'
      : status === ProvisioningOperationStatus.failed
      ? 'Failed'
      : status === ProvisioningOperationStatus.running
      ? 'Running'
      : status === ProvisioningOperationStatus.requested
      ? 'Requested'
      : statusCheckFailed
      ? 'Check failed'
      : 'Pending';

  // Error text: prefer operation.error, then 502 body error field, then generic
  const errorText: string | null =
    op?.error ??
    (statusCheckFailed ? 'Operation status is temporarily unavailable. Retry the status check before resubmitting this destructive action.' : null);

  return (
    <section
      aria-label="Active recovery operation"
      className={`rounded-xl border px-5 py-4 ${
        isTerminal && status === ProvisioningOperationStatus.failed
          ? 'border-destructive/30 bg-destructive/5'
          : isTerminal && status === ProvisioningOperationStatus.succeeded
          ? 'border-status-success/30 bg-status-success/5'
          : 'border-status-warning/30 bg-status-warning/5'
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 space-y-2.5">
          <div className="flex items-center gap-2 flex-wrap">
            {isPolling && (
              <Loader2 size={14} className="shrink-0 animate-spin text-status-warning" aria-hidden="true" />
            )}
            {isTerminal && status === ProvisioningOperationStatus.succeeded && (
              <CheckCircle2 size={14} className="shrink-0 text-status-success" aria-hidden="true" />
            )}
            {isTerminal && status !== ProvisioningOperationStatus.succeeded && (
              <XCircle size={14} className="shrink-0 text-destructive" aria-hidden="true" />
            )}
            <p className="text-sm font-bold">
              {actionLabel}
              {isPolling ? ' — in progress' : isTerminal ? ` — ${statusLabel.toLowerCase()}` : ''}
            </p>
            <Badge
              tone={
                status === ProvisioningOperationStatus.succeeded
                  ? 'green'
                  : status === ProvisioningOperationStatus.failed
                  ? 'red'
                  : 'orange'
              }
            >
              {statusLabel}
            </Badge>
          </div>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-4">
            <div>
              <dt className="font-semibold text-muted-foreground">Operation ID</dt>
              <dd className="font-mono">{operationId}</dd>
            </div>
            <div>
              <dt className="font-semibold text-muted-foreground">Environment</dt>
              <dd className="truncate">{environmentName}</dd>
            </div>
            {op?.operationType && (
              <div>
                <dt className="font-semibold text-muted-foreground">Type</dt>
                <dd className="font-mono">{op.operationType}</dd>
              </div>
            )}
            {op?.startedAt && (
              <div>
                <dt className="font-semibold text-muted-foreground">Started</dt>
                <dd>{fmtShort(op.startedAt)}</dd>
              </div>
            )}
            {op?.completedAt && (
              <div>
                <dt className="font-semibold text-muted-foreground">Completed</dt>
                <dd>{fmtShort(op.completedAt)}</dd>
              </div>
            )}
            {op?.providerOperationId && (
              <div>
                <dt className="font-semibold text-muted-foreground">Provider operation</dt>
                <dd className="font-mono truncate" title={op.providerOperationId}>{op.providerOperationId}</dd>
              </div>
            )}
          </dl>

          <div>
            <p className="mono text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground mb-1">
              Idempotency key
            </p>
            <p className="mono text-xs break-all select-all text-foreground">{idempotencyKey}</p>
          </div>

          {errorText && (
            <div
              role="alert"
              className="rounded-lg border border-destructive/25 bg-card px-3 py-2 text-xs text-destructive"
            >
              <p className="font-bold mb-0.5">Operation error</p>
              <p className="text-muted-foreground">{errorText}</p>
            </div>
          )}

          {auditEvents && (
            <div className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
              <p className="mono mb-1 text-[9px] font-bold uppercase tracking-[.14em] text-muted-foreground">
                Audit outcome
              </p>
              {auditEvents.length > 0 ? (
                <ul className="space-y-1">
                  {auditEvents.map((event) => (
                    <li key={event.id} className="flex flex-wrap gap-x-2 gap-y-0.5">
                      <span className="font-semibold">{event.action}</span>
                      <span className="text-muted-foreground">{fmtShort(event.occurredAt)}</span>
                      {typeof event.details?.error === 'string' && (
                        <span className="w-full text-destructive">{event.details.error}</span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground">No operation audit event has been recorded yet.</p>
              )}
            </div>
          )}

          {isPolling && (
            <p className="mono text-[10px] text-muted-foreground">
              Polling every 2 s — waiting for provider verification
            </p>
          )}
        </div>

        {statusCheckFailed && (
          <Button variant="outline" onClick={() => opQ.refetch()} disabled={opQ.isFetching}>
            Retry status
          </Button>
        )}
        {isTerminal && (
          <Button variant="outline" onClick={onTerminal}>
            Dismiss
          </Button>
        )}
      </div>
    </section>
  );
}

// ─── EnvironmentSelector ─────────────────────────────────────────────────────

interface EnvironmentSelectorProps {
  customers: PlatformCustomer[];
  selectedEnvId: number | null;
  onSelect: (envId: number) => void;
}

function EnvironmentSelector({ customers, selectedEnvId, onSelect }: EnvironmentSelectorProps) {
  const [expanded, setExpanded] = useState<Set<number>>(() => {
    const s = new Set<number>();
    if (customers.length > 0) s.add(customers[0].id);
    return s;
  });

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <nav aria-label="Customer environments" className="space-y-1">
      {customers.map((customer) => (
        <div key={customer.id}>
          <button
            type="button"
            onClick={() => toggle(customer.id)}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs font-bold hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring transition-colors"
            aria-expanded={expanded.has(customer.id)}
          >
            {expanded.has(customer.id) ? (
              <ChevronDown size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            ) : (
              <ChevronRight size={13} className="shrink-0 text-muted-foreground" aria-hidden="true" />
            )}
            <span className="min-w-0 flex-1 truncate">{customer.name}</span>
            <span className="mono text-[9px] text-muted-foreground font-normal shrink-0">
              {customer.environments.length} env
            </span>
          </button>
          {expanded.has(customer.id) && (
            <div className="ml-4 mt-0.5 space-y-0.5">
              {customer.environments.map((env) => {
                const isSelected = env.id === selectedEnvId;
                return (
                  <button
                    key={env.id}
                    type="button"
                    onClick={() => onSelect(env.id)}
                    aria-current={isSelected ? 'true' : undefined}
                    className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                      isSelected
                        ? 'bg-primary/10 text-primary font-semibold'
                        : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground font-medium'
                    }`}
                  >
                    <EnvKindBadge kind={env.kind} />
                    <span className="min-w-0 flex-1 truncate">{env.name}</span>
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        env.status === 'active' ? 'bg-status-success' : 'bg-muted-foreground/50'
                      }`}
                      aria-label={env.status}
                    />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ))}
    </nav>
  );
}

// ─── ResourceTable ───────────────────────────────────────────────────────────

function ResourceTable({ resources }: { resources: EnvironmentResourceInventoryResourcesItem[] }) {
  // Index API resources by type for O(1) lookup
  const byType = new Map<string, EnvironmentResourceInventoryResourcesItem>();
  for (const r of resources) {
    byType.set(r.resourceType, r);
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" aria-label="Environment resources">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">Type</th>
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">Status</th>
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">Provider</th>
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">External ID</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground">Endpoint</th>
          </tr>
        </thead>
        <tbody>
          {CANONICAL_RESOURCE_TYPES.map((resourceType) => {
            const r = byType.get(resourceType);
            const Icon = RESOURCE_ICONS[resourceType] ?? Server;
            return (
              <tr key={resourceType} className="border-b border-border/50 last:border-0">
                <td className="py-2 pr-4">
                  <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                    <Icon size={12} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                    {resourceType}
                  </span>
                </td>
                {r ? (
                  <>
                    <td className="py-2 pr-4">
                      <ResourceStatusCell status={r.status} />
                    </td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground">{r.providerKey}</td>
                    <td className="py-2 pr-4 font-mono text-muted-foreground max-w-[140px] truncate">
                      {r.externalId ?? '—'}
                    </td>
                    <td className="py-2 font-mono text-muted-foreground max-w-[160px] truncate">
                      {r.endpoint ?? '—'}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="py-2 text-muted-foreground italic">
                    Not provisioned
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── EventList ───────────────────────────────────────────────────────────────

function EventList({ events }: { events: ProvisioningEvent[] }) {
  if (events.length === 0) {
    return <EmptyState icon={Activity} title="No events" text="Provisioning events will appear here as actions are taken." />;
  }

  return (
    <ol aria-label="Provisioning events" className="space-y-0">
      {events.slice(0, 30).map((ev, i) => (
        <li key={ev.id} className={`flex gap-3 py-2.5 ${i < events.length - 1 ? 'border-b border-border/40' : ''}`}>
          <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-secondary">
            <Activity size={10} className="text-muted-foreground" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-foreground">{ev.action}</p>
            {ev.details && Object.keys(ev.details).length > 0 && (
              <p className="mono mt-0.5 text-[10px] text-muted-foreground truncate">
                {Object.entries(ev.details)
                  .slice(0, 3)
                  .map(([k, v]) => `${k}: ${String(v)}`)
                  .join(' · ')}
              </p>
            )}
            <p className="mono mt-0.5 text-[10px] text-muted-foreground">
              {fmtDate(ev.occurredAt)}
              {ev.operationId != null && ` · op ${ev.operationId}`}
              {ev.actorUserId != null && ` · user ${ev.actorUserId}`}
            </p>
          </div>
        </li>
      ))}
    </ol>
  );
}

function recoveryOperationLabel(operationType: string): string {
  switch (operationType) {
    case 'refresh':
      return 'Refresh D/T/D from Production';
    case 'restore':
      return 'Restore from Snapshot';
    case 'rollback':
      return 'Roll Back Release';
    default:
      return operationType;
  }
}

function recoveryOperationTone(status: string): 'green' | 'orange' | 'red' | 'neutral' {
  if (status === 'succeeded') return 'green';
  if (status === 'failed') return 'red';
  if (status === 'running' || status === 'requested') return 'orange';
  return 'neutral';
}

function RecoveryOperationHistory({
  operations,
  selectedId,
  onSelect,
}: {
  operations: ProvisioningOperation[];
  selectedId: number | null;
  onSelect: (operationId: number) => void;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5" aria-label="Recovery operation history">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold">Recovery operations</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Active and recently completed refresh, restore, and rollback operations for this environment.
          </p>
        </div>
        <span className="mono text-[10px] text-muted-foreground">{operations.length} shown</span>
      </div>
      {operations.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-xs text-muted-foreground">
          No recovery operations have been recorded for this environment.
        </p>
      ) : (
        <div className="space-y-1.5">
          {operations.map((operation) => {
            const isSelected = operation.id === selectedId;
            return (
              <button
                key={operation.id}
                type="button"
                onClick={() => onSelect(operation.id)}
                aria-expanded={isSelected}
                className={`flex w-full flex-wrap items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  isSelected
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border bg-secondary/20 hover:bg-secondary/50'
                }`}
              >
                <Activity size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-semibold">{recoveryOperationLabel(operation.operationType)}</span>
                  <span className="mono mt-0.5 block text-[10px] text-muted-foreground">
                    op {operation.id} · {fmtShort(operation.createdAt)}
                  </span>
                </span>
                <Badge tone={recoveryOperationTone(operation.status)}>{operation.status}</Badge>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}

// ─── SnapshotTable ───────────────────────────────────────────────────────────

function SnapshotTable({ snapshots }: { snapshots: EnvironmentSnapshot[] }) {
  if (snapshots.length === 0) {
    return <EmptyState icon={Archive} title="No snapshots" text="No snapshots exist for this environment." />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs" aria-label="Environment snapshots">
        <thead>
          <tr className="border-b border-border">
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">ID</th>
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">Kind</th>
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">Status</th>
            <th className="pb-2 pr-4 text-left font-semibold text-muted-foreground">Sanitized</th>
            <th className="pb-2 text-left font-semibold text-muted-foreground">Created</th>
          </tr>
        </thead>
        <tbody>
          {snapshots.map((s) => (
            <tr key={s.id} className="border-b border-border/50 last:border-0">
              <td className="py-2 pr-4 font-mono text-muted-foreground">{s.id}</td>
              <td className="py-2 pr-4">
                <Badge tone={s.kind === 'backup' ? 'teal' : 'violet'}>{s.kind}</Badge>
              </td>
              <td className="py-2 pr-4">
                <Badge
                  tone={
                    s.status === 'verified'
                      ? 'green'
                      : s.status === 'failed'
                      ? 'red'
                      : s.status === 'running'
                      ? 'orange'
                      : 'neutral'
                  }
                >
                  {s.status}
                </Badge>
              </td>
              <td className="py-2 pr-4">
                <Badge tone={s.sanitized === 'sanitized' ? 'green' : 'neutral'}>{s.sanitized}</Badge>
              </td>
              <td className="py-2 font-mono text-muted-foreground">{fmtShort(s.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── ActionModal action types ─────────────────────────────────────────────────

type ActionKind =
  | 'provision'
  | 'verify'
  | 'backup'
  | 'refresh'
  | 'restore'
  | 'rollback'
  | 'isolation';

interface BaseAction {
  kind: ActionKind;
  environmentId: number;
  environmentName: string;
  ikey: string;
}

interface ProvisionAction extends BaseAction { kind: 'provision' }
interface VerifyAction extends BaseAction { kind: 'verify' }
interface BackupAction extends BaseAction { kind: 'backup' }
interface IsolationAction extends BaseAction { kind: 'isolation' }
interface RefreshAction extends BaseAction {
  kind: 'refresh';
  sourceEnvironmentId: number;
  sourceEnvironmentName: string;
  sanitizationPolicy: string;
}
interface RestoreAction extends BaseAction {
  kind: 'restore';
  snapshot: EnvironmentSnapshot;
}
interface RollbackAction extends BaseAction {
  kind: 'rollback';
  assignment: EnvironmentReleaseAssignment;
  releaseVersion: string;
}

type PendingAction =
  | ProvisionAction
  | VerifyAction
  | BackupAction
  | IsolationAction
  | RefreshAction
  | RestoreAction
  | RollbackAction;

// ─── EnvironmentPanel (main right panel) ─────────────────────────────────────

interface EnvironmentPanelProps {
  envId: number;
  customer: PlatformCustomer;
  env: PlatformCustomerEnvironment;
  onAction: (action: PendingAction) => void;
}

function EnvironmentPanel({ envId, customer, env, onAction }: EnvironmentPanelProps) {
  const [tab, setTab] = useState<'resources' | 'events' | 'snapshots' | 'releases'>('resources');
  const [selectedOperationId, setSelectedOperationId] = useState<number | null>(null);

  const resourcesQ = useGetEnvironmentResources(envId, {
    query: { enabled: !!envId, queryKey: getGetEnvironmentResourcesQueryKey(envId) },
  });
  const eventsQ = useListProvisioningEvents(envId, {
    query: { enabled: !!envId, queryKey: getListProvisioningEventsQueryKey(envId) },
  });
  const operationsQ = useListProvisioningOperations(envId, {
    query: { enabled: !!envId, queryKey: getListProvisioningOperationsQueryKey(envId) },
  });
  const snapshotsQ = useListEnvironmentSnapshots(envId, {
    query: { enabled: !!envId, queryKey: getListEnvironmentSnapshotsQueryKey(envId) },
  });
  const releasesQ = useListPlatformReleases({
    query: { queryKey: getListPlatformReleasesQueryKey() },
  });

  useEffect(() => {
    setSelectedOperationId(null);
  }, [envId]);

  const selectedOperation = (operationsQ.data ?? []).find((operation) => operation.id === selectedOperationId) ?? null;

  const isDtd = env.kind === 'dtd';

  // Production env for same customer (for refresh)
  const prodEnv = customer.environments.find((e) => e.kind !== 'dtd');

  // Verified snapshots eligible for restore (same environment)
  const verifiedSnapshots = (snapshotsQ.data ?? []).filter(
    (s) => s.status === EnvironmentSnapshotStatus.verified,
  );

  // Deployed release assignments for this environment
  const deployedAssignments: Array<{ assignment: EnvironmentReleaseAssignment; releaseVersion: string }> = [];
  for (const release of releasesQ.data ?? []) {
    for (const asgn of release.assignments) {
      if (
        asgn.environmentId === envId &&
        asgn.deploymentStatus === EnvironmentReleaseAssignmentDeploymentStatus.deployed
      ) {
        deployedAssignments.push({ assignment: asgn, releaseVersion: release.version });
      }
    }
  }

  const TABS = [
    { key: 'resources' as const, label: 'Resources' },
    { key: 'events' as const, label: 'Events' },
    { key: 'snapshots' as const, label: 'Snapshots' },
    { key: 'releases' as const, label: 'Releases' },
  ];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-base font-bold">{env.name}</h2>
              <EnvKindBadge kind={env.kind} />
              <Badge tone={env.status === 'active' ? 'green' : 'neutral'}>{env.status}</Badge>
            </div>
            <p className="mono mt-1 text-[10px] text-muted-foreground">
              {customer.name} · env {envId}
              {resourcesQ.data && (
                <>
                  {' '}· {resourcesQ.data.resources.length} resources
                  {resourcesQ.data.executionContextReady ? ' · context ready' : ' · context not ready'}
                </>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                onAction({ kind: 'provision', environmentId: envId, environmentName: env.name, ikey: newKey() })
              }
            >
              <Server size={13} aria-hidden="true" />
              Provision
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onAction({ kind: 'verify', environmentId: envId, environmentName: env.name, ikey: newKey() })
              }
            >
              <ShieldCheck size={13} aria-hidden="true" />
              Verify
            </Button>
            <Button
              variant="outline"
              onClick={() =>
                onAction({ kind: 'backup', environmentId: envId, environmentName: env.name, ikey: newKey() })
              }
            >
              <Archive size={13} aria-hidden="true" />
              Backup
            </Button>
            {isDtd && prodEnv && (
              <Button
                variant="outline"
                onClick={() =>
                  onAction({
                    kind: 'refresh',
                    environmentId: envId,
                    environmentName: env.name,
                    ikey: newKey(),
                    sourceEnvironmentId: prodEnv.id,
                    sourceEnvironmentName: prodEnv.name,
                    sanitizationPolicy: RefreshEnvironmentInputSanitizationPolicy['redact-secrets'],
                  })
                }
              >
                <RefreshCw size={13} aria-hidden="true" />
                Refresh from Prod
              </Button>
            )}
            <Button
              variant="danger"
              onClick={() =>
                onAction({ kind: 'isolation', environmentId: envId, environmentName: env.name, ikey: newKey() })
              }
            >
              <Shield size={13} aria-hidden="true" />
              Enforce Isolation
            </Button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        {operationsQ.isLoading && <LoadingPanel lines={3} />}
        {operationsQ.isError && <ErrorPanel onRetry={() => operationsQ.refetch()} />}
        {operationsQ.data && (
          <>
            <RecoveryOperationHistory
              operations={operationsQ.data}
              selectedId={selectedOperationId}
              onSelect={setSelectedOperationId}
            />
            {selectedOperation && (
              <OperationStatusPanel
                tracked={{
                  operationId: selectedOperation.id,
                  actionLabel: recoveryOperationLabel(selectedOperation.operationType),
                  environmentName: env.name,
                  idempotencyKey: selectedOperation.idempotencyKey,
                  environmentId: envId,
                }}
                auditEvents={eventsQ.data?.filter((event) => event.operationId === selectedOperation.id)}
                onTerminal={() => setSelectedOperationId(null)}
              />
            )}
          </>
        )}
      </div>

      {/* Tabs */}
      <div className="rounded-xl border border-border bg-card overflow-hidden">
        <div className="flex border-b border-border" role="tablist" aria-label="Environment detail tabs">
          {TABS.map(({ key, label }) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              aria-controls={`tabpanel-${key}`}
              id={`tab-${key}`}
              type="button"
              onClick={() => setTab(key)}
              className={`px-4 py-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${
                tab === key
                  ? 'border-b-2 border-primary text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="p-5" id={`tabpanel-${tab}`} role="tabpanel" aria-labelledby={`tab-${tab}`}>
          {/* Resources tab */}
          {tab === 'resources' && (
            <>
              {resourcesQ.isLoading && <LoadingPanel lines={4} />}
              {resourcesQ.isError && <ErrorPanel onRetry={() => resourcesQ.refetch()} />}
              {resourcesQ.data && <ResourceTable resources={resourcesQ.data.resources} />}
            </>
          )}

          {/* Events tab */}
          {tab === 'events' && (
            <>
              {eventsQ.isLoading && <LoadingPanel lines={5} />}
              {eventsQ.isError && <ErrorPanel onRetry={() => eventsQ.refetch()} />}
              {eventsQ.data && <EventList events={eventsQ.data} />}
            </>
          )}

          {/* Snapshots tab */}
          {tab === 'snapshots' && (
            <div className="space-y-5">
              {snapshotsQ.isLoading && <LoadingPanel lines={4} />}
              {snapshotsQ.isError && <ErrorPanel onRetry={() => snapshotsQ.refetch()} />}
              {snapshotsQ.data && <SnapshotTable snapshots={snapshotsQ.data} />}
              {snapshotsQ.data && verifiedSnapshots.length > 0 && (
                <div>
                  <p className="mb-2 text-xs font-semibold text-muted-foreground">
                    Restore from verified snapshot
                  </p>
                  <div className="space-y-1.5">
                    {verifiedSnapshots.map((snap) => (
                      <div
                        key={snap.id}
                        className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2"
                      >
                        <div className="min-w-0 flex-1">
                          <span className="mono text-xs font-semibold">Snapshot {snap.id}</span>
                          <span className="mono ml-2 text-[10px] text-muted-foreground">
                            {snap.kind} · {fmtShort(snap.createdAt)}
                            {snap.checksum && ` · ${snap.checksum.slice(0, 8)}…`}
                          </span>
                        </div>
                        <Button
                          variant="danger"
                          onClick={() =>
                            onAction({
                              kind: 'restore',
                              environmentId: envId,
                              environmentName: env.name,
                              ikey: newKey(),
                              snapshot: snap,
                            })
                          }
                        >
                          <RotateCcw size={12} aria-hidden="true" />
                          Restore
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Releases tab */}
          {tab === 'releases' && (
            <div className="space-y-5">
              {releasesQ.isLoading && <LoadingPanel lines={4} />}
              {releasesQ.isError && <ErrorPanel onRetry={() => releasesQ.refetch()} />}
              {releasesQ.data && deployedAssignments.length === 0 && (
                <EmptyState
                  icon={FileText}
                  title="No deployed releases"
                  text="No deployed release assignments found for this environment. Only deployed assignments can be rolled back."
                />
              )}
              {releasesQ.data && deployedAssignments.length > 0 && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground mb-3">Deployed release assignments</p>
                  {deployedAssignments.map(({ assignment, releaseVersion }) => (
                    <div
                      key={assignment.id}
                      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-secondary/30 px-3 py-2"
                    >
                      <div className="min-w-0 flex-1">
                        <span className="text-xs font-semibold">Release {releaseVersion}</span>
                        <span className="mono ml-2 text-[10px] text-muted-foreground">
                          assignment {assignment.id} · {assignment.deploymentStatus}
                        </span>
                      </div>
                      <Button
                        variant="danger"
                        onClick={() =>
                          onAction({
                            kind: 'rollback',
                            environmentId: envId,
                            environmentName: env.name,
                            ikey: newKey(),
                            assignment,
                            releaseVersion,
                          })
                        }
                      >
                        <RotateCcw size={12} aria-hidden="true" />
                        Rollback
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── ActionModal ─────────────────────────────────────────────────────────────

interface ActionModalProps {
  action: PendingAction;
  onClose: () => void;
  /** Called for simple completions (provision, verify, backup, isolation). */
  onDone: () => void;
  /** Called for async operations (refresh, restore, rollback) — passes tracking info. */
  onOperationStarted: (info: TrackedOperationInfo) => void;
}

function ActionModal({ action, onClose, onDone, onOperationStarted }: ActionModalProps) {
  const [ikey, setIkey] = useState(action.ikey);
  const [sanitizationPolicy, setSanitizationPolicy] = useState<string>(
    action.kind === 'refresh' ? action.sanitizationPolicy : RefreshEnvironmentInputSanitizationPolicy['redact-secrets'],
  );

  const provision = useProvisionEnvironment();
  const verify = useVerifyEnvironment();
  const backup = useCreateEnvironmentBackup();
  const refresh = useRefreshDtdEnvironment();
  const restore = useRestoreEnvironmentSnapshot();
  const rollback = useRollbackEnvironmentRelease();
  const isolation = useEnforceEnvironmentIsolation();

  const isPending =
    provision.isPending ||
    verify.isPending ||
    backup.isPending ||
    refresh.isPending ||
    restore.isPending ||
    rollback.isPending ||
    isolation.isPending;

  const lastError =
    provision.error || verify.error || backup.error || refresh.error || restore.error || rollback.error || isolation.error;

  // Capture ikey in a ref so the onSuccess closures always see the live value
  const ikeyRef = useRef(ikey);
  ikeyRef.current = ikey;

  const handleSubmit = useCallback(() => {
    // Snapshot ikey at submission time — the modal stays open only for sync paths
    const submittedKey = ikeyRef.current;

    switch (action.kind) {
      case 'provision':
        provision.mutate(
          { environmentId: action.environmentId, data: { idempotencyKey: submittedKey } },
          {
            onSuccess: () => {
              toast({
                title: 'Provision accepted',
                description: `Provision for "${action.environmentName}" has been accepted. Idempotency key: ${submittedKey}`,
              });
              onDone();
            },
          },
        );
        break;

      case 'verify':
        verify.mutate(
          { environmentId: action.environmentId, data: { idempotencyKey: submittedKey } },
          {
            onSuccess: () => {
              toast({
                title: 'Verification accepted',
                description: `Verification for "${action.environmentName}" has been accepted. Idempotency key: ${submittedKey}`,
              });
              onDone();
            },
          },
        );
        break;

      case 'backup':
        backup.mutate(
          { environmentId: action.environmentId, data: { idempotencyKey: submittedKey } },
          {
            onSuccess: () => {
              toast({
                title: 'Backup accepted',
                description: `Backup for "${action.environmentName}" has been accepted. Idempotency key: ${submittedKey}`,
              });
              onDone();
            },
          },
        );
        break;

      case 'refresh':
        refresh.mutate(
          {
            environmentId: action.environmentId,
            data: {
              sourceEnvironmentId: action.sourceEnvironmentId,
              sanitizationPolicy: sanitizationPolicy as typeof RefreshEnvironmentInputSanitizationPolicy[keyof typeof RefreshEnvironmentInputSanitizationPolicy],
              idempotencyKey: submittedKey,
            },
          },
          {
            onSuccess: (result) => {
              toast({
                title: 'Refresh accepted — pending verification',
                description: `Refresh for "${action.environmentName}" is running. Operation ID: ${result.operationId}. Idempotency key: ${submittedKey}`,
              });
              onOperationStarted({
                operationId: result.operationId,
                actionLabel: 'Refresh D/T/D from Production',
                environmentName: action.environmentName,
                idempotencyKey: submittedKey,
                environmentId: action.environmentId,
              });
            },
          },
        );
        break;

      case 'restore':
        restore.mutate(
          { snapshotId: action.snapshot.id, data: { idempotencyKey: submittedKey, rollback: false } },
          {
            onSuccess: (result) => {
              toast({
                title: 'Restore accepted — pending verification',
                description: `Restore for "${action.environmentName}" is running. Operation ID: ${result.operation.id}. Idempotency key: ${submittedKey}`,
              });
              onOperationStarted({
                operationId: result.operation.id,
                actionLabel: 'Restore from Snapshot',
                environmentName: action.environmentName,
                idempotencyKey: submittedKey,
                environmentId: action.environmentId,
              });
            },
          },
        );
        break;

      case 'rollback':
        rollback.mutate(
          { assignmentId: action.assignment.id, data: { idempotencyKey: submittedKey, rollback: true } },
          {
            onSuccess: (result) => {
              toast({
                title: 'Rollback accepted — pending verification',
                description: `Rollback of release ${action.releaseVersion} for "${action.environmentName}" is running. Operation ID: ${result.operation.id}. Idempotency key: ${submittedKey}`,
              });
              onOperationStarted({
                operationId: result.operation.id,
                actionLabel: `Roll Back Release ${action.releaseVersion}`,
                environmentName: action.environmentName,
                idempotencyKey: submittedKey,
                environmentId: action.environmentId,
              });
            },
          },
        );
        break;

      case 'isolation':
        isolation.mutate(
          { environmentId: action.environmentId },
          {
            onSuccess: () => {
              toast({
                title: 'Isolation enforced',
                description: `Isolation has been enforced on "${action.environmentName}".`,
              });
              onDone();
            },
          },
        );
        break;
    }
  }, [action, sanitizationPolicy, provision, verify, backup, refresh, restore, rollback, isolation, onDone, onOperationStarted]);

  const isDestructive = action.kind === 'refresh' || action.kind === 'restore' || action.kind === 'rollback' || action.kind === 'isolation';

  const titles: Record<ActionKind, string> = {
    provision: 'Provision Environment',
    verify: 'Verify Environment Health',
    backup: 'Create Backup Snapshot',
    refresh: 'Refresh D/T/D from Production',
    restore: 'Restore from Snapshot',
    rollback: 'Roll Back Release',
    isolation: 'Enforce Environment Isolation',
  };

  return (
    <Modal title={titles[action.kind]} onClose={onClose}>
      <div className="space-y-5">
        {isDestructive && (
          <div
            role="alert"
            className="flex gap-3 rounded-lg border border-destructive/30 bg-destructive/8 px-4 py-3"
          >
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-destructive" aria-hidden="true" />
            <div className="text-sm">
              <p className="font-bold text-destructive">Destructive action — review carefully</p>
              <p className="mt-0.5 text-muted-foreground text-xs leading-5">
                {action.kind === 'refresh' &&
                  `This will replace all data in "${action.environmentName}" with a sanitized copy of "${(action as RefreshAction).sourceEnvironmentName}". All existing D/T/D data will be permanently overwritten.`}
                {action.kind === 'restore' &&
                  `This will restore "${action.environmentName}" to snapshot ${(action as RestoreAction).snapshot.id} (${(action as RestoreAction).snapshot.kind}, created ${fmtDate((action as RestoreAction).snapshot.createdAt)}). Current state will be lost.`}
                {action.kind === 'rollback' &&
                  `This will roll back release ${(action as RollbackAction).releaseVersion} (assignment ${(action as RollbackAction).assignment.id}) in "${action.environmentName}". The environment will revert to its pre-deployment state.`}
                {action.kind === 'isolation' &&
                  `This will enforce strict isolation on "${action.environmentName}". All shared execution contexts will be severed. Tenant data will be strictly separated from other customers.`}
              </p>
            </div>
          </div>
        )}

        {/* Async operation note for refresh/restore/rollback */}
        {(action.kind === 'refresh' || action.kind === 'restore' || action.kind === 'rollback') && (
          <div className="flex gap-2 rounded-lg border border-border bg-secondary/40 px-3 py-2.5 text-xs text-muted-foreground">
            <Clock size={13} className="mt-0.5 shrink-0" aria-hidden="true" />
            <span>
              This action runs asynchronously. After submission, a live operation status panel will appear on the page and poll for provider verification. The modal will close once the request is accepted.
            </span>
          </div>
        )}

        {/* Target / source summary */}
        <div className="rounded-lg border border-border bg-secondary/40 px-4 py-3 text-xs space-y-1.5">
          <div className="flex gap-2">
            <span className="w-24 shrink-0 font-semibold text-muted-foreground">Target</span>
            <span className="font-medium">{action.environmentName}</span>
          </div>
          {action.kind === 'refresh' && (
            <div className="flex gap-2">
              <span className="w-24 shrink-0 font-semibold text-muted-foreground">Source</span>
              <span className="font-medium">{(action as RefreshAction).sourceEnvironmentName}</span>
            </div>
          )}
          {action.kind === 'restore' && (
            <>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 font-semibold text-muted-foreground">Snapshot</span>
                <span className="font-mono">{(action as RestoreAction).snapshot.id}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 font-semibold text-muted-foreground">Created</span>
                <span>{fmtDate((action as RestoreAction).snapshot.createdAt)}</span>
              </div>
            </>
          )}
          {action.kind === 'rollback' && (
            <>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 font-semibold text-muted-foreground">Release</span>
                <span className="font-mono">{(action as RollbackAction).releaseVersion}</span>
              </div>
              <div className="flex gap-2">
                <span className="w-24 shrink-0 font-semibold text-muted-foreground">Assignment</span>
                <span className="font-mono">{(action as RollbackAction).assignment.id}</span>
              </div>
            </>
          )}
          <div className="flex gap-2">
            <span className="w-24 shrink-0 font-semibold text-muted-foreground">Env ID</span>
            <span className="font-mono">{action.environmentId}</span>
          </div>
        </div>

        {/* Sanitization policy selector (refresh only) */}
        {action.kind === 'refresh' && (
          <div>
            <label className="block">
              <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">
                Sanitization policy
              </span>
              <select
                value={sanitizationPolicy}
                onChange={(e) => setSanitizationPolicy(e.target.value)}
                className="w-full rounded-lg border border-input bg-card px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20"
                aria-label="Sanitization policy"
              >
                <option value={RefreshEnvironmentInputSanitizationPolicy['redact-secrets']}>
                  redact-secrets — Remove secret values, keep structure
                </option>
                <option value={RefreshEnvironmentInputSanitizationPolicy['replace-identifiers']}>
                  replace-identifiers — Replace PII and IDs with synthetic values
                </option>
                <option value={RefreshEnvironmentInputSanitizationPolicy.full}>
                  full — Full sanitization (secrets + identifiers)
                </option>
              </select>
            </label>
          </div>
        )}

        {/* Idempotency key */}
        {action.kind !== 'isolation' && (
          <div>
            <p className="mb-2 text-xs font-semibold text-muted-foreground">
              Idempotency key
              <span className="ml-1 font-normal">— generated when this dialog opened. Safe to retry on error.</span>
            </p>
            <IdempotencyDisplay ikey={ikey} />
            <button
              type="button"
              onClick={() => setIkey(newKey())}
              className="mt-1.5 text-[10px] text-muted-foreground underline hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded"
              disabled={isPending}
            >
              Regenerate key
            </button>
          </div>
        )}

        {/* Submission error display */}
        {lastError && (
          <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/8 px-3 py-2.5 text-xs text-destructive">
            <p className="font-bold mb-0.5">Submission failed</p>
            <p className="text-muted-foreground">
              {typeof (lastError as unknown as Record<string, unknown>)?.message === 'string'
                ? String((lastError as unknown as Record<string, unknown>).message)
                : 'An error occurred. The idempotency key above is unchanged — retry safely.'}
            </p>
            {action.kind !== 'isolation' && (
              <p className="mt-1 font-mono text-[10px]">Key retained: {ikey}</p>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap items-center gap-3 pt-1">
          <Button
            variant={isDestructive ? 'danger' : 'primary'}
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending && <Loader2 size={13} className="animate-spin" aria-hidden="true" />}
            {isPending
              ? 'Submitting…'
              : action.kind === 'provision'
              ? 'Provision'
              : action.kind === 'verify'
              ? 'Verify health'
              : action.kind === 'backup'
              ? 'Create backup'
              : action.kind === 'refresh'
              ? 'Refresh D/T/D'
              : action.kind === 'restore'
              ? 'Restore snapshot'
              : action.kind === 'rollback'
              ? 'Roll back release'
              : 'Enforce isolation'}
          </Button>
          <Button variant="ghost" disabled={isPending} onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── PlatformRecovery (page root) ────────────────────────────────────────────

export function PlatformRecovery() {
  const qc = useQueryClient();
  const [selectedEnvId, setSelectedEnvId] = useState<number | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [trackedOperation, setTrackedOperation] = useState<TrackedOperationInfo | null>(null);

  const customersQ = useListPlatformCustomers({
    query: { queryKey: getListPlatformCustomersQueryKey() },
  });

  useEffect(() => {
    if (selectedEnvId !== null) return;
    const firstEnvironment = customersQ.data?.flatMap((customer) => customer.environments)[0];
    if (firstEnvironment) setSelectedEnvId(firstEnvironment.id);
  }, [customersQ.data, selectedEnvId]);

  const handleEnvSelect = useCallback((envId: number) => {
    setSelectedEnvId(envId);
  }, []);

  const handleAction = useCallback((action: PendingAction) => {
    setPendingAction(action);
  }, []);

  const handleClose = useCallback(() => {
    setPendingAction(null);
  }, []);

  // Simple completion path for provision / verify / backup / isolation
  const handleDone = useCallback(() => {
    setPendingAction(null);
    if (selectedEnvId) {
      qc.invalidateQueries({ queryKey: getGetEnvironmentResourcesQueryKey(selectedEnvId) });
      qc.invalidateQueries({ queryKey: getListProvisioningEventsQueryKey(selectedEnvId) });
      qc.invalidateQueries({ queryKey: getListEnvironmentSnapshotsQueryKey(selectedEnvId) });
    }
    qc.invalidateQueries({ queryKey: getListPlatformCustomersQueryKey() });
    qc.invalidateQueries({ queryKey: getListPlatformReleasesQueryKey() });
  }, [qc, selectedEnvId]);

  // Async path: modal accepted the request and returned an operationId
  const handleOperationStarted = useCallback((info: TrackedOperationInfo) => {
    setPendingAction(null);
    setTrackedOperation(info);
  }, []);

  // Dismiss the operation panel after the operator acknowledges terminal state
  const handleOperationDismiss = useCallback(() => {
    setTrackedOperation(null);
  }, []);

  if (customersQ.isLoading) {
    return (
      <>
        <PageTitle
          eyebrow="Platform"
          title="Environment Recovery"
          description="Inspect every customer environment and execute audited recovery actions."
        />
        <LoadingPanel lines={7} />
      </>
    );
  }

  if (customersQ.isError) {
    return (
      <>
        <PageTitle
          eyebrow="Platform"
          title="Environment Recovery"
          description="Inspect every customer environment and execute audited recovery actions."
        />
        <ErrorPanel onRetry={() => customersQ.refetch()} />
      </>
    );
  }

  const customers = customersQ.data ?? [];

  // Find selected environment and its customer
  let selectedEnv: PlatformCustomerEnvironment | null = null;
  let selectedCustomer: PlatformCustomer | null = null;
  if (selectedEnvId !== null) {
    outer: for (const c of customers) {
      for (const e of c.environments) {
        if (e.id === selectedEnvId) {
          selectedEnv = e;
          selectedCustomer = c;
          break outer;
        }
      }
    }
  }

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          eyebrow="Platform"
          title="Environment Recovery"
          description="Inspect every customer environment and execute audited recovery actions."
        />
      </div>

      {/* Live operation status panel — persists until dismissed */}
      {trackedOperation && (
        <OperationStatusPanel
          tracked={trackedOperation}
          onTerminal={handleOperationDismiss}
        />
      )}

      {customers.length === 0 ? (
        <EmptyState
          icon={Server}
          title="No customers"
          text="No customer environments are available. Create a customer workspace first."
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          {/* Left: environment selector */}
          <aside className="rounded-xl border border-border bg-card p-4" aria-label="Customer environment list">
            <p className="mono mb-3 text-[9px] font-bold uppercase tracking-[.18em] text-muted-foreground px-1">
              Customers &amp; Environments
            </p>
            <EnvironmentSelector
              customers={customers}
              selectedEnvId={selectedEnvId}
              onSelect={handleEnvSelect}
            />
          </aside>

          {/* Right: environment detail */}
          <div>
            {!selectedEnvId || !selectedEnv || !selectedCustomer ? (
              <div className="flex h-full min-h-[320px] items-center justify-center rounded-xl border border-border bg-card">
                <div className="text-center">
                  <Server size={32} className="mx-auto mb-3 text-muted-foreground/30" aria-hidden="true" />
                  <p className="text-sm font-semibold text-muted-foreground">Select an environment</p>
                  <p className="mt-1 text-xs text-muted-foreground">Choose a customer environment from the left to inspect its resources and take recovery actions.</p>
                </div>
              </div>
            ) : (
              <EnvironmentPanel
                envId={selectedEnvId}
                customer={selectedCustomer}
                env={selectedEnv}
                onAction={handleAction}
              />
            )}
          </div>
        </div>
      )}

      {pendingAction && (
        <ActionModal
          action={pendingAction}
          onClose={handleClose}
          onDone={handleDone}
          onOperationStarted={handleOperationStarted}
        />
      )}
    </div>
  );
}
