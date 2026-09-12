import { Check, MessageSquareText, Vote } from 'lucide-react';
import {
  getListFeatureFeedbackQueryKey,
  useListFeatureFeedback,
  useVoteForFeature,
} from '@workspace/api-client-react';
import { Badge, EmptyState, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
import { useQueryClient } from '@tanstack/react-query';

export function FeedbackPage() {
  const qc = useQueryClient();
  const feedback = useListFeatureFeedback({
    query: { queryKey: getListFeatureFeedbackQueryKey(), retry: false },
  });
  const vote = useVoteForFeature();

  if (feedback.isLoading) {
    return (
      <>
        <PageTitle eyebrow="Product feedback" title="Feature feedback" description="Help CLC decide what to develop next." />
        <LoadingPanel lines={5} />
      </>
    );
  }

  if (feedback.isError) return <ErrorPanel onRetry={() => feedback.refetch()} />;

  const items = [...(feedback.data ?? [])].sort((a, b) => b.voteCount - a.voteCount || a.label.localeCompare(b.label));
  const maxVotes = Math.max(...items.map((item) => item.voteCount), 1);

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Product feedback"
        title="Feature feedback"
        description="Vote for the next capability you want CLC to develop. You can change your vote at any time."
      />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-accent/25 bg-accent/5 p-4 text-sm">
        <MessageSquareText size={17} className="mt-0.5 shrink-0 text-accent" />
        <p className="leading-6 text-muted-foreground">Each person has one vote. The totals show demand across CLC customer workspaces and help guide the next development priority.</p>
      </div>
      {items.length === 0 ? (
        <EmptyState icon={MessageSquareText} title="No features are currently up for feedback" text="CLC will add the next roadmap poll when another capability is ready to preview." />
      ) : (
        <div className="space-y-3">
          {items.map((item, index) => (
            <section key={item.key} className={`rounded-xl border bg-card p-5 ${item.votedByCurrentUser ? 'border-primary/40 ring-1 ring-primary/15' : 'border-border'}`}>
              <div className="flex flex-wrap items-start gap-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
                  {item.votedByCurrentUser ? <Check size={17} /> : <Vote size={17} />}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold">{item.label}</h2>
                    {index === 0 && <Badge tone="orange">Leading request</Badge>}
                    {item.votedByCurrentUser && <Badge tone="green">Your vote</Badge>}
                  </div>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.description}</p>
                  <div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary" aria-label={`${item.voteCount} votes`}>
                    <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.max((item.voteCount / maxVotes) * 100, item.voteCount > 0 ? 8 : 0)}%` }} />
                  </div>
                  <p className="mono mt-2 text-[10px] uppercase tracking-[.12em] text-muted-foreground">{item.section} · {item.voteCount} {item.voteCount === 1 ? 'vote' : 'votes'}</p>
                </div>
                <button
                  type="button"
                  disabled={vote.isPending || item.votedByCurrentUser}
                  onClick={() => vote.mutate(
                    { data: { featureKey: item.key } },
                    { onSuccess: () => qc.invalidateQueries({ queryKey: getListFeatureFeedbackQueryKey() }) },
                  )}
                  className="inline-flex min-h-10 shrink-0 items-center gap-2 rounded-lg border border-primary/30 px-3 py-2 text-xs font-bold text-primary transition-colors hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
                >
                  {item.votedByCurrentUser ? <Check size={14} /> : <Vote size={14} />}
                  {item.votedByCurrentUser ? 'Voted' : 'Vote'}
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
      {vote.isError && <p role="alert" className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">Your vote could not be saved. Try again.</p>}
    </div>
  );
}