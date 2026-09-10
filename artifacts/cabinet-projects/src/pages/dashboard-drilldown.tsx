import { useState, useCallback, useEffect } from 'react';
import { useParams, useLocation, Link } from 'wouter';
import {
  ArrowLeft,
  Search,
  ChevronDown,
  ChevronUp,
  BriefcaseBusiness,
  AlertTriangle,
  CalendarDays,
  TrendingUp,
  Receipt,
  ExternalLink,
  type LucideIcon,
} from 'lucide-react';
import {
  useGetDashboardDrilldown,
  getGetDashboardDrilldownQueryKey,
  DashboardDrilldownType,
  DashboardDrilldownSort,
  ProjectStage,
  DashboardDrilldownProject,
  DashboardDrilldownFollowUp,
  DashboardDrilldownAttention,
  DashboardDrilldownFollowUpPriority,
  DashboardDrilldownAttentionSeverity,
} from '@workspace/api-client-react';
import {
  currency,
  shortDate,
  fullDate,
  LoadingPanel,
  ErrorPanel,
  EmptyState,
  Badge,
} from '@/components/app-ui';
import { stageLabels, stageColors } from '@/lib/stage-config';

// ─── URL query-state helpers ─────────────────────────────────────────────────

function useSearchParam(key: string): [string, (val: string) => void] {
  const [location, setLocation] = useLocation();
  const params = new URLSearchParams(location.includes('?') ? location.split('?')[1] : '');
  const value = params.get(key) ?? '';

  const setValue = useCallback(
    (val: string) => {
      const base = location.split('?')[0];
      const next = new URLSearchParams(location.includes('?') ? location.split('?')[1] : '');
      if (val) {
        next.set(key, val);
      } else {
        next.delete(key);
      }
      const qs = next.toString();
      setLocation(qs ? `${base}?${qs}` : base, { replace: true });
    },
    [key, location, setLocation],
  );

  return [value, setValue];
}

// ─── Type guards for drilldown types ────────────────────────────────────────

const VALID_TYPES: string[] = Object.values(DashboardDrilldownType);

