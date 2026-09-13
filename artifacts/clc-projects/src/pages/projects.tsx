import { useState, useMemo, useEffect } from 'react';
import { Link, useLocation } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Filter, BriefcaseBusiness, Pencil, Trash2 } from 'lucide-react';
import {
  Project, ProjectStage,
  useListProjects, getListProjectsQueryKey,
  useDeleteProject, getGetDashboardSummaryQueryKey,
  useListBusinessCustomers, getListBusinessCustomersQueryKey,
} from '@workspace/api-client-react';
import {
  PageTitle, Button, LoadingPanel, ErrorPanel, EmptyState,
  Badge, currency, shortDate,
} from '@/components/app-ui';
import { stageLabels } from '@/lib/stage-config';
import { ProjectFormModal } from '@/components/project-form-modal';
import { useWorkflow, workflowStageColor } from '@/hooks/use-workflow';
import { Input } from '@workspace/construct-lifecycle-design-system/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/construct-lifecycle-design-system/components/ui/select';

function stageBadgeTone(stage: string) {
  if (stage === 'financial') return 'violet' as const;
  if (stage === 'closeout') return 'green' as const;
  if (stage === 'procure') return 'violet' as const;
  return 'teal' as const;
}

function ProjectTable({
  projects,
  workflow,
  onEdit,
  onDelete,
}: {
  projects: Project[];
  workflow: ReturnType<typeof useWorkflow>;
  onEdit: (project: Project) => void;
  onDelete: (project: Project) => void;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="hidden grid-cols-[1.4fr_1fr_140px_130px_105px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">
        <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Project</span>
        <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Owner</span>
        <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Stage</span>
        <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Value</span>
        <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Updated</span>
        <span />
      </div>
      <div className="divide-y divide-border">
        {projects.map((project) => (
          <div
            key={project.id}
            data-testid={`row-project-${project.id}`}
            className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.4fr_1fr_140px_130px_105px_44px] md:items-center md:gap-4"
          >
            <Link href={`/projects/${project.id}`} data-testid={`link-project-${project.id}`} className="min-w-0">
              <div className="flex items-center gap-2">
                <span className={`h-2 w-2 shrink-0 rounded-full ${workflowStageColor(workflow.stateByKey.get(project.stage))}`} />
                <div className="min-w-0">
                  <p className="mono text-[10px] text-accent">{project.projectNumber}</p>
                  <p className="truncate text-sm font-bold">{project.projectName}</p>
                  <p className="truncate text-xs text-muted-foreground">{project.customerName} · {project.category}</p>
                </div>
              </div>
            </Link>
            <p className="hidden truncate text-xs text-muted-foreground md:block">{project.owner || 'Unassigned'}</p>
            <div>
              <Badge tone={stageBadgeTone(workflow.stateByKey.get(project.stage)?.normalizedCategory ?? project.stage)}>
                {workflow.labels[project.stage] ?? stageLabels[project.stage] ?? project.stage}
              </Badge>
            </div>
            <p className="mono text-sm font-medium">{currency.format(project.contractValue)}</p>
            <p className="hidden text-xs text-muted-foreground md:block">{shortDate(project.updatedAt)}</p>
            <div className="flex justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
              <button
                data-testid={`button-edit-project-${project.id}`}
                aria-label={`Edit ${project.projectName}`}
                className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onEdit(project)}
              >
                <Pencil size={15} />
              </button>
              <button
                data-testid={`button-delete-project-${project.id}`}
                aria-label={`Delete ${project.projectName}`}
                className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => onDelete(project)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Projects() {
  const [location, setLocation] = useLocation();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project>();

  // Persist search and stage in URL query state
  const urlParams = new URLSearchParams(location.includes('?') ? location.split('?')[1] : '');
  const urlSearch = urlParams.get('search') ?? '';
  const urlStage = urlParams.get('stage') ?? '';
  const urlCustomerId = Number(urlParams.get('customerId'));

  const [search, setSearch] = useState(urlSearch);
  const [stage, setStage] = useState(urlStage);

  // Sync to URL
  useEffect(() => {
    const base = location.split('?')[0];
    const next = new URLSearchParams();
    if (search) next.set('search', search);
    if (stage) next.set('stage', stage);
    if (urlParams.get('customerId')) next.set('customerId', urlParams.get('customerId')!);
    const qs = next.toString();
    const newPath = qs ? `${base}?${qs}` : base;
    // Only update if the query part actually changed to avoid loops
    const currentQs = location.includes('?') ? location.split('?')[1] : '';
    if (qs !== currentQs) {
      setLocation(newPath, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, stage]);

  const params = useMemo(
    () => ({ search: search || undefined, stage: stage ? (stage as ProjectStage) : undefined }),
    [search, stage],
  );
  const query = useListProjects(params, { query: { queryKey: getListProjectsQueryKey(params) } });
  const workflow = useWorkflow();
  const customerQuery = useListBusinessCustomers(undefined, { query: { queryKey: getListBusinessCustomersQueryKey() } });
  const deleteProject = useDeleteProject();
  const qc = useQueryClient();
  const projects = query.data ?? [];
  const initialCustomer = customerQuery.data?.find((customer) => customer.id === urlCustomerId);

  useEffect(() => {
    if (Number.isFinite(urlCustomerId) && urlCustomerId > 0 && initialCustomer) setShowForm(true);
  }, [urlCustomerId, initialCustomer]);

  const clear = () => {
    setSearch('');
    setStage('');
  };

  // Stage filter options in canonical lifecycle order
  const stageOptions = workflow.states.map((state) => ({
    value: state.stableKey,
    label: state.displayName,
  }));
  const handleDelete = (project: Project) => {
    if (!window.confirm(`Delete ${project.projectName}?`)) return;
    deleteProject.mutate(
      { projectId: project.id },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListProjectsQueryKey() });
          qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        },
      },
    );
  };

  return (
    <div className="animate-rise">
      <PageTitle
        eyebrow="Project book"
        title="Projects"
        description="Every opportunity, handoff, and dollar in one working view."
        action={
          <Button
            data-testid="button-new-project"
            onClick={() => {
              setEditing(undefined);
              setShowForm(true);
            }}
          >
            <Plus size={16} /> New project
          </Button>
        }
      />

      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
          <Input
            data-testid="input-search-projects"
            aria-label="Search projects"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search customer, project, or address"
            className="h-10 border-transparent bg-secondary/65 pl-9 focus:border-primary/30 focus:bg-background"
          />
        </label>
        <div className="relative md:w-60">
          <Filter size={15} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" />
          <Select value={stage || 'all'} onValueChange={(value) => setStage(value === 'all' ? '' : value)}>
            <SelectTrigger data-testid="select-filter-stage" className="h-10 border-transparent bg-secondary/65 pl-9 focus:border-primary/30 focus:bg-background">
              <SelectValue placeholder="All lifecycle stages" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All lifecycle stages</SelectItem>
              {stageOptions.map((opt) => <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        {(search || stage) && (
          <Button data-testid="button-clear-filters" variant="ghost" onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      {query.isLoading ? (
        <LoadingPanel lines={7} />
      ) : query.isError ? (
        <ErrorPanel onRetry={() => query.refetch()} />
      ) : deleteProject.isError ? (
        <ErrorPanel title="Project could not be deleted" text="The project may have changed or you may not have permission to delete it." onRetry={() => deleteProject.reset()} />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={BriefcaseBusiness}
          title="No projects match that view"
          text={
            search || stage
              ? 'Try a different search or clear your filters.'
              : 'Start your project book with the first live opportunity.'
          }
          action={
            <Button data-testid="button-empty-new-project" onClick={() => setShowForm(true)}>
              <Plus size={15} /> Add project
            </Button>
          }
        />
      ) : (
        <ProjectTable
          projects={projects}
          workflow={workflow}
          onEdit={(project) => { setEditing(project); setShowForm(true); }}
          onDelete={handleDelete}
        />
      )}

      {showForm && (
        <ProjectFormModal
          project={editing}
          initialCustomer={initialCustomer}
          onClose={() => {
            setShowForm(false);
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
