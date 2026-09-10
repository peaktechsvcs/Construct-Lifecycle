import { type ReactNode, useMemo, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import {
  Activity as ActivityIcon,
  ArrowRight,
  Bell,
  BriefcaseBusiness,
  CalendarDays,
  Check,
  ChevronDown,
  CircleAlert,
  ClipboardList,
  FileText,
  Filter,
  Hammer,
  LayoutDashboard,
  MapPin,
  Menu,
  PackageCheck,
  Pencil,
  Plus,
  Receipt,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  TrendingUp,
  X,
} from 'lucide-react';
import {
  BidOutcome,
  BillingStatus,
  CloseoutStatus,
  ContractStatus,
  FollowUpStatus,
  FollowUpUpdateStatus,
  getGetDashboardSummaryQueryKey,
  getGetProjectQueryKey,
  getListFollowUpsQueryKey,
  getListProjectActivityQueryKey,
  getListProjectsQueryKey,
  getListRecentActivityQueryKey,
  ProjectStage,
  ProposalStatus,
  useCreateFollowUp,
  useCreateProject,
  useDeleteProject,
  useGetDashboardSummary,
  useGetProject,
  useListFollowUps,
  useListProjectActivity,
  useListProjects,
  useListRecentActivity,
  useUpdateFollowUp,
  useUpdateProject,
  type Activity,
  type FollowUp,
  type Project,
  type ProjectInput,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import { Link, Route, Router as WouterRouter, Switch, useLocation, useParams } from 'wouter';

const queryClient = new QueryClient();

const stageLabels: Record<string, string> = {
  lead: 'Lead',
  proposal: 'Proposal',
  awarded: 'Awarded',
  contracted: 'Contracted',
  in_progress: 'In progress',
  billing: 'Billing',
  closeout: 'Closeout',
  follow_up: 'Follow-up',
  lost: 'Lost',
};

const stageColors: Record<string, string> = {
  lead: 'bg-slate-400',
  proposal: 'bg-amber-500',
  awarded: 'bg-orange-500',
  contracted: 'bg-teal-600',
  in_progress: 'bg-sky-600',
  billing: 'bg-violet-500',
  closeout: 'bg-emerald-600',
  follow_up: 'bg-rose-500',
  lost: 'bg-slate-300',
};

const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const shortDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
const fullDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';
const initials = (value?: string | null) => (value || 'PM').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase();

function Button({ children, className = '', variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm',
    outline: 'border border-border bg-card text-foreground hover:bg-secondary',
    ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
    danger: 'border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} />;
}

function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'orange' | 'green' | 'red' | 'violet' }) {
  const tones = {
    neutral: 'bg-secondary text-secondary-foreground',
    teal: 'bg-primary/10 text-primary',
    orange: 'bg-accent/12 text-accent',
    green: 'bg-emerald-500/12 text-emerald-700',
    red: 'bg-destructive/10 text-destructive',
    violet: 'bg-violet-500/12 text-violet-700',
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${tones[tone]}`}>{children}</span>;
}

function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
    <div>
      <p className="mono mb-2 text-[10px] font-medium uppercase tracking-[.18em] text-accent">{eyebrow}</p>
      <h1 className="text-3xl font-bold tracking-[-.04em] text-foreground md:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>;
}

function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/35 p-0 backdrop-blur-sm md:items-center md:p-6">
    <div className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-border bg-card shadow-2xl md:rounded-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-card/95 px-5 py-4 backdrop-blur md:px-7">
        <h2 className="text-lg font-bold tracking-tight">{title}</h2>
        <Button data-testid="button-close-modal" variant="ghost" className="h-9 w-9 p-0" onClick={onClose}><X size={18} /></Button>
      </div>
      <div className="p-5 md:p-7">{children}</div>
    </div>
  </div>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const nav = [
    { href: '/', label: 'Overview', icon: LayoutDashboard },
    { href: '/projects', label: 'Projects', icon: BriefcaseBusiness },
    { href: '/follow-ups', label: 'Follow-ups', icon: CalendarDays },
  ];
  return <div className="min-h-[100dvh] bg-background">
    <aside className={`fixed inset-y-0 left-0 z-40 w-[246px] -translate-x-full border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0 ${mobileOpen ? 'translate-x-0' : ''}`}>
      <div className="flex h-full flex-col">
        <div className="flex h-[86px] items-center border-b border-sidebar-border px-6">
          <Link href="/" className="flex items-center gap-3" data-testid="link-brand">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground"><Hammer size={19} /></span>
            <span><span className="block text-[15px] font-bold tracking-tight">Northline</span><span className="mono block text-[9px] uppercase tracking-[.2em] text-sidebar-foreground/55">Project desk</span></span>
          </Link>
        </div>
        <div className="px-4 pt-7">
          <p className="mono mb-3 px-3 text-[9px] uppercase tracking-[.18em] text-sidebar-foreground/45">Workspace</p>
          <nav className="space-y-1">
            {nav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} data-testid={`link-nav-${label.toLowerCase()}`} className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium ${location === href ? 'bg-sidebar-accent text-sidebar-foreground' : 'text-sidebar-foreground/65 hover:bg-sidebar-accent/55 hover:text-sidebar-foreground'}`}><Icon size={17} /><span>{label}</span>{label === 'Follow-ups' && <OpenFollowUpDot />}</Link>)}
          </nav>
        </div>
        <div className="mt-auto p-4">
          <div className="rounded-xl border border-sidebar-border bg-sidebar-accent/35 p-4">
            <div className="mb-3 flex items-center gap-2 text-accent"><Sparkles size={15} /><span className="mono text-[9px] uppercase tracking-[.14em]">Today's pulse</span></div>
            <p className="text-xs leading-5 text-sidebar-foreground/65">Keep proposals warm and cash moving. Your next handoff is never more than a click away.</p>
          </div>
          <div className="mt-4 flex items-center gap-3 border-t border-sidebar-border pt-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-xs font-bold text-accent-foreground">MC</div>
            <div className="min-w-0"><p className="truncate text-xs font-semibold">Morgan Cole</p><p className="text-[10px] text-sidebar-foreground/50">Operations lead</p></div>
            <Settings2 size={15} className="ml-auto text-sidebar-foreground/45" />
          </div>
        </div>
      </div>
    </aside>
    {mobileOpen && <button aria-label="Close menu" data-testid="button-close-menu" className="fixed inset-0 z-30 bg-foreground/25 md:hidden" onClick={() => setMobileOpen(false)} />}
    <main className="min-h-[100dvh] md:pl-[246px]">
      <header className="sticky top-0 z-20 flex h-[68px] items-center justify-between border-b border-border bg-background/90 px-4 backdrop-blur md:px-9">
        <div className="flex items-center gap-3"><Button data-testid="button-open-menu" variant="ghost" className="h-9 w-9 p-0 md:hidden" onClick={() => setMobileOpen(true)}><Menu size={19} /></Button><div className="hidden items-center gap-2 text-xs text-muted-foreground md:flex"><span>Northline Supply</span><span className="text-border">/</span><span className="font-semibold text-foreground">{location === '/' ? 'Overview' : location.includes('follow-ups') ? 'Follow-ups' : 'Projects'}</span></div></div>
        <div className="flex items-center gap-4"><div className="hidden text-right sm:block"><p className="text-xs font-semibold">Tuesday, June 18</p><p className="mono text-[9px] text-muted-foreground">7:42 AM · Pacific</p></div><button data-testid="button-notifications" className="relative rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><Bell size={18} /><span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-accent" /></button><div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">MC</div></div>
      </header>
      <div className="mx-auto max-w-[1500px] px-4 py-7 md:px-9 md:py-9">{children}</div>
    </main>
  </div>;
}

