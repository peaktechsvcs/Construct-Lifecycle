import { useState, ReactNode } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, MapPin, FileText, ClipboardList, Receipt,
  PackageCheck, CalendarDays, Plus, Check, Activity as ActivityIcon,
} from 'lucide-react';
import {
  Project,
  useGetProject, getGetProjectQueryKey,
  useListProjectActivity, getListProjectActivityQueryKey,
  useCreateFollowUp, getListFollowUpsQueryKey, getGetDashboardSummaryQueryKey,
} from '@workspace/api-client-react';
import {
  Badge, Button, LoadingPanel, ErrorPanel, Modal, ActivityList,
  currency, shortDate, fullDate,
} from '@/components/app-ui';
import { stageLabels } from '@/lib/stage-config';
import { ProjectFormModal } from '@/components/project-form-modal';
import { useWorkflow, workflowStageColor } from '@/hooks/use-workflow';

// ─── Back navigation: respects ?return= drilldown URL ─────────────────────────

function BackNav() {
  const [location] = useLocation();
  const urlParams = new URLSearchParams(location.includes('?') ? location.split('?')[1] : '');
  const returnUrl = urlParams.get('return');

  if (returnUrl) {
    return (
      <Link
        href={returnUrl}
        data-testid="link-back-drilldown"
        className="mt-1 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
        aria-label="Back"
      >
        <ArrowLeft size={17} />
      </Link>
    );
  }

  return (
    <Link
      href="/projects"
      data-testid="link-back-projects"
      className="mt-1 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
      aria-label="Back to projects"
    >
      <ArrowLeft size={17} />
    </Link>
  );
}

function Lifecycle({ project }: { project: Project }) {
  const workflow = useWorkflow();
  const stages = workflow.states;
  const current = stages.findIndex((state) => state.stableKey === project.stage);

  return (
    <div className="rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Lifecycle</p>
          <h2 className="mt-1 text-lg font-bold">Move the job forward</h2>
        </div>
        <Badge tone={project.stage === 'financial' || project.stage === 'procure' ? 'violet' : project.stage === 'closeout' ? 'green' : 'teal'}>
          {workflow.labels[project.stage] ?? stageLabels[project.stage] ?? project.stage}
        </Badge>
      </div>
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[720px] grid-cols-8 gap-2">
        {stages.map((state, index) => (
          <div key={state.stableKey} className="relative">
            <div
              className={`mb-2 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                index <= current ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'
              }`}
            >
              {index < current ? <Check size={14} /> : index + 1}
            </div>
            <p className={`text-[10px] leading-4 ${index === current ? 'font-bold text-foreground' : index < current ? 'font-medium text-primary' : 'text-muted-foreground'}`}>
              {state.displayName}
            </p>
            {index < stages.length - 1 && (
              <span
                className={`absolute left-8 right-[-8px] top-4 h-px ${index < current ? 'bg-primary' : 'bg-border'}`}
              />
            )}
          </div>
        ))}
        </div>
      </div>
    </div>
  );
}

