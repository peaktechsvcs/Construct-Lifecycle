import { Megaphone, Rocket, ShieldCheck } from 'lucide-react';
import {
  getListFeatureFlagsQueryKey,
  useListFeatureFlags,
  useUpdateFeatureFlag,
} from '@workspace/api-client-react';
import { Badge, ErrorPanel, LoadingPanel, PageTitle } from '@/components/app-ui';
import { useQueryClient } from '@tanstack/react-query';

export function PlatformFeatures() {
  const qc = useQueryClient();
  const features = useListFeatureFlags({
    query: { queryKey: getListFeatureFlagsQueryKey(), retry: false },
  });
  const update = useUpdateFeatureFlag();

  if (features.isLoading) {
    return (
      <>
        <PageTitle eyebrow="Platform / Feature visibility" title="Feature visibility" description="Choose which upcoming capabilities tenants can see and advertise." />
        <LoadingPanel lines={7} />
      </>
    );
  }

  if (features.isError) return <ErrorPanel onRetry={() => features.refetch()} />;

  const groups = Array.from(new Set((features.data ?? []).map((feature) => feature.section)));

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Platform / Feature visibility"
        title="Feature visibility"
        description="Keep unfinished capabilities out of tenant navigation until CLC is ready to advertise them."
      />
      <div className="mb-6 flex items-start gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-sm">
        <Megaphone size={17} className="mt-0.5 shrink-0 text-primary" />
        <p className="leading-6 text-muted-foreground">
          Disabled features stay out of tenant menus and direct routes. Enabling one publishes its Coming soon page and adds it to the tenant sidebar.
        </p>
      </div>
      <div className="space-y-5">
        {groups.map((section) => (
          <section key={section} className="rounded-xl border border-border bg-card p-5">
            <div className="mb-4 flex items-center gap-3 border-b border-border pb-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><ShieldCheck size={16} /></span>
              <div>
                <h2 className="text-base font-bold">{section}</h2>
                <p className="text-xs text-muted-foreground">Upcoming capabilities in this area</p>
              </div>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {(features.data ?? []).filter((feature) => feature.section === section).map((feature) => (
                <div key={feature.key} className="flex items-start gap-3 rounded-lg border border-border bg-background p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold">{feature.label}</h3>
                      <Badge tone={feature.enabled ? 'green' : 'neutral'}>{feature.enabled ? 'Visible to tenants' : 'Hidden'}</Badge>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-muted-foreground">{feature.description}</p>
                    <p className="mono mt-2 text-[10px] text-muted-foreground/70">{feature.key}</p>
                  </div>
                  <label className="flex shrink-0 cursor-pointer items-center gap-2 text-xs font-semibold">
                    <input
                      type="checkbox"
                      checked={feature.enabled}
                      disabled={update.isPending}
                      aria-label={`${feature.enabled ? 'Hide' : 'Show'} ${feature.label} to tenants`}
                      onChange={() => update.mutate(
                        { featureKey: feature.key, data: { enabled: !feature.enabled } },
                        { onSuccess: () => qc.invalidateQueries({ queryKey: getListFeatureFlagsQueryKey() }) },
                      )}
                      className="h-4 w-4 accent-primary"
                    />
                    {feature.enabled ? 'On' : 'Off'}
                  </label>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
      {update.isError && (
        <p role="alert" className="mt-5 rounded-lg border border-destructive/25 bg-destructive/5 px-4 py-3 text-xs text-destructive">
          The feature visibility change could not be saved. Try again.
        </p>
      )}
      <div className="mt-6 flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-xs text-muted-foreground">
        <Rocket size={15} className="mt-0.5 shrink-0 text-accent" />
        <p>Feature controls advertise roadmap work only. A feature should remain disabled until its tenant-facing Coming soon experience is ready to show.</p>
      </div>
    </div>
  );
}