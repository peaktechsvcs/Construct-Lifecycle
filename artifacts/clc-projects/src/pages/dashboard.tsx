import { Link } from 'wouter';
import { Plus, ArrowRight, TrendingUp, Receipt, CalendarDays, BriefcaseBusiness, Activity as ActivityIcon, AlertTriangle } from 'lucide-react';
import {
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListRecentActivity, getListRecentActivityQueryKey,
  useListFollowUps, getListFollowUpsQueryKey,
  FollowUpStatus,
} from '@workspace/api-client-react';
import {
  currency, shortDate,
  PageTitle, LoadingPanel, ErrorPanel, EmptyState, ActivityList,
} from '@/components/app-ui';
import { stageLabels } from '@/lib/stage-config';
import { Badge } from '@/components/app-ui';
import { useWorkflow, workflowStageColor } from '@/hooks/use-workflow';

// ─── Clickable stat card with drilldown link ──────────────────────────────────

function DrillStatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = 'teal',
  href,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof TrendingUp;
  accent?: 'teal' | 'orange' | 'violet' | 'green';
  href: string;
}) {
  const color = {
    teal: 'bg-primary/10 text-primary',
    orange: 'bg-status-warning/10 text-status-warning',
    violet: 'bg-violet-500/10 text-violet-700',
    green: 'bg-status-success/10 text-status-success',
  }[accent];

  return (
    <Link
      href={href}
      data-testid={`stat-card-${label.toLowerCase().replace(/\s+/g, '-')}`}
      className="group block rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(var(--border))] transition-transform hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/40"
    >
      <div className="flex items-start justify-between">
        <span className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</span>
        <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}>
          <Icon size={16} />
        </span>
      </div>
      <p className="mt-5 text-2xl font-bold tracking-[-.05em]">{value}</p>
      <div className="mt-1 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{detail}</p>
        <ArrowRight
          size={13}
          className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
        />
      </div>
    </Link>
  );
}