function OpenFollowUpDot() {
  const { data } = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey(), staleTime: 60000 } });
  const count = data?.filter((item) => item.status === FollowUpStatus.open).length ?? 0;
  return count > 0 ? <span className="mono ml-auto rounded-full bg-accent px-1.5 py-0.5 text-[9px] font-bold text-accent-foreground">{count}</span> : null;
}

function LoadingPanel({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-3 rounded-xl border border-border bg-card p-5">{Array.from({ length: lines }).map((_, index) => <div key={index} className={`skeleton h-4 rounded ${index === 0 ? 'w-1/3' : index === 1 ? 'w-4/5' : 'w-2/3'}`} />)}</div>;
}

function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-5"><div className="flex items-center gap-3"><CircleAlert size={19} className="text-destructive" /><div><p className="text-sm font-semibold">We couldn't load this view.</p><p className="text-xs text-muted-foreground">Try again in a moment.</p></div></div><Button data-testid="button-retry" variant="outline" onClick={onRetry}>Retry</Button></div>;
}

function StatCard({ label, value, detail, icon: Icon, accent = 'teal' }: { label: string; value: string; detail: string; icon: typeof TrendingUp; accent?: 'teal' | 'orange' | 'violet' | 'green' }) {
  const color = { teal: 'bg-primary/10 text-primary', orange: 'bg-accent/12 text-accent', violet: 'bg-violet-500/12 text-violet-700', green: 'bg-emerald-500/12 text-emerald-700' }[accent];
  return <div className="group rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(var(--border))] transition-transform hover:-translate-y-0.5">
    <div className="flex items-start justify-between"><span className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon size={16} /></span></div>
    <p className="mt-5 text-2xl font-bold tracking-[-.05em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p>
  </div>;
}

