import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListPlatformReleasesQueryKey,
  getListTenantReleaseAssignmentsQueryKey,
  useApproveTenantRelease,
  useAssignPlatformRelease,
  useCreatePlatformRelease,
  useDeployPlatformRelease,
  useListPlatformReleases,
  useListTenantReleaseAssignments,
  useRejectTenantRelease,
  useValidateTenantRelease,
  type ApplicationArtifactMetadata,
  type ConfigurationArtifactMetadata,
  type EnvironmentReleaseAssignment,
  type PlatformRelease,
  type ReleaseAssignmentEvent,
  type TenantReleaseAssignment,
} from '@workspace/api-client-react';
import {
  ArrowRight,
  CheckCircle2,
  Clock3,
  Code2,
  Database,
  GitBranch,
  LockKeyhole,
  Rocket,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { useTenant } from '@/providers/tenant-provider';
import {
  Badge,
  Button,
  EmptyState,
  ErrorPanel,
  LoadingPanel,
  Modal,
  PageTitle,
  fullDate,
} from '@/components/app-ui';

type ReleaseType = 'security' | 'platform' | 'feature';
type ReleaseAssignment = EnvironmentReleaseAssignment;
type ReleaseRecord = PlatformRelease;
type CustomerReleaseRecord = {
  id: number;
  releaseType: PlatformRelease['releaseType'];
  status: PlatformRelease['status'];
  version: string;
  notes?: string | null;
  mandatory: boolean;
  appPayload: ApplicationArtifactMetadata;
  configPayload: ConfigurationArtifactMetadata;
  createdAt: string;
  updatedAt: string;
  createdByUserId?: number | null;
  assignments: ReleaseAssignment[];
  events: ReleaseAssignmentEvent[];
};

const inputClass =
  'w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-4 focus:ring-primary/20';

function statusTone(status: string): 'neutral' | 'teal' | 'orange' | 'green' | 'red' | 'violet' {
  if (status === 'approved' || status === 'mandatory' || status === 'deployed' || status === 'passed') return 'green';
  if (status === 'rejected' || status === 'failed') return 'red';
  if (status === 'pending' || status === 'draft') return 'orange';
  if (status === 'released') return 'teal';
  return 'neutral';
}

function TypeIcon({ type }: { type: ReleaseType }) {
  if (type === 'security') return <LockKeyhole size={15} />;
  if (type === 'platform') return <Code2 size={15} />;
  return <GitBranch size={15} />;
}

function actor(value?: string | number | null) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function ReleaseAudit({ release }: { release: ReleaseRecord }) {
  return (
    <div className="grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-3">
      <div>
        <p className="mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Created by</p>
        <p className="mt-1 font-semibold">{actor(release.createdByUserId)}</p>
        <p className="text-muted-foreground">{fullDate(release.createdAt)}</p>
      </div>
      <div>
        <p className="mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Last change</p>
        <p className="mt-1 font-semibold">{fullDate(release.updatedAt)}</p>
        <p className="text-muted-foreground">Server audit record</p>
      </div>
      <div>
        <p className="mono text-[9px] uppercase tracking-[.12em] text-muted-foreground">Promotion policy</p>
        <p className="mt-1 font-semibold">Versioned artifacts only</p>
        <p className="text-muted-foreground">Transactional data never promotes</p>
      </div>
    </div>
  );
}

function eventTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function ReleaseEventTimeline({ events }: { events: ReleaseAssignmentEvent[] }) {
  const orderedEvents = [...events].sort(
    (a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
  );
  if (orderedEvents.length === 0) {
    return <p className="text-xs text-muted-foreground">No release transitions have been recorded.</p>;
  }
  return (
    <div className="space-y-3">
      {orderedEvents.map((event) => (
        <div key={event.id} data-testid={`release-event-${event.id}`} className="flex gap-3">
          <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <p className="text-xs font-bold">{event.action.replace(/_/g, ' ')}</p>
              <p className="mono text-[10px] text-muted-foreground">{eventTimestamp(event.occurredAt)}</p>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              Actor {actor(event.actorUserId)}
              {event.fromStatus || event.toStatus
                ? ` · ${event.fromStatus || '—'} → ${event.toStatus || '—'}`
                : ''}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

export function PlatformReleases() {
  const { activeEnvironment, environments, isPlatformAdmin, activeRole, isLoading: tenantLoading } = useTenant();
  const qc = useQueryClient();
  const platformReleasesQuery = useListPlatformReleases({
    query: {
      queryKey: getListPlatformReleasesQueryKey(),
      enabled: !tenantLoading && isPlatformAdmin,
      staleTime: 30_000,
      refetchOnMount: true,
    },
  });
  const tenantAssignmentsQuery = useListTenantReleaseAssignments({
    query: {
      queryKey: getListTenantReleaseAssignmentsQueryKey(),
      enabled: !tenantLoading && !isPlatformAdmin,
      staleTime: 30_000,
      refetchOnMount: true,
    },
  });
  const createRelease = useCreatePlatformRelease();
  const assignRelease = useAssignPlatformRelease();
  const validateRelease = useValidateTenantRelease();
  const deployRelease = useDeployPlatformRelease();
  const approveRelease = useApproveTenantRelease();
  const rejectRelease = useRejectTenantRelease();
  const [showCreate, setShowCreate] = useState(false);
  const [selectedRelease, setSelectedRelease] = useState<ReleaseRecord | null>(null);
  const [releaseType, setReleaseType] = useState<ReleaseType>('feature');
  const [version, setVersion] = useState('');
  const [notes, setNotes] = useState('');
  const [appPayload, setAppPayload] = useState<ApplicationArtifactMetadata>({
    artifactName: '',
    artifactVersion: '',
    digest: '',
  });
  const [configPayload, setConfigPayload] = useState<ConfigurationArtifactMetadata>({
    configName: '',
    configVersion: '',
    digest: '',
  });
  const [mandatory, setMandatory] = useState(false);
  const [targetEnvironmentId, setTargetEnvironmentId] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  const releases = platformReleasesQuery.data ?? [];
  const customerAssignments = tenantAssignmentsQuery.data ?? [];
  const customerReleases: CustomerReleaseRecord[] = customerAssignments.map((assignment) => {
    return {
      id: assignment.release.id,
      releaseType: assignment.release.releaseType,
      status: assignment.release.status,
      version: assignment.release.version,
      notes: assignment.release.notes,
      mandatory: assignment.release.mandatory,
      appPayload: assignment.release.appPayload,
      configPayload: assignment.release.configPayload,
      assignments: [assignment],
      createdAt: assignment.release.createdAt || assignment.assignedAt,
      updatedAt: assignment.release.updatedAt || assignment.updatedAt,
      createdByUserId: null,
      events: assignment.events,
    };
  });
  const visibleReleases: ReleaseRecord[] = isPlatformAdmin ? releases : customerReleases;
  const targetEnvironment = useMemo(
    () => environments.find((environment) => String(environment.id) === targetEnvironmentId),
    [environments, targetEnvironmentId],
  );
  const currentEnvironmentIds = new Set(environments.map((environment) => environment.id));
  const selectedHasApprovedDtd = selectedRelease?.assignments?.some(
    (assignment) => currentEnvironmentIds.has(assignment.environmentId)
      && assignment.approvalStatus === 'approved'
      && assignment.validationStatus === 'validated'
      && assignment.deploymentStatus === 'deployed',
  ) ?? false;
  const targetCanBeAssigned = targetEnvironment?.kind === 'dtd'
    || (targetEnvironment?.kind === 'production'
      && (selectedRelease?.releaseType === 'feature' ? selectedHasApprovedDtd : selectedRelease?.mandatory === true));
  const isCustomerAdmin = activeRole === 'owner' || activeRole === 'admin';
  const canManage = isPlatformAdmin;
  const canApprove = !isPlatformAdmin && isCustomerAdmin;

  const refresh = () => {
    qc.invalidateQueries({ queryKey: getListPlatformReleasesQueryKey() });
    qc.invalidateQueries({ queryKey: getListTenantReleaseAssignmentsQueryKey() });
  };

  const runAction = (mutation: { mutate: Function }, args: unknown, close = false) => {
    setActionError(null);
    mutation.mutate(args, {
      onSuccess: () => {
        if (close) setSelectedRelease(null);
        refresh();
      },
      onError: (error: unknown) => setActionError(error instanceof Error ? error.message : 'The release action could not be completed.'),
    });
  };

  const submitCreate = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    runAction(createRelease, {
      data: {
        releaseType,
        version: version.trim(),
        notes: notes.trim() || undefined,
        appPayload,
        configPayload,
        mandatory: releaseType !== 'feature' && mandatory,
      },
    }, true);
    setVersion('');
    setNotes('');
    setAppPayload({ artifactName: '', artifactVersion: '', digest: '' });
    setConfigPayload({ configName: '', configVersion: '', digest: '' });
    setMandatory(false);
    setShowCreate(false);
  };

  const releasesQuery = isPlatformAdmin ? platformReleasesQuery : tenantAssignmentsQuery;
  if (tenantLoading || releasesQuery.isLoading) {
    return (
      <>
        <PageTitle eyebrow="Release safety" title="Platform releases" description="Move versioned application changes from Global D/T/D to customer production with an auditable gate." />
        <LoadingPanel lines={5} />
      </>
    );
  }

  if (releasesQuery.isError) {
    return (
      <>
        <PageTitle eyebrow="Release safety" title="Platform releases" description="Move versioned application changes from Global D/T/D to customer production with an auditable gate." />
        <ErrorPanel onRetry={() => releasesQuery.refetch()} />
      </>
    );
  }

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow={canManage ? 'Platform administration' : 'Customer release gate'}
        title="Release management"
        description={
          canManage
            ? 'Create, validate, assign, and deploy versioned security, platform, and feature releases.'
            : 'Review features validated in Customer D/T/D before they can reach this customer production environment.'
        }
        action={canManage ? <Button data-testid="button-open-create-release" onClick={() => setShowCreate(true)}><Rocket size={15} /> Create release</Button> : undefined}
      />

      <div className="mb-6 grid gap-3 md:grid-cols-3">
        <div className="rounded-xl border border-status-warning/25 bg-status-warning/8 p-4">
          <div className="flex items-center gap-2 text-status-warning"><ShieldCheck size={17} /><p className="text-xs font-bold">D/T/D safety gate</p></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Production deploys require a versioned artifact and a successful Customer D/T/D validation.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-primary"><GitBranch size={17} /><p className="text-xs font-bold">Mandatory releases</p></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Security and platform-critical changes may be marked mandatory and bypass customer approval.</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex items-center gap-2 text-muted-foreground"><Database size={17} /><p className="text-xs font-bold">Data boundary</p></div>
          <p className="mt-2 text-xs leading-5 text-muted-foreground">Transactional D/T/D data is never copied or promoted by this workflow.</p>
        </div>
      </div>

      {actionError && (
        <div role="alert" data-testid="status-release-action-error" className="mb-4 flex items-start gap-3 rounded-lg border border-destructive/25 bg-destructive/5 p-3 text-xs text-destructive">
          <XCircle size={16} className="mt-0.5 shrink-0" />
          <span>{actionError}</span>
        </div>
      )}

      {visibleReleases.length === 0 ? (
        <EmptyState icon={Rocket} title="No releases yet" text={canManage ? 'Create the first versioned release for the platform.' : 'There are no feature releases awaiting your approval.'} />
      ) : (
        <div className="space-y-4">
          {visibleReleases.map((release) => {
            const assignment = (release.assignments as ReleaseAssignment[] | undefined)?.find((item) => item.environmentId === activeEnvironment?.id);
            const status = assignment?.approvalStatus || release.status;
            const environmentName = environments.find((environment) => environment.id === assignment?.environmentId)?.name;
            const isFeaturePending = release.releaseType === 'feature' && assignment?.approvalStatus === 'pending';
            const sourceDtdReady = assignment?.sourceDtdAssignmentId
              ? release.assignments.some((candidate) => candidate.id === assignment.sourceDtdAssignmentId && candidate.validationStatus === 'validated' && candidate.approvalStatus === 'approved' && candidate.deploymentStatus === 'deployed')
              : release.assignments.some((candidate) => environments.some((environment) => environment.id === candidate.environmentId && environment.kind === 'dtd') && candidate.validationStatus === 'validated' && candidate.approvalStatus === 'approved' && candidate.deploymentStatus === 'deployed');
            return (
              <article key={release.id} data-testid={`card-release-${release.id}`} className="rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(var(--border))]">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="flex min-w-0 gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><TypeIcon type={release.releaseType} /></span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 data-testid={`text-release-version-${release.id}`} className="text-base font-bold">{release.version}</h2>
                        <Badge tone="violet">{release.releaseType}</Badge>
                        <Badge tone={statusTone(status)}>{status}</Badge>
                        {release.mandatory && <Badge tone="orange">mandatory</Badge>}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">{release.notes || 'No release notes supplied.'}</p>
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted-foreground">
                        {environmentName && <span className="inline-flex items-center gap-1"><ArrowRight size={11} /> {environmentName}</span>}
                        <span className="inline-flex items-center gap-1"><Clock3 size={11} /> Updated {fullDate(release.updatedAt)}</span>
                        <span>Actor: {actor(release.createdByUserId)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2">
                    <Button data-testid={`button-view-release-${release.id}`} variant="outline" onClick={() => setSelectedRelease(release)}>View audit</Button>
                    {canManage && assignment && (
                      <>
                        <Button data-testid={`button-deploy-release-${release.id}`} disabled={deployRelease.isPending || (activeEnvironment?.kind === 'production' && release.releaseType === 'feature' && (assignment.approvalStatus !== 'approved' || assignment.validationStatus !== 'validated' || !sourceDtdReady))} onClick={() => runAction(deployRelease, { releaseId: release.id, data: { environmentId: assignment.environmentId } })}><Rocket size={14} /> Deploy</Button>
                      </>
                    )}
                    {canApprove && release.releaseType === 'feature' && assignment?.validationStatus === 'pending' && assignment.deploymentStatus === 'deployed' && (
                      <Button data-testid={`button-validate-release-${release.id}`} variant="outline" disabled={validateRelease.isPending || !assignment.id} onClick={() => runAction(validateRelease, { assignmentId: assignment.id })}><ShieldCheck size={14} /> Validate D/T/D</Button>
                    )}
                    {canApprove && isFeaturePending && assignment?.validationStatus === 'validated' && (
                      <>
                        <Button data-testid={`button-approve-release-${release.id}`} title={assignment?.validationStatus === 'validated' ? 'Approve validated feature release' : 'Customer D/T/D validation is required before approval'} disabled={approveRelease.isPending || !assignment.id || assignment?.validationStatus !== 'validated'} onClick={() => runAction(approveRelease, { assignmentId: assignment.id })}><CheckCircle2 size={14} /> Approve</Button>
                        <Button data-testid={`button-reject-release-${release.id}`} variant="danger" disabled={rejectRelease.isPending} onClick={() => { setSelectedRelease(release); setRejectionReason(''); }}><XCircle size={14} /> Reject</Button>
                      </>
                    )}
                  </div>
                </div>
                {assignment && (
                  <div className="mt-5 grid gap-3 border-t border-border pt-4 text-xs sm:grid-cols-4">
                    <div><p className="text-muted-foreground">Assignment</p><p className="mt-1 font-semibold">{actor(assignment.assignedByUserId)}</p><p className="text-muted-foreground">{fullDate(assignment.assignedAt)}</p></div>
                    <div><p className="text-muted-foreground">D/T/D validation</p><p className="mt-1 font-semibold">{assignment.validationStatus || 'pending'}</p><p className="text-muted-foreground">{fullDate(assignment.validatedAt)}</p></div>
                    <div><p className="text-muted-foreground">Approval actor</p><p className="mt-1 font-semibold">{actor(assignment.approvedByUserId)}</p><p className="text-muted-foreground">{fullDate(assignment.approvedAt)}</p></div>
                    <div><p className="text-muted-foreground">Production</p><p className="mt-1 font-semibold">{assignment.deploymentStatus || 'not deployed'}</p><p className="text-muted-foreground">{fullDate(assignment.deployedAt)}</p></div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}

      {showCreate && (
        <Modal title="Create versioned release" onClose={() => setShowCreate(false)}>
          <form className="space-y-4" onSubmit={submitCreate}>
            <div className="rounded-lg border border-status-warning/25 bg-status-warning/8 p-3 text-xs leading-5 text-muted-foreground">
              Create only a versioned application/configuration artifact. Transactional D/T/D data cannot be promoted through this release record.
            </div>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Release type</span><select data-testid="select-release-type" value={releaseType} onChange={(event) => setReleaseType(event.target.value as ReleaseType)} className={inputClass}><option value="security">Security</option><option value="platform">Platform</option><option value="feature">Feature</option></select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Version</span><input data-testid="input-release-version" required pattern="[^\\s]+$" value={version} onChange={(event) => setVersion(event.target.value)} className={inputClass} placeholder="2025.04.1" /></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Release notes</span><textarea data-testid="input-release-notes" required value={notes} onChange={(event) => setNotes(event.target.value)} className={`${inputClass} min-h-24 resize-y`} placeholder="Describe the versioned application/configuration change." /></label>
            <div className="grid gap-4 md:grid-cols-2">
              <fieldset className="space-y-3 rounded-lg border border-border p-4">
                <legend className="px-1 text-xs font-bold">Application artifact metadata</legend>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Artifact name</span><input data-testid="input-release-artifact-name" required minLength={1} maxLength={160} value={appPayload.artifactName} onChange={(event) => setAppPayload({ ...appPayload, artifactName: event.target.value })} className={inputClass} placeholder="construct-lifecycle" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Artifact version</span><input data-testid="input-release-artifact-version" required minLength={1} maxLength={120} value={appPayload.artifactVersion} onChange={(event) => setAppPayload({ ...appPayload, artifactVersion: event.target.value })} className={inputClass} placeholder="2025.04.1" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Digest</span><input data-testid="input-release-artifact-digest" required pattern="[A-Za-z0-9:_./+=-]{8,256}" value={appPayload.digest} onChange={(event) => setAppPayload({ ...appPayload, digest: event.target.value })} className={inputClass} placeholder="sha256:…" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Source commit <span className="font-normal">(optional)</span></span><input data-testid="input-release-artifact-commit" maxLength={120} value={appPayload.sourceCommit || ''} onChange={(event) => setAppPayload({ ...appPayload, sourceCommit: event.target.value || undefined })} className={inputClass} /></label>
              </fieldset>
              <fieldset className="space-y-3 rounded-lg border border-border p-4">
                <legend className="px-1 text-xs font-bold">Configuration artifact metadata</legend>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Config name</span><input data-testid="input-release-config-name" required minLength={1} maxLength={160} value={configPayload.configName} onChange={(event) => setConfigPayload({ ...configPayload, configName: event.target.value })} className={inputClass} placeholder="platform-config" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Config version</span><input data-testid="input-release-config-version" required minLength={1} maxLength={120} value={configPayload.configVersion} onChange={(event) => setConfigPayload({ ...configPayload, configVersion: event.target.value })} className={inputClass} placeholder="2025.04.1" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Digest</span><input data-testid="input-release-config-digest" required pattern="[A-Za-z0-9:_./+=-]{8,256}" value={configPayload.digest} onChange={(event) => setConfigPayload({ ...configPayload, digest: event.target.value })} className={inputClass} placeholder="sha256:…" /></label>
                <label className="block"><span className="mb-1 block text-[11px] font-semibold text-muted-foreground">Schema version <span className="font-normal">(optional)</span></span><input data-testid="input-release-config-schema" maxLength={120} value={configPayload.schemaVersion || ''} onChange={(event) => setConfigPayload({ ...configPayload, schemaVersion: event.target.value || undefined })} className={inputClass} /></label>
              </fieldset>
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-border p-3"><input data-testid="input-release-mandatory" type="checkbox" disabled={releaseType === 'feature'} checked={mandatory && releaseType !== 'feature'} onChange={(event) => setMandatory(event.target.checked)} className="mt-0.5 h-4 w-4 accent-primary" /><span><span className="block text-sm font-semibold">Mandatory release</span><span className="mt-1 block text-xs text-muted-foreground">Use only for security or platform-critical changes. Mandatory releases can deploy without customer feature approval.</span></span></label>
            {createRelease.isError && <p role="alert" className="text-xs text-destructive">{createRelease.error instanceof Error ? createRelease.error.message : 'The release could not be created.'}</p>}
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button data-testid="button-submit-release" type="submit" disabled={createRelease.isPending}>{createRelease.isPending ? 'Creating…' : 'Create release'}</Button></div>
          </form>
        </Modal>
      )}

      {selectedRelease && (
        <Modal title={`${selectedRelease.version} audit trail`} onClose={() => setSelectedRelease(null)}>
          <div className="space-y-5">
            <div className="flex items-center gap-2"><TypeIcon type={selectedRelease.releaseType} /><p className="text-sm font-bold">{selectedRelease.releaseType} release</p><Badge tone={statusTone(selectedRelease.status)}>{selectedRelease.status}</Badge></div>
            <ReleaseAudit release={selectedRelease} />
            <section className="rounded-lg border border-border bg-background/70 p-4">
              <div className="mb-3 flex items-center gap-2">
                <Clock3 size={15} className="text-primary" />
                <h3 className="text-sm font-bold">Release and assignment timeline</h3>
              </div>
              <ReleaseEventTimeline events={[
                ...selectedRelease.events,
                ...selectedRelease.assignments.flatMap((assignment) => assignment.events),
              ].filter((event, index, all) => all.findIndex((candidate) => candidate.id === event.id) === index)} />
            </section>
            {canManage && !selectedRelease.assignments?.some((item) => item.environmentId === activeEnvironment?.id) && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
                <p className="text-sm font-bold">Assign to an environment</p>
                <p className="mt-1 text-xs text-muted-foreground">Assign the immutable release to D/T/D first. Production promotion is only available after validation and approval gates are satisfied.</p>
                <div className="mt-3 flex gap-2"><select data-testid="select-release-environment" value={targetEnvironmentId} onChange={(event) => setTargetEnvironmentId(event.target.value)} className={inputClass}><option value="">Choose environment</option>{environments.map((environment) => { const canAssign = environment.kind === 'dtd' || (environment.kind === 'production' && (selectedRelease.releaseType === 'feature' ? selectedHasApprovedDtd : selectedRelease.mandatory === true)); return <option key={environment.id} value={environment.id} disabled={!canAssign}>{environment.name} ({environment.kind === 'dtd' ? 'D/T/D' : 'Production'}){!canAssign && environment.kind === 'production' ? ' — gate incomplete' : ''}</option>; })}</select><Button data-testid="button-assign-release" disabled={!targetEnvironment || !targetCanBeAssigned || assignRelease.isPending} onClick={() => runAction(assignRelease, { releaseId: selectedRelease.id, data: { environmentId: Number(targetEnvironmentId) } }, true)}>Assign</Button></div>
              </div>
            )}
            {canApprove && selectedRelease.releaseType === 'feature' && selectedRelease.assignments?.[0]?.validationStatus === 'validated' && (
              <div className="rounded-lg border border-destructive/20 bg-destructive/5 p-4">
                <p className="text-sm font-bold">Reject feature release</p>
                <textarea data-testid="input-rejection-reason" required value={rejectionReason} onChange={(event) => setRejectionReason(event.target.value)} className={`${inputClass} mt-3 min-h-20`} placeholder="Explain what must change before approval." />
                <Button data-testid="button-submit-rejection" className="mt-3" variant="danger" disabled={!rejectionReason.trim() || rejectRelease.isPending || !selectedRelease.assignments?.[0]?.id} onClick={() => runAction(rejectRelease, { assignmentId: selectedRelease.assignments?.[0]?.id, data: { reason: rejectionReason.trim() } }, true)}>Confirm rejection</Button>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