export function Dashboard() {
  const summaryQuery = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const activityQuery = useListRecentActivity({ query: { queryKey: getListRecentActivityQueryKey(), staleTime: 60000 } });
  const followQuery = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey(), staleTime: 60000 } });
  const workflow = useWorkflow();

  const summary = summaryQuery.data;
  const activity = activityQuery.data ?? [];
  const followUps = followQuery.data?.filter((item) => item.status === FollowUpStatus.open).slice(0, 4) ?? [];
  const maxStage = Math.max(...(summary?.stageCounts.map((item) => item.count) ?? [1]), 1);

  const dateStr = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  if (summaryQuery.isLoading)
    return (
      <>
        <PageTitle
          eyebrow={dateStr}
          title="Good morning."
          description="Your operational view of every job, handoff, and dollar in motion."
        />
        <LoadingPanel lines={6} />
      </>
    );
  if (summaryQuery.isError) return <ErrorPanel onRetry={() => summaryQuery.refetch()} />;

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow={dateStr}
        title="Good morning."
        description="Your operational view of every job, handoff, and dollar in motion."
        action={
          <Link
            href="/projects"
            data-testid="link-dashboard-projects"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"
          >
            <Plus size={16} /> New project
          </Link>
        }
      />

      {/* KPI cards — all link to drilldowns */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DrillStatCard
          label="Active projects"
          value={String(summary?.activeProjects ?? 0)}
          detail="Across every open stage"
          icon={BriefcaseBusiness}
          href="/dashboard/drilldown/active-projects"
        />
        <DrillStatCard
          label="Pipeline value"
          value={currency.format(summary?.pipelineValue ?? 0)}
          detail={`${currency.format(summary?.awardedValue ?? 0)} awarded`}
          icon={TrendingUp}
          accent="orange"
          href="/dashboard/drilldown/pipeline-value?sort=value_desc"
        />
        <DrillStatCard
          label="Received to date"
          value={currency.format(summary?.receivedValue ?? 0)}
          detail={`${currency.format(summary?.invoicedValue ?? 0)} invoiced`}
          icon={Receipt}
          accent="green"
          href="/dashboard/drilldown/received-to-date"
        />
        <DrillStatCard
          label="Open follow-ups"
          value={String(summary?.openFollowUps ?? 0)}
          detail="Keep the next conversation warm"
          icon={CalendarDays}
          accent="violet"
          href="/dashboard/drilldown/open-follow-ups?sort=due_priority"
        />
      </section>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.9fr]">
        {/* Stage distribution — every stage is a link */}
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-6 flex items-start justify-between">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Work in motion</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight">Stage distribution</h2>
            </div>
            <Link
              href="/projects"
              data-testid="link-view-all-projects"
              className="text-xs font-bold text-primary hover:underline"
            >
              View all <ArrowRight className="ml-1 inline" size={13} />
            </Link>
          </div>

          <div className="space-y-3">
            {(summary?.stageCounts ?? [])
              .map((item) => (
                <Link
                  key={item.stage}
                  href={`/dashboard/drilldown/stage?stage=${item.stage}`}
                  data-testid={`stage-bar-${item.stage}`}
                  className="group grid grid-cols-[108px_1fr_52px] items-center gap-3 rounded-lg px-1 py-1 hover:bg-secondary/50 focus:outline-none focus:ring-2 focus:ring-primary/30"
                  aria-label={`View ${workflow.labels[item.stage] ?? stageLabels[item.stage] ?? item.stage} projects (${item.count})`}
                >
                  <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
                    {workflow.labels[item.stage] ?? stageLabels[item.stage] ?? item.stage}
                  </span>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className={`h-full rounded-full transition-all ${workflowStageColor(workflow.stateByKey.get(item.stage))}`}
                      style={{ width: `${Math.max((item.count / maxStage) * 100, 4)}%` }}
                    />
                  </div>
                  <span className="mono text-right text-xs font-medium">{item.count}</span>
                </Link>
              ))}
          </div>

          <div className="mt-7 grid grid-cols-3 gap-3 border-t border-border pt-5">
            <div>
              <p className="mono text-[10px] uppercase text-muted-foreground">Largest stage</p>
              <p className="mt-1 text-sm font-bold">
                {[...(summary?.stageCounts ?? [])].sort((a, b) => b.value - a.value)[0]
                  ? workflow.labels[[...(summary?.stageCounts ?? [])].sort((a, b) => b.value - a.value)[0].stage] ?? '—'
                  : '—'}
              </p>
            </div>
            <div>
              <p className="mono text-[10px] uppercase text-muted-foreground">Open value</p>
              <p className="mt-1 text-sm font-bold">{currency.format(summary?.pipelineValue ?? 0)}</p>
            </div>
            <div>
              <p className="mono text-[10px] uppercase text-muted-foreground">Collection rate</p>
              <p className="mt-1 text-sm font-bold">
                {summary?.invoicedValue ? `${Math.round((summary.receivedValue / summary.invoicedValue) * 100)}%` : '—'}
              </p>
            </div>
          </div>
        </section>

        {/* Follow-up queue */}
        <section className="grid-lines rounded-xl border border-border bg-secondary/55 p-5 md:p-6">
          <div className="flex items-start justify-between">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.13em] text-accent">Next conversations</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight">Follow-up queue</h2>
            </div>
            <Link
              href="/dashboard/drilldown/open-follow-ups?sort=due_priority"
              data-testid="link-dashboard-followups"
              className="rounded-lg bg-card p-2 text-muted-foreground hover:text-foreground"
              aria-label="View all follow-ups"
            >
              <ArrowRight size={16} />
            </Link>
          </div>
          <div className="mt-5 space-y-3">
            {followUps.length === 0 ? (
              <EmptyState icon={CalendarDays} title="No follow-ups due" text="New opportunities will appear here." />
            ) : (
              followUps.map((item) => (
                <Link
                  href={`/projects/${item.projectId}`}
                  key={item.id}
                  data-testid={`card-dashboard-followup-${item.id}`}
                  className="block rounded-lg border border-border/80 bg-card p-3 hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold">{item.customerName}</p>
                    <span className="mono shrink-0 text-[10px] text-accent">{shortDate(item.dueDate)}</span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.note}</p>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        {/* Projects needing a look — links to needs-attention drilldown */}
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Exceptions</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight">Projects needing a look</h2>
            </div>
            <Link
              href="/dashboard/drilldown/needs-attention"
              data-testid="link-dashboard-needs-attention"
              className="inline-flex items-center gap-1.5 rounded-lg border border-status-warning/30 bg-status-warning/8 px-3 py-1.5 text-xs font-bold text-status-warning hover:bg-status-warning/15"
            >
              <AlertTriangle size={13} />
              View all issues
            </Link>
          </div>
          <p className="mb-4 text-xs text-muted-foreground">
            Each item explains exactly why it needs attention. Click to investigate the underlying records.
          </p>
          <Link
            href="/dashboard/drilldown/needs-attention"
            data-testid="link-needs-attention-full"
            className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-border py-6 text-sm font-semibold text-muted-foreground hover:border-primary/30 hover:bg-secondary/40 hover:text-foreground"
          >
            <AlertTriangle size={16} />
            Open needs-attention view
          </Link>
        </section>

        {/* Recent activity */}
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-5 flex items-center justify-between">
            <div>
              <p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Team log</p>
              <h2 className="mt-1 text-lg font-bold tracking-tight">Recent activity</h2>
            </div>
            <ActivityIcon size={17} className="text-muted-foreground" />
          </div>
          <ActivityList items={activity.slice(0, 5)} compact />
        </section>
      </div>
    </div>
  );
}