function Dashboard() {
  const summaryQuery = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const projectsQuery = useListProjects(undefined, { query: { queryKey: getListProjectsQueryKey(), staleTime: 60000 } });
  const activityQuery = useListRecentActivity({ query: { queryKey: getListRecentActivityQueryKey(), staleTime: 60000 } });
  const followQuery = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey(), staleTime: 60000 } });
  const summary = summaryQuery.data;
  const projects = projectsQuery.data ?? [];
  const activity = activityQuery.data ?? [];
  const followUps = followQuery.data?.filter((item) => item.status === FollowUpStatus.open).slice(0, 4) ?? [];
  const maxStage = Math.max(...(summary?.stageCounts.map((item) => item.count) ?? [1]), 1);
  if (summaryQuery.isLoading) return <><PageTitle eyebrow="Tuesday · June 18" title="Good morning, Morgan." description="Your operational view of every job, handoff, and dollar in motion." /><LoadingPanel lines={6} /></>;
  if (summaryQuery.isError) return <ErrorPanel onRetry={() => summaryQuery.refetch()} />;
  return <div className="animate-rise">
    <PageTitle eyebrow="Tuesday · June 18" title="Good morning, Morgan." description="Your operational view of every job, handoff, and dollar in motion." action={<Link href="/projects" data-testid="link-dashboard-projects" className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-primary-foreground shadow-sm hover:opacity-90"><Plus size={16} /> New project</Link>} />
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
      <section className="grid-lines rounded-xl border border-border bg-secondary/55 p-5 md:p-6"><div className="flex items-start justify-between"><div><p className="mono text-[10px] uppercase tracking-[.13em] text-accent">Next conversations</p><h2 className="mt-1 text-lg font-bold tracking-tight">Follow-up queue</h2></div><Link href="/follow-ups" data-testid="link-dashboard-followups" className="rounded-lg bg-card p-2 text-muted-foreground hover:text-foreground"><ArrowRight size={16} /></Link></div>
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
  </div>;
}