function isValidDrilldownType(t: string): t is DashboardDrilldownType {
  return VALID_TYPES.includes(t);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function priorityLabel(p?: DashboardDrilldownFollowUpPriority) {
  if (p === DashboardDrilldownFollowUpPriority.overdue) return { label: 'Overdue', tone: 'red' as const };
  if (p === DashboardDrilldownFollowUpPriority.due_today) return { label: 'Due today', tone: 'orange' as const };
  return { label: 'Upcoming', tone: 'teal' as const };
}

function severityTone(s: DashboardDrilldownAttentionSeverity) {
  if (s === DashboardDrilldownAttentionSeverity.high) return 'red' as const;
  if (s === DashboardDrilldownAttentionSeverity.medium) return 'orange' as const;
  return 'neutral' as const;
}

function stageBadgeTone(stage: string) {
  if (stage === 'billing') return 'violet' as const;
  if (stage === 'closeout') return 'green' as const;
  if (stage === 'pre_construction') return 'violet' as const;
  return 'teal' as const;
}

// ─── SortControl ─────────────────────────────────────────────────────────────

type SortOption = { value: string; label: string };

function SortControl({
  value,
  options,
  onChange,
}: {
  value: string;
  options: SortOption[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <select
        data-testid="select-drilldown-sort"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none rounded-lg border border-border bg-card py-2 pl-3 pr-8 text-xs font-semibold outline-none focus:ring-2 focus:ring-primary/30"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={13} className="pointer-events-none absolute right-2.5 top-2.5 text-muted-foreground" />
    </div>
  );
}

// ─── Column header with sort indicator ───────────────────────────────────────

function ColHeader({ children, sorted }: { children: React.ReactNode; sorted?: 'asc' | 'desc' | false }) {
  return (
    <span className="mono inline-flex items-center gap-1 text-[9px] uppercase tracking-[.13em] text-muted-foreground">
      {children}
      {sorted === 'desc' && <ChevronDown size={10} />}
      {sorted === 'asc' && <ChevronUp size={10} />}
    </span>
  );
}

// ─── Projects table (active-projects / pipeline-value / stage) ───────────────

function ProjectsTable({
  projects,
  returnUrl,
  showReceived,
}: {
  projects: DashboardDrilldownProject[];
  returnUrl: string;
  showReceived?: boolean;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="px-4 py-3 text-left">
              <ColHeader>Project</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left md:table-cell">
              <ColHeader>Customer</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left lg:table-cell">
              <ColHeader>Stage</ColHeader>
            </th>
            <th className="px-4 py-3 text-right">
              <ColHeader>Value</ColHeader>
            </th>
            {showReceived && (
              <th className="hidden px-4 py-3 text-right lg:table-cell">
                <ColHeader>Received</ColHeader>
              </th>
            )}
            <th className="hidden px-4 py-3 text-left xl:table-cell">
              <ColHeader>Owner</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left xl:table-cell">
              <ColHeader>Start</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left xl:table-cell">
              <ColHeader>End</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-right xl:table-cell">
              <ColHeader>Progress</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left xl:table-cell">
              <ColHeader>Next action</ColHeader>
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {projects.map((p) => (
            <tr key={p.id} className="group transition-colors hover:bg-secondary/30">
              <td className="px-4 py-3">
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${stageColors[p.stage] ?? 'bg-status-neutral'}`} />
                  <div className="min-w-0">
                    <p className="mono text-[10px] text-muted-foreground">{p.projectNumber}</p>
                    <p className="truncate text-xs font-bold leading-4">{p.projectName}</p>
                    <p className="truncate text-[10px] text-muted-foreground md:hidden">{p.customerName}</p>
                  </div>
                </div>
              </td>
              <td className="hidden px-4 py-3 md:table-cell">
                <p className="truncate text-xs">{p.customerName}</p>
              </td>
              <td className="hidden px-4 py-3 lg:table-cell">
                <Badge tone={stageBadgeTone(p.stage)}>{stageLabels[p.stage] ?? p.stage}</Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <p className="mono text-xs font-semibold">{currency.format(p.contractValue)}</p>
              </td>
              {showReceived && (
                <td className="hidden px-4 py-3 text-right lg:table-cell">
                  <p className="mono text-xs">{currency.format(p.receivedAmount)}</p>
                </td>
              )}
              <td className="hidden px-4 py-3 xl:table-cell">
                <p className="truncate text-xs text-muted-foreground">{p.owner || '—'}</p>
              </td>
              <td className="hidden px-4 py-3 xl:table-cell">
                <p className="mono text-[10px] text-muted-foreground">{shortDate(p.contractStart)}</p>
              </td>
              <td className="hidden px-4 py-3 xl:table-cell">
                <p className="mono text-[10px] text-muted-foreground">{shortDate(p.contractEnd)}</p>
              </td>
              <td className="hidden px-4 py-3 text-right xl:table-cell">
                <p className="mono text-xs">{p.deliveryPercent != null ? `${p.deliveryPercent}%` : '—'}</p>
              </td>
              <td className="hidden max-w-[160px] px-4 py-3 xl:table-cell">
                <p className="truncate text-[10px] text-muted-foreground">{p.nextAction || '—'}</p>
              </td>
              <td className="px-4 py-3 text-right">
                <Link
                  href={`/projects/${p.id}?return=${encodeURIComponent(returnUrl)}`}
                  data-testid={`link-drilldown-project-${p.id}`}
                  className="inline-flex items-center gap-1 rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Open ${p.projectName}`}
                >
                  <ExternalLink size={13} />
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Follow-ups table ─────────────────────────────────────────────────────────

function FollowUpsTable({
  followups,
  returnUrl,
}: {
  followups: DashboardDrilldownFollowUp[];
  returnUrl: string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-card">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-secondary/40">
            <th className="px-4 py-3 text-left">
              <ColHeader>Follow-up</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left md:table-cell">
              <ColHeader>Project</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left lg:table-cell">
              <ColHeader>Customer</ColHeader>
            </th>
            <th className="px-4 py-3 text-left">
              <ColHeader>Due</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left md:table-cell">
              <ColHeader>Priority</ColHeader>
            </th>
            <th className="hidden px-4 py-3 text-left xl:table-cell">
              <ColHeader>Owner</ColHeader>
            </th>
            <th className="px-4 py-3" />
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {followups.map((f) => {
            const { label, tone } = priorityLabel(f.priority);
            return (
              <tr key={f.id} className="group transition-colors hover:bg-secondary/30">
                <td className="max-w-[220px] px-4 py-3">
                  <p className="truncate text-xs font-semibold">{f.note}</p>
                  <p className="truncate text-[10px] text-muted-foreground md:hidden">{f.projectName}</p>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <p className="truncate text-xs">{f.projectName}</p>
                </td>
                <td className="hidden px-4 py-3 lg:table-cell">
                  <p className="truncate text-xs text-muted-foreground">{f.customerName}</p>
                </td>
                <td className="px-4 py-3">
                  <p className="mono text-xs">{shortDate(f.dueDate)}</p>
                </td>
                <td className="hidden px-4 py-3 md:table-cell">
                  <Badge tone={tone}>{label}</Badge>
                </td>
                <td className="hidden px-4 py-3 xl:table-cell">
                  <p className="truncate text-xs text-muted-foreground">{f.owner || '—'}</p>
                </td>
                <td className="px-4 py-3 text-right">
                  <Link
                    href={`/projects/${f.projectId}?return=${encodeURIComponent(returnUrl)}`}
                    data-testid={`link-drilldown-followup-${f.id}`}
                    className="inline-flex items-center gap-1 rounded-md p-1.5 text-muted-foreground opacity-0 hover:bg-secondary hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                    aria-label={`Open project for ${f.projectName}`}
                  >
                    <ExternalLink size={13} />
                  </Link>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Attention table ──────────────────────────────────────────────────────────

function AttentionTable({
  items,
  returnUrl,
}: {
  items: DashboardDrilldownAttention[];
  returnUrl: string;
}) {
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div
          key={item.project.id}
          data-testid={`card-attention-${item.project.id}`}
          className="rounded-xl border border-border bg-card p-4"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Badge tone={severityTone(item.severity)}>
                  {item.severity.charAt(0).toUpperCase() + item.severity.slice(1)} severity
                </Badge>
                <span className="mono text-[10px] text-muted-foreground">{item.ageDays}d outstanding</span>
              </div>
              <p className="mono text-[10px] text-muted-foreground">{item.project.projectNumber}</p>
              <p className="text-sm font-bold">{item.project.projectName}</p>
              <p className="text-xs text-muted-foreground">{item.project.customerName}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {item.reasons.map((r, idx) => (
                  <span
                    key={idx}
                    className="rounded-md bg-status-danger/10 px-2 py-0.5 text-[10px] font-semibold text-status-danger"
                  >
                    {r}
                  </span>
                ))}
              </div>
            </div>
            <div className="shrink-0 space-y-2 sm:text-right">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                Recommended action
              </p>
              <p className="max-w-[240px] text-xs leading-5">{item.recommendedAction}</p>
              <div className="flex items-center gap-2 sm:justify-end">
                <span className="text-[10px] text-muted-foreground">Owner: {item.project.owner || '—'}</span>
                <Link
                  href={`/projects/${item.project.id}?return=${encodeURIComponent(returnUrl)}`}
                  data-testid={`link-attention-project-${item.project.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary px-2.5 py-1.5 text-xs font-semibold hover:bg-card"
                >
                  Open project <ExternalLink size={11} />
                </Link>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Received-to-date notice ──────────────────────────────────────────────────

function ReceivedNotice() {
  return (
    <div className="mb-4 rounded-lg border border-status-info/25 bg-status-info/5 px-4 py-3">
      <p className="text-xs leading-5 text-muted-foreground">
        <span className="font-semibold text-foreground">Data scope:</span> This view shows project-level received
        contribution totals. Individual payment transactions and invoice references are managed in the billing system
        and are not currently available at this level. Totals reconcile exactly to the dashboard Received to Date
        figure.
      </p>
    </div>
  );
}

// ─── Main drilldown page ──────────────────────────────────────────────────────

const SORT_OPTIONS: SortOption[] = [
  { value: DashboardDrilldownSort.value_desc, label: 'Value: high to low' },
  { value: DashboardDrilldownSort.value_asc, label: 'Value: low to high' },
  { value: DashboardDrilldownSort.updated_desc, label: 'Recently updated' },
  { value: DashboardDrilldownSort.due_priority, label: 'Due priority' },
];

const TYPE_ICONS: Record<string, LucideIcon> = {
  'active-projects': BriefcaseBusiness,
  'pipeline-value': TrendingUp,
  'received-to-date': Receipt,
  'open-follow-ups': CalendarDays,
  'needs-attention': AlertTriangle,
  stage: BriefcaseBusiness,
};

export function DashboardDrilldown() {
  const { type } = useParams<{ type: string }>();
  const [location] = useLocation();

  // URL query state
  const [search, setSearch] = useSearchParam('search');
  const [sort, setSort] = useSearchParam('sort');
  const [stage] = useSearchParam('stage');

  // Debounced search
  const [debouncedSearch, setDebouncedSearch] = useState(search);
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 350);
    return () => clearTimeout(t);
  }, [search]);

  const returnUrl = location;

  if (!type || !isValidDrilldownType(type)) {
    return (
      <div className="animate-rise">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/overview"
            data-testid="link-back-dashboard"
            className="rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
          >
            <ArrowLeft size={17} />
          </Link>
          <h1 className="text-2xl font-bold">Unknown drilldown type</h1>
        </div>
      </div>
    );
  }

  const effectiveSort = sort || (type === 'pipeline-value' ? DashboardDrilldownSort.value_desc : undefined);
  const params = {
    type: type as DashboardDrilldownType,
    stage: stage ? (stage as ProjectStage) : undefined,
    search: debouncedSearch || undefined,
    sort: effectiveSort ? (effectiveSort as DashboardDrilldownSort) : undefined,
  };

  const queryKey = getGetDashboardDrilldownQueryKey(params);
  const drillQuery = useGetDashboardDrilldown(params, {
    query: { queryKey },
  });

  const data = drillQuery.data;
  const Icon = TYPE_ICONS[type] ?? BriefcaseBusiness;

  const isFollowUps = type === 'open-follow-ups';
  const isAttention = type === 'needs-attention';
  const isReceived = type === 'received-to-date';

  const hasProjects = (data?.projects?.length ?? 0) > 0;
  const hasFollowUps = (data?.followups?.length ?? 0) > 0;
  const hasAttention = (data?.attention?.length ?? 0) > 0;
  const isEmpty = !drillQuery.isLoading && data && data.count === 0;

  const showSort = !isFollowUps && !isAttention;
  const showSearch = !isAttention;

  return (
    <div className="animate-rise">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <Link
            href="/overview"
            data-testid="link-back-dashboard"
            className="mt-1 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"
            aria-label="Back to dashboard"
          >
            <ArrowLeft size={17} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Icon size={16} />
              </span>
              <p className="mono text-[10px] uppercase tracking-[.13em] text-muted-foreground">Dashboard drilldown</p>
            </div>
            <h1 className="mt-1 text-2xl font-bold tracking-tight">
              {data?.title ?? (stage ? `${stageLabels[stage] ?? stage} projects` : 'Loading…')}
            </h1>
            {stage && (
              <div className="mt-1 flex items-center gap-2">
                <Badge tone={stageBadgeTone(stage)}>{stageLabels[stage] ?? stage}</Badge>
              </div>
            )}
          </div>
        </div>

        {/* Count + total summary */}
        {data && (
          <div className="flex shrink-0 flex-col items-end gap-1">
            <p className="mono text-xs text-muted-foreground">
              {data.count} {data.count === 1 ? 'record' : 'records'}
            </p>
            {data.total > 0 && !isFollowUps && !isAttention && (
              <p className="mono text-lg font-bold">{currency.format(data.total)}</p>
            )}
          </div>
        )}
      </div>

      {/* Received scope notice */}
      {isReceived && <ReceivedNotice />}

      {/* Controls bar */}
      {(showSearch || showSort) && (
        <div className="mb-4 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 sm:flex-row">
          {showSearch && (
            <label className="relative flex-1">
              <Search size={15} className="absolute left-3 top-2.5 text-muted-foreground" />
              <input
                data-testid="input-drilldown-search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search project or customer…"
                className="w-full rounded-lg border border-transparent bg-secondary/65 py-2 pl-9 pr-3 text-sm outline-none focus:border-primary/30 focus:bg-background"
              />
            </label>
          )}
          {showSort && (
            <SortControl
              value={effectiveSort ?? ''}
              options={SORT_OPTIONS}
              onChange={(v) => setSort(v)}
            />
          )}
        </div>
      )}

      {/* Loading */}
      {drillQuery.isLoading && <LoadingPanel lines={8} />}

      {/* Error */}
      {drillQuery.isError && <ErrorPanel onRetry={() => drillQuery.refetch()} />}

      {/* Empty */}
      {isEmpty && (
        <EmptyState
          icon={Icon}
          title="No records found"
          text={search ? 'Try a different search term.' : 'There are no records for this view right now.'}
        />
      )}

      {/* Projects table */}
      {!drillQuery.isLoading && !drillQuery.isError && hasProjects && (
        <>
          {isReceived && (
            <p className="mb-2 text-xs font-semibold text-muted-foreground">Project-level received contributions</p>
          )}
          <ProjectsTable
            projects={data!.projects!}
            returnUrl={returnUrl}
            showReceived={isReceived}
          />
          {/* Totals footer */}
          {data!.total > 0 && (
            <div className="mt-3 flex items-center justify-end gap-3 rounded-lg border border-border bg-secondary/40 px-4 py-2.5">
              <span className="text-xs text-muted-foreground">
                {isReceived ? 'Total received (project level)' : 'Total value'}
              </span>
              <span className="mono text-sm font-bold">{currency.format(data!.total)}</span>
            </div>
          )}
        </>
      )}

      {/* Follow-ups table */}
      {!drillQuery.isLoading && !drillQuery.isError && hasFollowUps && (
        <FollowUpsTable followups={data!.followups!} returnUrl={returnUrl} />
      )}

      {/* Attention cards */}
      {!drillQuery.isLoading && !drillQuery.isError && hasAttention && (
        <AttentionTable items={data!.attention!} returnUrl={returnUrl} />
      )}
    </div>
  );
}
