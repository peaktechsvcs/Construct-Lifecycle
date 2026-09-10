import { Link } from 'wouter';
import { Plus, ArrowRight, TrendingUp, Receipt, CalendarDays, BriefcaseBusiness, Activity as ActivityIcon } from 'lucide-react';
import { 
  useGetDashboardSummary, getGetDashboardSummaryQueryKey,
  useListProjects, getListProjectsQueryKey,
  useListRecentActivity, getListRecentActivityQueryKey,
  useListFollowUps, getListFollowUpsQueryKey,
  ProjectStage, FollowUpStatus 
} from '@workspace/api-client-react';
import { 
  currency, shortDate, stageLabels, stageColors, 
  PageTitle, LoadingPanel, ErrorPanel, StatCard, Badge, EmptyState, ActivityList 
} from '@/components/app-ui';

export function Dashboard() {
  const summaryQuery = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 60000 } });
  const activityQuery = useListRecentActivity({ query: { queryKey: getListRecentActivityQueryKey(), staleTime: 60000 } });
  const followQuery = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey(), staleTime: 60000 } });
  
  const summary = summaryQuery.data;
  const projects = projectsQuery.data ?? [];
  const activity = activityQuery.data ?? [];
  const followUps = followQuery.data?.filter((item) => item.status === FollowUpStatus.open).slice(0, 4) ?? [];
  const maxStage = Math.max(...(summary?.stageCounts.map((item) => item.count) ?? [1]), 1);
  
  const dateStr = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date());

  if (summaryQuery.isLoading) return <><PageTitle eyebrow={dateStr} title="Good morning." description="Your operational view of every job, handoff, and dollar in motion." /><LoadingPanel lines={6} /></>;
  if (summaryQuery.isError) return <ErrorPanel onRetry={() => summaryQuery.refetch()} />;
  
  return (
    <div className="animate-rise">
      <PageTitle eyebrow={dateStr} title="Good morning." description="Your operational view of every job, handoff, and dollar in motion." action={<Link href="/projects" data-testid="link-dashboard-projects" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"><Plus size={16} /> New project</Link>} />
      
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Active projects" value={String(summary?.activeProjects ?? 0)} detail="Across every open stage" icon={BriefcaseBusiness} />
        <StatCard label="Pipeline value" value={currency.format(summary?.pipelineValue ?? 0)} detail={`${currency.format(summary?.awardedValue ?? 0)} awarded`} icon={TrendingUp} accent="orange" />
        <StatCard label="Received to date" value={currency.format(summary?.receivedValue ?? 0)} detail={`${currency.format(summary?.invoicedValue ?? 0)} invoiced`} icon={Receipt} accent="green" />
        <StatCard label="Open follow-ups" value={String(summary?.openFollowUps ?? 0)} detail="Keep the next conversation warm" icon={CalendarDays} accent="violet" />
      </section>
      
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.9fr]">
        <section className="rounded-xl border border-border bg-card p-5 md:p-6">
          <div className="mb-6 flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Work in motion</p><h2 className="mt-1 text-lg font-bold tracking-tight">Stage distribution</h2></div><Link href="/projects" data-testid="link-view-all-projects" className="text-xs font-bold text-primary hover:underline">View all <ArrowRight className="ml-1 inline" size={13} /></Link></div>
          <div className="space-y-4">{(summary?.stageCounts ?? []).filter((item) => item.stage !== ProjectStage.lost).map((item) => <div key={item.stage} className="grid grid-cols-[100px_1fr_52px] items-center gap-3"><span className="text-xs font-medium text-muted-foreground">{stageLabels[item.stage]}</span><div className="h-2 overflow-hidden rounded-full bg-secondary"><div className={`h-full rounded-full ${stageColors[item.stage]}`} style={{ width: `${Math.max((item.count / maxStage) * 100, 4)}%` }} /></div><span className="mono text-right text-xs font-medium">{item.count}</span></div>)}</div>
          <div className="mt-7 grid grid-cols-3 gap-3 border-t border-border pt-5"><div><p className="mono text-[10px] uppercase text-muted-foreground">Largest stage</p><p className="mt-1 text-sm font-bold">{summary?.stageCounts.sort((a, b) => b.value - a.value)[0] ? stageLabels[summary.stageCounts.sort((a, b) => b.value - a.value)[0].stage] : '—'}</p></div><div><p className="mono text-[10px] uppercase text-muted-foreground">Open value</p><p className="mt-1 text-sm font-bold">{currency.format(summary?.pipelineValue ?? 0)}</p></div><div><p className="mono text-[10px] uppercase text-muted-foreground">Collection rate</p><p className="mt-1 text-sm font-bold">{summary?.invoicedValue ? `${Math.round((summary.receivedValue / summary.invoicedValue) * 100)}%` : '—'}</p></div></div>
        </section>
        
        <section className="grid-lines rounded-xl border border-border bg-secondary/55 p-5 md:p-6">
          <div className="flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-accent">Next conversations</p><h2 className="mt-1 text-lg font-bold tracking-tight">Follow-up queue</h2></div><Link href="/follow-ups" data-testid="link-dashboard-followups" className="rounded-lg bg-card p-2 text-muted-foreground hover:text-foreground"><ArrowRight size={16} /></Link></div>
          <div className="mt-5 space-y-3">{followUps.length === 0 ? <EmptyState icon={CalendarDays} title="No follow-ups due" text="New opportunities will appear here." /> : followUps.map((item) => <Link href={`/projects/${item.projectId}`} key={item.id} data-testid={`card-dashboard-followup-${item.id}`} className="block rounded-lg border border-border/80 bg-card p-3 hover:border-primary/40"><div className="flex items-center justify-between gap-2"><p className="truncate text-sm font-semibold">{item.customerName}</p><span className="mono shrink-0 text-[10px] text-accent">{shortDate(item.dueDate)}</span></div><p className="mt-1 truncate text-xs text-muted-foreground">{item.note}</p></Link>)}</div>
        </section>
      </div>
      
      <div className="mt-5 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <section className="rounded-xl border border-border bg-card p-5 md:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Current book</p><h2 className="mt-1 text-lg font-bold tracking-tight">Projects needing a look</h2></div><Link href="/projects" data-testid="link-dashboard-book" className="text-xs font-bold text-primary hover:underline">Open project book</Link></div>
          <div className="divide-y divide-border">{projects.slice(0, 5).map((project) => <Link href={`/projects/${project.id}`} key={project.id} data-testid={`row-dashboard-project-${project.id}`} className="flex items-center gap-3 py-3 first:pt-0 last:pb-0"><div className={`h-2 w-2 rounded-full ${stageColors[project.stage]}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">{project.projectName}</p><p className="truncate text-xs text-muted-foreground">{project.customerName} · {project.category}</p></div><div className="text-right"><p className="mono text-xs font-medium">{currency.format(project.contractValue)}</p><Badge tone={project.stage === 'billing' ? 'violet' : project.stage === 'closeout' ? 'green' : 'teal'}>{stageLabels[project.stage]}</Badge></div></Link>)}</div>
        </section>
        
        <section className="rounded-xl border border-border bg-card p-5 md:p-6"><div className="mb-5 flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Team log</p><h2 className="mt-1 text-lg font-bold tracking-tight">Recent activity</h2></div><ActivityIcon size={17} className="text-muted-foreground" /></div>
          <ActivityList items={activity.slice(0, 5)} compact />
        </section>
      </div>
    </div>
  );
}