function EmptyState({ icon: Icon, title, text, action }: { icon: typeof CalendarDays; title: string; text: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 py-9 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Icon size={18} /></span><p className="text-sm font-bold">{title}</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">{text}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

function ActivityList({ items, compact = false }: { items: Activity[]; compact?: boolean }) {
  if (items.length === 0) return <EmptyState icon={ActivityIcon} title="No activity yet" text="Updates will land here as your team moves work forward." />;
  return <div className="space-y-4">{items.map((item, index) => <div key={item.id} data-testid={`activity-${item.id}`} className="relative flex gap-3">{index < items.length - 1 && <span className="absolute left-[9px] top-6 h-[calc(100%+8px)] w-px bg-border" />}<span className="relative mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary/15 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /></span><div className="min-w-0"><p className="text-xs leading-5"><span className="font-bold">{item.action}</span> <span className="text-muted-foreground">{item.description}</span></p><p className="mono mt-1 text-[9px] uppercase tracking-[.07em] text-muted-foreground">{item.actor || 'Northline team'} · {compact ? shortDate(item.createdAt) : fullDate(item.createdAt)}</p></div></div>)}</div>;
}

type ProjectForm = {
  customerName: string; projectName: string; address: string; category: string; productCategories: string; owner: string;
  stage: string; proposalStatus: string; proposalDetails: string; bidOutcome: string; contractStatus: string; contractValue: string;
  contractDetails: string; contractStart: string; contractEnd: string; deliveryPercent: string; requirementsSummary: string;
  billingStatus: string; invoicedAmount: string; receivedAmount: string; billingDetails: string; closeoutStatus: string; closeoutDetails: string; nextFollowUp: string;
};

const emptyProjectForm: ProjectForm = { customerName: '', projectName: '', address: '', category: 'Residential', productCategories: '', owner: '', stage: 'lead', proposalStatus: 'not_started', proposalDetails: '', bidOutcome: 'pending', contractStatus: 'none', contractValue: '0', contractDetails: '', contractStart: '', contractEnd: '', deliveryPercent: '0', requirementsSummary: '', billingStatus: 'not_started', invoicedAmount: '0', receivedAmount: '0', billingDetails: '', closeoutStatus: 'not_started', closeoutDetails: '', nextFollowUp: '' };
const formFromProject = (project: Project): ProjectForm => ({ customerName: project.customerName, projectName: project.projectName, address: project.address || '', category: project.category, productCategories: project.productCategories?.join(', ') || '', owner: project.owner || '', stage: project.stage, proposalStatus: project.proposalStatus, proposalDetails: project.proposalDetails || '', bidOutcome: project.bidOutcome, contractStatus: project.contractStatus, contractValue: String(project.contractValue ?? 0), contractDetails: project.contractDetails || '', contractStart: project.contractStart?.slice(0, 10) || '', contractEnd: project.contractEnd?.slice(0, 10) || '', deliveryPercent: String(project.deliveryPercent ?? 0), requirementsSummary: project.requirementsSummary || '', billingStatus: project.billingStatus, invoicedAmount: String(project.invoicedAmount ?? 0), receivedAmount: String(project.receivedAmount ?? 0), billingDetails: project.billingDetails || '', closeoutStatus: project.closeoutStatus, closeoutDetails: project.closeoutDetails || '', nextFollowUp: project.nextFollowUp?.slice(0, 10) || '' });
const projectPayload = (form: ProjectForm): ProjectInput => ({ customerName: form.customerName, projectName: form.projectName, address: form.address || undefined, category: form.category, productCategories: form.productCategories.split(',').map((item) => item.trim()).filter(Boolean), owner: form.owner || undefined, stage: form.stage as ProjectStage, proposalStatus: form.proposalStatus as ProposalStatus, proposalDetails: form.proposalDetails || undefined, bidOutcome: form.bidOutcome as BidOutcome, contractStatus: form.contractStatus as ContractStatus, contractValue: Number(form.contractValue) || 0, contractDetails: form.contractDetails || undefined, contractStart: form.contractStart || undefined, contractEnd: form.contractEnd || undefined, deliveryPercent: Math.min(100, Math.max(0, Number(form.deliveryPercent) || 0)), requirementsSummary: form.requirementsSummary || undefined, billingStatus: form.billingStatus as BillingStatus, invoicedAmount: Number(form.invoicedAmount) || 0, receivedAmount: Number(form.receivedAmount) || 0, billingDetails: form.billingDetails || undefined, closeoutStatus: form.closeoutStatus as CloseoutStatus, closeoutDetails: form.closeoutDetails || undefined, nextFollowUp: form.nextFollowUp || undefined });

function ProjectFormModal({ project, onClose }: { project?: Project; onClose: () => void }) {
  const [form, setForm] = useState<ProjectForm>(project ? formFromProject(project) : emptyProjectForm);
  const create = useCreateProject();
  const update = useUpdateProject();
  const qc = useQueryClient();
  const set = (key: keyof ProjectForm, value: string) => setForm((current) => ({ ...current, [key]: value }));
  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const data = projectPayload(form);
    if (project) update.mutate({ projectId: project.id, data }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetProjectQueryKey(project.id) }); onClose(); } });
    else create.mutate({ data }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); onClose(); } });
  };
  const pending = create.isPending || update.isPending;
  const input = (key: keyof ProjectForm, label: string, type = 'text', placeholder = '') => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span><input data-testid={`input-project-${key}`} type={type} value={form[key]} placeholder={placeholder} onChange={(event) => set(key, event.target.value)} className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none ring-primary/20 placeholder:text-muted-foreground/55 focus:ring-4" /></label>;
  const select = (key: keyof ProjectForm, label: string, options: { value: string; label: string }[]) => <label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span><div className="relative"><select data-testid={`select-project-${key}`} value={form[key]} onChange={(event) => set(key, event.target.value)} className="w-full appearance-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-primary/20">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground" /></div></label>;
  return <Modal title={project ? `Edit ${project.projectNumber}` : 'Create a new project'} onClose={onClose}><form onSubmit={submit} className="space-y-6">
    <div className="grid gap-4 md:grid-cols-2">{input('customerName', 'Customer name', 'text', 'e.g. Avery & Co.')}{input('projectName', 'Project name', 'text', 'e.g. Pacific Heights kitchen')}{input('address', 'Jobsite address', 'text', 'Street, city, state')}{input('owner', 'Project owner', 'text', 'Assign a teammate')}</div>
    <div className="grid gap-4 md:grid-cols-2">{input('category', 'Category', 'text', 'Residential or commercial')}{input('productCategories', 'Product categories', 'text', 'Cabinetry, surfaces, hardware')}</div>
    <div className="ink-rule pt-5"><p className="mb-4 text-sm font-bold">Lifecycle & value</p><div className="grid gap-4 md:grid-cols-3">{select('stage', 'Current stage', Object.entries(stageLabels).map(([value, label]) => ({ value, label })))}{select('proposalStatus', 'Proposal status', Object.entries(ProposalStatus).map(([value, label]) => ({ value, label: label.replace('_', ' ') })))}{select('bidOutcome', 'Bid outcome', Object.entries(BidOutcome).map(([value, label]) => ({ value, label: label.replace('_', ' ') })))}{select('contractStatus', 'Contract status', Object.entries(ContractStatus).map(([value, label]) => ({ value, label: label.replace('_', ' ') })))}{input('contractValue', 'Contract value', 'number')}{input('deliveryPercent', 'Delivery progress %', 'number')}</div></div>
    <div className="grid gap-4 md:grid-cols-2">{input('contractStart', 'Contract start', 'date')}{input('contractEnd', 'Contract end', 'date')}{select('billingStatus', 'Billing status', Object.entries(BillingStatus).map(([value, label]) => ({ value, label: label.replace('_', ' ') })))}{select('closeoutStatus', 'Closeout status', Object.entries(CloseoutStatus).map(([value, label]) => ({ value, label: label.replace('_', ' ') })))}{input('invoicedAmount', 'Invoiced amount', 'number')}{input('receivedAmount', 'Received amount', 'number')}</div>
    <div className="grid gap-4 md:grid-cols-2">{input('nextFollowUp', 'Next follow-up', 'date')}{input('proposalDetails', 'Proposal notes', 'text', 'Scope, exclusions, decision context')}{input('requirementsSummary', 'Requirements summary', 'text', 'Materials, measurements, lead times')}{input('billingDetails', 'Billing notes', 'text', 'Deposit, invoice timing, terms')}</div>
    <div className="flex justify-end gap-3 border-t border-border pt-5"><Button data-testid="button-cancel-project" type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-save-project" type="submit" disabled={pending || !form.customerName || !form.projectName}>{pending ? 'Saving…' : project ? 'Save changes' : 'Create project'}</Button></div>
  </form></Modal>;
}

