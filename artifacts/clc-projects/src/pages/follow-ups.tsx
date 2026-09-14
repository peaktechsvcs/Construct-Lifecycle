import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, CalendarDays, Plus, Check } from 'lucide-react';
import { 
  FollowUp, FollowUpUpdateStatus,
  useListFollowUps, getListFollowUpsQueryKey,
  useUpdateFollowUp, getGetDashboardSummaryQueryKey,
  useListProjects, getListProjectsQueryKey,
} from '@workspace/api-client-react';
import { PageTitle, LoadingPanel, ErrorPanel, EmptyState, Badge, Button, fullDate } from '@/components/app-ui';
import { Tabs, TabsList, TabsTrigger } from '@workspace/construct-lifecycle-design-system/components/ui/tabs';

export function FollowUps() {
  const query = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey() } });
  const projectsQuery = useListProjects(
    { scope: 'mine' },
    { query: { queryKey: getListProjectsQueryKey({ scope: 'mine' }) } },
  );
  const update = useUpdateFollowUp();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'completed'>('open');
  
  const items = (query.data ?? []).filter((item) => item.status === filter).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  
  const complete = (item: FollowUp) => {
    update.mutate(
      { followUpId: item.id, data: { status: FollowUpUpdateStatus.completed } }, 
      { onSuccess: () => { 
        qc.invalidateQueries({ queryKey: getListFollowUpsQueryKey() }); 
        qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); 
      } }
    );
  };
  
  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Future work" title="My Work" description="Projects assigned to you, alongside the follow-ups that keep work moving." action={<Link href="/projects" data-testid="link-followups-projects" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-secondary"><BriefcaseBusiness size={15} /> Browse projects</Link>} />

      <section aria-labelledby="my-work-projects" className="mb-8">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="mono text-[10px] uppercase tracking-[.14em] text-accent">Assigned projects</p>
            <h2 id="my-work-projects" className="mt-1 text-lg font-bold">Projects in your work queue</h2>
          </div>
          <span className="mono text-xs text-muted-foreground">{projectsQuery.data?.length ?? 0}</span>
        </div>
        {projectsQuery.isLoading ? <LoadingPanel lines={2} /> : projectsQuery.isError ? (
          <ErrorPanel title="Assigned projects could not be loaded" onRetry={() => projectsQuery.refetch()} />
        ) : projectsQuery.data?.length ? (
          <div className="grid gap-3 md:grid-cols-2">
            {projectsQuery.data.map((project) => (
              <Link
                key={project.id}
                href={`/projects/${project.id}`}
                data-testid={`link-my-work-project-${project.id}`}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/35 hover:bg-secondary/25"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="mono text-[10px] text-accent">{project.projectNumber}</p>
                    <p className="mt-1 truncate text-sm font-bold">{project.projectName}</p>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{project.customerName}</p>
                  </div>
                  <Badge tone="teal">{project.stage.replace(/_/g, ' ')}</Badge>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-border bg-card/60 px-4 py-5 text-sm text-muted-foreground">
            No projects are assigned to you yet.
          </div>
        )}
      </section>
      
      <Tabs value={filter} onValueChange={(value) => setFilter(value as 'open' | 'completed')} className="mb-5">
        <TabsList className="h-auto rounded-none border-b border-border bg-transparent p-0">
          <TabsTrigger data-testid="button-filter-open-followups" value="open" className="rounded-none border-b-2 border-transparent px-1 pb-3 font-bold data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            Open <span className="mono ml-1 text-[10px]">{query.data?.filter((item) => item.status === 'open').length ?? 0}</span>
          </TabsTrigger>
          <TabsTrigger data-testid="button-filter-completed-followups" value="completed" className="rounded-none border-b-2 border-transparent px-1 pb-3 font-bold data-[state=active]:border-accent data-[state=active]:bg-transparent data-[state=active]:shadow-none">
            Completed
          </TabsTrigger>
        </TabsList>
      </Tabs>
      
      {query.isLoading ? <LoadingPanel lines={6} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : items.length === 0 ? 
        <EmptyState icon={CalendarDays} title={filter === 'open' ? 'Your queue is clear' : 'No completed follow-ups yet'} text={filter === 'open' ? 'That is a good day. Add one from a project when the next conversation is known.' : 'Completed conversations will stay here as your operating history.'} action={<Link href="/projects" data-testid="link-empty-followups-projects" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground"><Plus size={15} /> Find a project</Link>} /> : 
        <div className="grid gap-3">
          {items.map((item) => { 
            const overdue = filter === 'open' && new Date(item.dueDate) < new Date(new Date().toDateString()); 
            return (
              <div key={item.id} data-testid={`card-followup-${item.id}`} className={`group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors md:flex-row md:items-center ${overdue ? 'border-accent/45' : 'border-border hover:border-primary/35'}`}>
                <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${overdue ? 'bg-accent/12 text-accent' : 'bg-primary/10 text-primary'}`}>
                  <CalendarDays size={19} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/projects/${item.projectId}`} data-testid={`link-followup-project-${item.id}`} className="font-bold hover:text-primary hover:underline">{item.projectName}</Link>
                    {overdue && <Badge tone="orange">Overdue</Badge>}
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.customerName}</p>
                  <p className="mt-3 text-sm">{item.note}</p>
                </div>
                <div className="flex shrink-0 items-center gap-4 md:flex-col md:items-end">
                  <div className="text-left md:text-right">
                    <p className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Due</p>
                    <p className={`mt-1 text-sm font-bold ${overdue ? 'text-accent' : ''}`}>{fullDate(item.dueDate)}</p>
                  </div>
                  {filter === 'open' && (
                    <Button data-testid={`button-complete-followup-${item.id}`} variant="outline" className="px-2.5 py-1.5 text-xs" disabled={update.isPending} onClick={() => complete(item)}>
                      <Check size={14} /> Complete
                    </Button>
                  )}
                </div>
              </div>
            ); 
          })}
        </div>
      }
    </div>
  );
}
