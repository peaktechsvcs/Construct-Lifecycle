import { useState } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { BriefcaseBusiness, CalendarDays, Plus, Check } from 'lucide-react';
import { 
  FollowUp, FollowUpUpdateStatus,
  useListFollowUps, getListFollowUpsQueryKey,
  useUpdateFollowUp, getGetDashboardSummaryQueryKey
} from '@workspace/api-client-react';
import { PageTitle, LoadingPanel, ErrorPanel, EmptyState, Badge, Button, fullDate } from '@/components/app-ui';

export function FollowUps() {
  const query = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey() } });
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
      <PageTitle eyebrow="Future work" title="Follow-ups" description="A deliberate queue for the conversations that turn good jobs into the next job." action={<Link href="/projects" data-testid="link-followups-projects" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-secondary"><BriefcaseBusiness size={15} /> Browse projects</Link>} />
      
      <div className="mb-5 flex items-center gap-2 border-b border-border">
        <button data-testid="button-filter-open-followups" onClick={() => setFilter('open')} className={`border-b-2 px-1 pb-3 text-sm font-bold ${filter === 'open' ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground'}`}>
          Open <span className="mono ml-1 text-[10px]">{query.data?.filter((item) => item.status === 'open').length ?? 0}</span>
        </button>
        <button data-testid="button-filter-completed-followups" onClick={() => setFilter('completed')} className={`border-b-2 px-1 pb-3 text-sm font-bold ${filter === 'completed' ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground'}`}>
          Completed
        </button>
      </div>
      
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