function Projects() {
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
  return <div className="animate-rise"><PageTitle eyebrow="Project book" title="Projects" description="Every opportunity, handoff, and dollar in one working view." action={<Button data-testid="button-new-project" onClick={() => { setEditing(undefined); setShowForm(true); }}><Plus size={16} /> New project</Button>} />
    <div className="mb-5 flex flex-col gap-3 rounded-xl border border-border bg-card p-3 md:flex-row"><label className="relative flex-1"><Search size={16} className="absolute left-3 top-3 text-muted-foreground" /><input data-testid="input-search-projects" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customer, project, or address" className="w-full rounded-lg border border-transparent bg-secondary/65 py-2.5 pl-9 pr-3 text-sm outline-none focus:border-primary/30 focus:bg-background" /></label><div className="relative md:w-52"><Filter size={15} className="pointer-events-none absolute left-3 top-3.5 text-muted-foreground" /><select data-testid="select-filter-stage" value={stage} onChange={(event) => setStage(event.target.value)} className="w-full appearance-none rounded-lg border border-transparent bg-secondary/65 py-2.5 pl-9 pr-8 text-sm outline-none focus:border-primary/30 focus:bg-background"><option value="">All stages</option>{Object.entries(stageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-muted-foreground" /></div>{(search || stage) && <Button data-testid="button-clear-filters" variant="ghost" onClick={clear}>Clear</Button>}</div>
    {query.isLoading ? <LoadingPanel lines={7} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : projects.length === 0 ? <EmptyState icon={BriefcaseBusiness} title="No projects match that view" text={search || stage ? 'Try a different search or clear your filters.' : 'Start your project book with the first live opportunity.'} action={<Button data-testid="button-empty-new-project" onClick={() => setShowForm(true)}><Plus size={15} /> Add project</Button>} /> : <div className="overflow-hidden rounded-xl border border-border bg-card"><div className="hidden grid-cols-[1.4fr_1fr_130px_130px_105px_44px] gap-4 border-b border-border bg-secondary/45 px-5 py-3 md:grid"><span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Project</span><span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Owner</span><span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Stage</span><span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Value</span><span className="mono text-[9px] uppercase tracking-[.13em] text-muted-foreground">Updated</span><span /></div><div className="divide-y divide-border">{projects.map((project) => <div key={project.id} data-testid={`row-project-${project.id}`} className="group grid gap-3 px-5 py-4 transition-colors hover:bg-secondary/35 md:grid-cols-[1.4fr_1fr_130px_130px_105px_44px] md:items-center md:gap-4"><Link href={`/projects/${project.id}`} data-testid={`link-project-${project.id}`} className="min-w-0"><p className="mono text-[10px] text-accent">{project.projectNumber}</p><p className="truncate text-sm font-bold">{project.projectName}</p><p className="truncate text-xs text-muted-foreground">{project.customerName} · {project.category}</p></Link><p className="hidden truncate text-xs text-muted-foreground md:block">{project.owner || 'Unassigned'}</p><div><Badge tone={project.stage === 'billing' ? 'violet' : project.stage === 'closeout' ? 'green' : 'teal'}>{stageLabels[project.stage]}</Badge></div><p className="mono text-sm font-medium">{currency.format(project.contractValue)}</p><p className="hidden text-xs text-muted-foreground md:block">{shortDate(project.updatedAt)}</p><div className="flex justify-end gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100"><button data-testid={`button-edit-project-${project.id}`} aria-label={`Edit ${project.projectName}`} className="rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground" onClick={() => { setEditing(project); setShowForm(true); }}><Pencil size={15} /></button><button data-testid={`button-delete-project-${project.id}`} aria-label={`Delete ${project.projectName}`} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" onClick={() => { if (window.confirm(`Delete ${project.projectName}?`)) { deleteProject.mutate({ projectId: project.id }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListProjectsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } }); } }}><Trash2 size={15} /></button></div></div>)}</div></div>}
    {showForm && <ProjectFormModal project={editing} onClose={() => { setShowForm(false); setEditing(undefined); }} />}
  </div>;
}

function Lifecycle({ project }: { project: Project }) {
  const stages = ['lead', 'proposal', 'awarded', 'contracted', 'in_progress', 'billing', 'closeout'];
  const current = stages.indexOf(project.stage);
  return <div className="rounded-xl border border-border bg-card p-5 md:p-6"><div className="mb-6 flex items-center justify-between"><div><p className="mono text-[10px] uppercase tracking-[.14em] text-muted-foreground">Lifecycle</p><h2 className="mt-1 text-lg font-bold">Move the job forward</h2></div><Badge tone={project.stage === 'billing' ? 'violet' : 'teal'}>{stageLabels[project.stage]}</Badge></div><div className="grid grid-cols-4 gap-2 md:grid-cols-7">{stages.map((stage, index) => <div key={stage} className="relative"><div className={`mb-2 flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${index <= current ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}`}>{index < current ? <Check size={14} /> : index + 1}</div><p className={`text-[10px] leading-4 ${index === current ? 'font-bold text-foreground' : 'text-muted-foreground'}`}>{stageLabels[stage]}</p>{index < stages.length - 1 && <span className={`absolute left-8 right-[-8px] top-4 h-px ${index < current ? 'bg-primary' : 'bg-border'}`} />}</div>)}</div></div>;
}

function DetailCard({ icon: Icon, title, children, action }: { icon: typeof FileText; title: string; children: ReactNode; action?: ReactNode }) {
  return <section className="rounded-xl border border-border bg-card p-5 md:p-6"><div className="mb-5 flex items-center justify-between"><div className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary text-primary"><Icon size={16} /></span><h2 className="text-base font-bold">{title}</h2></div>{action}</div>{children}</section>;
}

function DetailRow({ label, value, mono = false }: { label: string; value?: ReactNode; mono?: boolean }) {
  return <div className="flex items-start justify-between gap-4 border-b border-border/70 py-2.5 last:border-0"><span className="text-xs text-muted-foreground">{label}</span><span className={`max-w-[65%] text-right text-xs font-semibold ${mono ? 'mono' : ''}`}>{value || '—'}</span></div>;
}

function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const projectId = Number(id);
  const [showEdit, setShowEdit] = useState(false);
  const [showFollow, setShowFollow] = useState(false);
  const projectQuery = useGetProject(projectId, { query: { queryKey: getGetProjectQueryKey(projectId), enabled: Number.isFinite(projectId) } });
  const activityQuery = useListProjectActivity(projectId, { query: { queryKey: getListProjectActivityQueryKey(projectId), enabled: Number.isFinite(projectId) } });
  const project = projectQuery.data;
  if (projectQuery.isLoading) return <LoadingPanel lines={8} />;
  if (projectQuery.isError || !project) return <ErrorPanel onRetry={() => projectQuery.refetch()} />;
  return <div className="animate-rise">
    <div className="mb-6 flex items-start gap-3"><Link href="/projects" data-testid="link-back-projects" className="mt-1 rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground"><ArrowRight size={17} className="rotate-180" /></Link><div className="min-w-0 flex-1"><p className="mono text-[10px] uppercase tracking-[.15em] text-accent">{project.projectNumber} · {project.category}</p><div className="mt-1 flex flex-wrap items-center gap-3"><h1 className="text-3xl font-bold tracking-[-.05em]">{project.projectName}</h1><Badge tone="teal">{stageLabels[project.stage]}</Badge></div><p className="mt-2 flex items-center gap-1.5 text-sm text-muted-foreground"><MapPin size={14} />{project.address || 'Address not added'} · {project.customerName}</p></div><Button data-testid="button-edit-project-detail" variant="outline" onClick={() => setShowEdit(true)}><Pencil size={15} /> <span className="hidden sm:inline">Edit project</span></Button></div>
    <Lifecycle project={project} />
    <div className="mt-5 grid gap-5 xl:grid-cols-[1.18fr_.82fr]"><div className="space-y-5">
      <DetailCard icon={FileText} title="Proposal & bid" action={<Badge tone={project.bidOutcome === 'won' ? 'green' : project.bidOutcome === 'lost' ? 'red' : 'orange'}>{project.bidOutcome.replace('_', ' ')}</Badge>}><DetailRow label="Proposal status" value={project.proposalStatus.replace('_', ' ')} /><DetailRow label="Details" value={project.proposalDetails} /><DetailRow label="Requirements" value={project.requirementsSummary} /></DetailCard>
      <DetailCard icon={ClipboardList} title="Contract & delivery" action={<Badge tone={project.contractStatus === 'active' ? 'teal' : 'neutral'}>{project.contractStatus}</Badge>}><div className="grid gap-x-8 md:grid-cols-2"><DetailRow label="Contract value" value={currency.format(project.contractValue)} mono /><DetailRow label="Contract window" value={`${shortDate(project.contractStart)} — ${shortDate(project.contractEnd)}`} /><DetailRow label="Delivery progress" value={`${project.deliveryPercent}%`} mono /><DetailRow label="Product mix" value={project.productCategories?.join(' · ')} /></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-secondary"><div className="h-full rounded-full bg-primary" style={{ width: `${project.deliveryPercent}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{project.contractDetails || 'No contract notes added.'}</p></DetailCard>
      <DetailCard icon={Receipt} title="Billing & collection" action={<Badge tone={project.billingStatus === 'paid' ? 'green' : 'violet'}>{project.billingStatus.replace('_', ' ')}</Badge>}><div className="grid gap-4 sm:grid-cols-3"><div className="rounded-lg bg-secondary/60 p-3"><p className="mono text-[9px] uppercase text-muted-foreground">Contract</p><p className="mt-2 text-lg font-bold">{currency.format(project.contractValue)}</p></div><div className="rounded-lg bg-secondary/60 p-3"><p className="mono text-[9px] uppercase text-muted-foreground">Invoiced</p><p className="mt-2 text-lg font-bold">{currency.format(project.invoicedAmount)}</p></div><div className="rounded-lg bg-primary/10 p-3"><p className="mono text-[9px] uppercase text-primary">Received</p><p className="mt-2 text-lg font-bold text-primary">{currency.format(project.receivedAmount)}</p></div></div><DetailRow label="Billing notes" value={project.billingDetails} /></DetailCard>
      <DetailCard icon={PackageCheck} title="Closeout" action={<Badge tone={project.closeoutStatus === 'complete' ? 'green' : 'orange'}>{project.closeoutStatus.replace('_', ' ')}</Badge>}><DetailRow label="Closeout detail" value={project.closeoutDetails} /><DetailRow label="Last updated" value={fullDate(project.updatedAt)} /></DetailCard>
    </div><div className="space-y-5">
      <DetailCard icon={CalendarDays} title="Next follow-up" action={<Button data-testid="button-add-followup-detail" variant="outline" className="px-2.5 py-1.5 text-xs" onClick={() => setShowFollow(true)}><Plus size={13} /> Add</Button>}><div className="rounded-lg border border-accent/25 bg-accent/8 p-4"><p className="mono text-[10px] uppercase tracking-[.12em] text-accent">{project.nextFollowUp ? shortDate(project.nextFollowUp) : 'Not scheduled'}</p><p className="mt-2 text-sm font-semibold">{project.nextFollowUp ? 'Keep the next conversation warm.' : 'No follow-up is scheduled.'}</p><p className="mt-1 text-xs leading-5 text-muted-foreground">Create a reminder for the next decision, delivery check-in, or referral conversation.</p></div></DetailCard>
      <DetailCard icon={ActivityIcon} title="Project activity"><ActivityList items={activityQuery.data ?? []} /></DetailCard>
    </div></div>
    {showEdit && <ProjectFormModal project={project} onClose={() => setShowEdit(false)} />}
    {showFollow && <FollowUpModal project={project} onClose={() => setShowFollow(false)} />}
  </div>;
}

function FollowUpModal({ project, onClose }: { project: Project; onClose: () => void }) {
  const create = useCreateFollowUp();
  const qc = useQueryClient();
  const [dueDate, setDueDate] = useState(project.nextFollowUp?.slice(0, 10) || '');
  const [note, setNote] = useState('');
  const submit = (event: React.FormEvent) => { event.preventDefault(); create.mutate({ data: { projectId: project.id, dueDate, note } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListFollowUpsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); onClose(); } }); };
  return <Modal title="Schedule a follow-up" onClose={onClose}><form onSubmit={submit} className="space-y-5"><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">Due date</span><input data-testid="input-followup-date-detail" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} required className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-primary/20" /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold text-muted-foreground">What should happen next?</span><textarea data-testid="textarea-followup-note-detail" value={note} onChange={(event) => setNote(event.target.value)} required rows={4} placeholder="e.g. Confirm revised countertop lead time with client" className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:ring-4 focus:ring-primary/20" /></label><div className="flex justify-end gap-3"><Button data-testid="button-cancel-followup-detail" type="button" variant="ghost" onClick={onClose}>Cancel</Button><Button data-testid="button-save-followup-detail" type="submit" disabled={create.isPending || !dueDate || !note}>{create.isPending ? 'Scheduling…' : 'Schedule follow-up'}</Button></div></form></Modal>;
}