function DetailCard({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: typeof FileText;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-border bg-card p-5 md:p-6">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary">
            <Icon size={16} />
          </span>
          <h2 className="text-base font-bold">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function DetailRow({ label, value, mono = false }: { label: string; value?: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/70 py-2.5 last:border-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`max-w-[65%] text-right text-xs font-semibold ${mono ? 'mono' : ''}`}>{value || '—'}</span>
    </div>
  );
}

function FollowUpModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const create = useCreateFollowUp();
  const qc = useQueryClient();
  const [dueDate, setDueDate] = useState(project.nextFollowUp?.slice(0, 10) || '');
  const [note, setNote] = useState('');

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    create.mutate(
      { data: { projectId: project.id, dueDate, note } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListFollowUpsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
          onClose();
        },
      },
    );
  };

  return (
    <Modal title="Schedule a follow-up" onClose={onClose}>
      <form onSubmit={submit} className="space-y-5">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Due date</span>
          <input
            data-testid="input-followup-date-detail"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-primary/20"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">What should happen next?</span>
          <textarea
            data-testid="textarea-followup-note-detail"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            required
            rows={4}
            placeholder="e.g. Confirm revised material lead time with client"
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-primary/20"
          />
        </label>
        <div className="flex justify-end gap-3">
          <Button data-testid="button-cancel-followup-detail" type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            data-testid="button-save-followup-detail"
            type="submit"
            disabled={create.isPending || !dueDate || !note}
          >
            {create.isPending ? 'Scheduling…' : 'Schedule follow-up'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [showEdit, setShowEdit] = useState(false);
  const [showFollow, setShowFollow] = useState(false);

  const projectQuery = useGetProject(projectId, {
    query: { queryKey: getGetProjectQueryKey(projectId), enabled: Number.isFinite(projectId) },
  });
  const activityQuery = useListProjectActivity(projectId, {
    query: { queryKey: getListProjectActivityQueryKey(projectId), enabled: Number.isFinite(projectId) },
  });
  const project = projectQuery.data;
  const workflow = useWorkflow();

  if (projectQuery.isLoading) return <LoadingPanel lines={8} />;
  if (projectQuery.isError || !project) return <ErrorPanel onRetry={() => projectQuery.refetch()} />;

  return (
    <div className="animate-rise">
      <div className="mb-6 flex items-start gap-3">
        <BackNav />
        <div className="min-w-0 flex-1">
          <p className="mono text-[10px] uppercase tracking-[.15em] text-accent">
            {project.projectNumber} · {project.category}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-3xl font-bold tracking-[-.05em]">{project.projectName}</h1>
            <Badge tone={project.stage === 'financial' || project.stage === 'procure' ? 'violet' : project.stage === 'closeout' ? 'green' : 'teal'}>
              {workflow.labels[project.stage] ?? stageLabels[project.stage] ?? project.stage}
            </Badge>
          </div>
          <p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground">
            <MapPin size={14} />
             {project.address || 'Address not added'} · {project.businessCustomerId ? <Link href={`/customers/${project.businessCustomerId}`} className="font-semibold text-primary hover:underline">{project.customerName}</Link> : project.customerName}
          </p>
        </div>
        <Button data-testid="button-edit-project-detail" variant="outline" onClick={() => setShowEdit(true)}>
          <Pencil size={15} /> <span className="hidden sm:inline">Edit project</span>
        </Button>
      </div>

      <Lifecycle project={project} />

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.18fr_.82fr]">
        <div className="space-y-5">
          <DetailCard
            icon={FileText}
            title="Proposal & bid"
            action={
              <Badge tone={project.bidOutcome === 'won' ? 'green' : project.bidOutcome === 'lost' ? 'red' : 'orange'}>
                {project.bidOutcome.replace('_', ' ')}
              </Badge>
            }
          >
            <DetailRow label="Proposal status" value={project.proposalStatus.replace('_', ' ')} />
            <DetailRow label="Details" value={project.proposalDetails} />
            <DetailRow label="Requirements" value={project.requirementsSummary} />
          </DetailCard>

          <DetailCard
            icon={ClipboardList}
            title="Contract & delivery"
            action={
              <Badge tone={project.contractStatus === 'active' ? 'teal' : 'neutral'}>
                {project.contractStatus}
              </Badge>
            }
          >
            <div className="grid gap-x-8 md:grid-cols-2">
              <DetailRow label="Contract value" value={currency.format(project.contractValue)} mono />
              <DetailRow
                label="Contract window"
                value={`${shortDate(project.contractStart)} — ${shortDate(project.contractEnd)}`}
              />
              <DetailRow label="Delivery progress" value={`${project.deliveryPercent}%`} mono />
              <DetailRow label="Product mix" value={project.productCategories?.join(' · ')} />
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${project.deliveryPercent}%` }} />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {project.contractDetails || 'No contract notes added.'}
            </p>
          </DetailCard>

          <DetailCard
            icon={Receipt}
            title="Billing & collection"
            action={
              <Badge tone={project.billingStatus === 'paid' ? 'green' : 'violet'}>
                {project.billingStatus.replace('_', ' ')}
              </Badge>
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-lg bg-secondary/60 p-3">
                <p className="mono text-[9px] uppercase text-muted-foreground">Contract</p>
                <p className="mt-2 text-lg font-bold">{currency.format(project.contractValue)}</p>
              </div>
              <div className="rounded-lg bg-secondary/60 p-3">
                <p className="mono text-[9px] uppercase text-muted-foreground">Invoiced</p>
                <p className="mt-2 text-lg font-bold">{currency.format(project.invoicedAmount)}</p>
              </div>
              <div className="rounded-lg bg-primary/10 p-3">
                <p className="mono text-[9px] uppercase text-primary">Received</p>
                <p className="mt-2 text-lg font-bold text-primary">{currency.format(project.receivedAmount)}</p>
              </div>
            </div>
            <DetailRow label="Billing notes" value={project.billingDetails} />
          </DetailCard>

          <DetailCard
            icon={PackageCheck}
            title="Closeout"
            action={
              <Badge tone={project.closeoutStatus === 'complete' ? 'green' : 'orange'}>
                {project.closeoutStatus.replace('_', ' ')}
              </Badge>
            }
          >
            <DetailRow label="Closeout detail" value={project.closeoutDetails} />
            <DetailRow label="Last updated" value={fullDate(project.updatedAt)} />
          </DetailCard>
        </div>

        <div className="space-y-5">
          <DetailCard
            icon={CalendarDays}
            title="Next follow-up"
            action={
              <Button
                data-testid="button-add-followup-detail"
                variant="outline"
                className="px-2.5 py-1.5 text-xs"
                onClick={() => setShowFollow(true)}
              >
                <Plus size={13} /> Add
              </Button>
            }
          >
            <div className="rounded-lg border border-accent/25 bg-accent/8 p-4">
              <p className="mono text-[10px] uppercase tracking-[.12em] text-accent">
                {project.nextFollowUp ? shortDate(project.nextFollowUp) : 'Not scheduled'}
              </p>
              <p className="mt-2 text-sm font-semibold">
                {project.nextFollowUp ? 'Keep the next conversation warm.' : 'No follow-up is scheduled.'}
              </p>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                Create a reminder for the next decision, delivery check-in, or referral conversation.
              </p>
            </div>
          </DetailCard>

          <DetailCard icon={ActivityIcon} title="Project activity">
            <ActivityList items={activityQuery.data ?? []} />
          </DetailCard>
        </div>
      </div>

      {showEdit && <ProjectFormModal project={project} onClose={() => setShowEdit(false)} />}
      {showFollow && <FollowUpModal project={project} onClose={() => setShowFollow(false)} />}
    </div>
  );
}
