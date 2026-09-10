import { useState, useMemo } from 'react';
import { Link } from 'wouter';
import { useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Filter, ChevronDown, BriefcaseBusiness, Pencil, Trash2 } from 'lucide-react';
import { 
  Project, ProjectStage, 
  useListProjects, getListProjectsQueryKey,
  useDeleteProject, getGetDashboardSummaryQueryKey 
} from '@workspace/api-client-react';
import { 
  PageTitle, Button, LoadingPanel, ErrorPanel, EmptyState, 
  Badge, currency, shortDate, stageLabels, stageColors 
} from '@/components/app-ui';
import { ProjectFormModal } from '@/components/project-form-modal';

export function Projects() {
  const [search, setSearch] = useState('');
  const [stage, setStage] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Project>();
  
  const params = useMemo(() => ({ search: search || undefined, stage: stage ? stage as ProjectStage : undefined }), [search, stage]);
  const query = useListProjects(params, { query: { queryKey: getListProjectsQueryKey(params) } });
  const deleteProject = useDeleteProject();
  const qc = useQueryClient();
  const projects = query.data ?? [];
  const clear = () => { setSearch(''); setStage(''); };
  
  return (
    <div className="animate-rise">
      <PageTitle eyebrow="Project book" title="Projects" description="Every opportunity, handoff, and dollar in one working view." action={<Button data-testid="button-new-project" onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={16} /> New project</Button>} />
      
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row">
        <label className="relative flex-1">
          <Search size={16} className="absolute left-3 top-3 text-muted-foreground" />
          <input data-testid="input-search-projects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, project, or address" className="w-full rounded-lg border border-transparent bg-secondary/65 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary/30 focus:bg-background" />
        </label>
        <div className="relative md:w-52">
          <Filter size={15} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" />
          <select data-testid="select-filter-stage" value={stage} onChange={(event) => setStage(event.target.value)} className="w-full appearance-none rounded-lg border border-transparent bg-secondary/65 py-2.5 pl-9 pr-8 text-sm outline-none focus:border-primary/30 focus:bg-background">
            <option value="">All stages</option>
            {Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground" />
        </div>
        {(search || stage) && <Button data-testid="button-clear-filters" variant="ghost" onClick={clear}>Clear</Button>}
      </div>
      
      {query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : projects.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No projects match that view" text={search || stage ? 'Try a different search or clear your filters.' : 'Start your project book with the first live opportunity.'} action={<Button data-testid="button-empty-new-project" onClick={() => setShowForm(true)}><Plus size={15} /> Add project</Button>} /> : 
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="hidden grid-cols-[1.4fr_1fr_130px_130px_105px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid">
            <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Project</span>
            <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Owner</span>
            <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Stage</span>
            <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Value</span>
            <span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Updated</span>
            <span />
          </div>
          <div className="divide-y divide-border">
            {projects.map((project) => (
              <div key={project.id} data-testid={`row-project-${project.id}`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.4fr_1fr_130px_130px_105px_44px] md:items-center md:gap-4">
                <Link href={`/projects/${project.id}`} data-testid={`link-project-${project.id}`} className="min-w-0">
                  <p className="mono text-[10px] text-accent">{project.projectNumber}</p>
                  <p className="truncate text-sm font-bold">{project.projectName}</p>
                  <p className="truncate text-xs text-muted-foreground">{project.customerName} · {project.category}</p>
                </Link>
                <p className="hidden truncate text-xs text-muted-foreground md:block">{project.owner || 'Unassigned'}</p>
                <div><Badge tone={project.stage === 'billing' ? 'violet' : project.stage === 'closeout' ? 'green' : 'teal'}>{stageLabels[project.stage]}</Badge></div>
                <p className="mono text-sm font-medium">{currency.format(project.contractValue)}</p>
                <p className="hidden text-xs text-muted-foreground md:block">{shortDate(project.updatedAt)}</p>
                <div className="flex justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
                  <button data-testid={`button-edit-project-${project.id}`} aria-label={`Edit ${project.projectName}`} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => { setEditing(project); setShowForm(true); }}><Pencil size={15} /></button>
                  <button data-testid={`button-delete-project-${project.id}`} aria-label={`Delete ${project.projectName}`} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${project.projectName}?`)) { deleteProject.mutate({ projectId: project.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } }); } }}><Trash2 size={15} /></button>
                </div>
              </div>
            ))}
          </div>
        </div>
      }
      
      {showForm && <ProjectFormModal project={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} />}
    </div>
  );
}