function FollowUps() {
  const query = useListFollowUps({ query: { queryKey: getListFollowUpsQueryKey() } });
  const update = useUpdateFollowUp();
  const qc = useQueryClient();
  const [filter, setFilter] = useState<'open' | 'completed'>('open');
  const items = (query.data ?? []).filter((item) => item.status === filter).sort((a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime());
  const complete = (item: FollowUp) => update.mutate({ followUpId: item.id, data: { status: FollowUpUpdateStatus.completed } }, { onSuccess: () => { qc.invalidateQueries({ queryKey: getListFollowUpsQueryKey() }); qc.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() }); } });
  return <div className="animate-rise"><PageTitle eyebrow="Future work" title="Follow-ups" description="A deliberate queue for the conversations that turn good jobs into the next job." action={<Link href="/projects" data-testid="link-followups-projects" className="inline-flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-2.5 text-sm font-bold hover:bg-secondary"><BriefcaseBusiness size={15} /> Browse projects</Link>} />
    <div className="mb-5 flex items-center gap-2 border-b border-border"><button data-testid="button-filter-open-followups" onClick={() => setFilter('open')} className={`border-b-2 px-1 pb-3 text-sm font-bold ${filter === 'open' ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground'}`}>Open <span className="mono ml-1 text-[10px]">{query.data?.filter((item) => item.status === 'open').length ?? 0}</span></button><button data-testid="button-filter-completed-followups" onClick={() => setFilter('completed')} className={`border-b-2 px-1 pb-3 text-sm font-bold ${filter === 'completed' ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground'}`}>Completed</button></div>
    {query.isLoading ? <LoadingPanel lines={6} /> : query.isError ? <ErrorPanel onRetry={() => query.refetch()} /> : items.length === 0 ? <EmptyState icon={CalendarDays} title={filter === 'open' ? 'Your queue is clear' : 'No completed follow-ups yet'} text={filter === 'open' ? 'That is a good day. Add one from a project when the next conversation is known.' : 'Completed conversations will stay here as your operating history.'} action={<Link href="/projects" data-testid="link-empty-followups-projects" className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-sm font-bold text-primary-foreground"><Plus size={15} /> Find a project</Link>} /> : <div className="grid gap-3">{items.map((item, index) => { const overdue = filter === 'open' && new Date(item.dueDate) < new Date(new Date().toDateString()); return <div key={item.id} data-testid={`card-followup-${item.id}`} className={`group flex flex-col gap-4 rounded-xl border bg-card p-5 transition-colors md:flex-row md:items-center ${overdue ? 'border-accent/45' : 'border-border hover:border-primary/35'}`}><div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${overdue ? 'bg-accent/12 text-accent' : 'bg-primary/10 text-primary'}`}><CalendarDays size={19} /></div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><Link href={`/projects/${item.projectId}`} data-testid={`link-followup-project-${item.id}`} className="font-bold hover:text-primary hover:underline">{item.projectName}</Link>{overdue && <Badge tone="orange">Overdue</Badge>}</div><p className="mt-1 text-sm text-muted-foreground">{item.customerName}</p><p className="mt-3 text-sm">{item.note}</p></div><div className="flex shrink-0 items-center gap-4 md:flex-col md:items-end"><div className="text-left md:text-right"><p className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">Due</p><p className={`mt-1 text-sm font-bold ${overdue ? 'text-accent' : ''}`}>{fullDate(item.dueDate)}</p></div>{filter === 'open' && <Button data-testid={`button-complete-followup-${item.id}`} variant="outline" className="px-2.5 py-1.5 text-xs" disabled={update.isPending} onClick={() => complete(item)}><Check size={14} /> Complete</Button>}</div></div>; })}</div>}
  </div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><Shell><Switch><Route path="/" component={Dashboard} /><Route path="/projects" component={Projects} /><Route path="/projects/:id" component={ProjectDetail} /><Route path="/follow-ups" component={FollowUps} /><Route component={NotFound} /></Switch></Shell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;