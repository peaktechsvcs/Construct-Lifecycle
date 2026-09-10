import { ReactNode } from 'react';
import { X, TrendingUp, CalendarDays, Activity as ActivityIcon, CircleAlert } from 'lucide-react';
import { Activity } from '@workspace/api-client-react';

export const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const shortDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
export const fullDate = (value?: string | null) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value)) : '—';

export const stageLabels: Record<string, string> = {
  lead: 'Lead', proposal: 'Proposal', awarded: 'Awarded', contracted: 'Contracted',
  in_progress: 'In progress', billing: 'Billing', closeout: 'Closeout', follow_up: 'Follow-up', lost: 'Lost',
};

export const stageColors: Record<string, string> = {
  lead: 'bg-status-neutral', proposal: 'bg-status-warning', awarded: 'bg-status-warning', contracted: 'bg-status-info',
  in_progress: 'bg-status-info', billing: 'bg-primary', closeout: 'bg-status-success', follow_up: 'bg-status-danger', lost: 'bg-status-neutral/50',
};

export function Button({ children, className = '', variant = 'primary', ...props }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'outline' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-primary text-primary-foreground hover:opacity-90 shadow-sm',
    outline: 'border border-border bg-card text-foreground hover:bg-secondary',
    ghost: 'text-muted-foreground hover:bg-secondary hover:text-foreground',
    danger: 'border border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15',
  };
  return <button {...props} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${styles[variant]} ${className}`} />;
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'teal' | 'orange' | 'green' | 'red' | 'violet' }) {
  const tones = {
    neutral: 'bg-secondary text-secondary-foreground', teal: 'bg-status-info/10 text-status-info',
    orange: 'bg-status-warning/10 text-status-warning', green: 'bg-status-success/10 text-status-success',
    red: 'bg-status-danger/10 text-status-danger', violet: 'bg-primary/10 text-primary',
  };
  return <span className={`inline-flex items-center rounded-md px-2 py-1 text-[11px] font-bold uppercase tracking-[.08em] ${tones[tone]}`}>{children}</span>;
}

export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="mb-7 flex flex-col justify-between gap-4 md:flex-row md:items-end">
    <div>
      <p className="mono mb-2 text-[10px] font-medium uppercase tracking-[.18em] text-accent">{eyebrow}</p>
      <h1 className="text-3xl font-bold tracking-[-.04em] text-foreground md:text-4xl">{title}</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{description}</p>
    </div>
    {action}
  </div>;
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
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

export function LoadingPanel({ lines = 3 }: { lines?: number }) {
  return <div className="space-y-3 rounded-xl border border-border bg-card p-5">{Array.from({ length: lines }).map((_, index) => <div key={index} className={`skeleton h-4 rounded ${index === 0 ? 'w-1/3' : index === 1 ? 'w-4/5' : 'w-2/3'}`} />)}</div>;
}

export function ErrorPanel({ onRetry }: { onRetry: () => void }) {
  return <div className="flex items-center justify-between rounded-xl border border-destructive/20 bg-destructive/5 p-5"><div className="flex items-center gap-3"><CircleAlert size={19} className="text-destructive" /><div><p className="text-sm font-semibold">We couldn't load this view.</p><p className="text-xs text-muted-foreground">Try again in a moment.</p></div></div><Button data-testid="button-retry" variant="outline" onClick={onRetry}>Retry</Button></div>;
}

export function StatCard({ label, value, detail, icon: Icon, accent = 'teal' }: { label: string; value: string; detail: string; icon: typeof TrendingUp; accent?: 'teal' | 'orange' | 'violet' | 'green' }) {
  const color = { teal: 'bg-primary/10 text-primary', orange: 'bg-accent/12 text-accent', violet: 'bg-violet-500/12 text-violet-700', green: 'bg-emerald-500/12 text-emerald-700' }[accent];
  return <div className="group rounded-xl border border-border bg-card p-5 shadow-[0_1px_0_hsl(var(--border))] transition-transform hover:-translate-y-0.5">
    <div className="flex items-start justify-between"><span className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{label}</span><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${color}`}><Icon size={16} /></span></div>
    <p className="mt-5 text-2xl font-bold tracking-[-.05em]">{value}</p><p className="mt-1 text-xs text-muted-foreground">{detail}</p>
  </div>;
}

export function EmptyState({ icon: Icon, title, text, action }: { icon: typeof CalendarDays; title: string; text: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border px-5 py-9 text-center"><span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-muted-foreground"><Icon size={18} /></span><p className="text-sm font-bold">{title}</p><p className="mt-1 max-w-xs text-xs text-muted-foreground">{text}</p>{action && <div className="mt-4">{action}</div>}</div>;
}

export function ActivityList({ items, compact = false }: { items: Activity[]; compact?: boolean }) {
  if (items.length === 0) return <EmptyState icon={ActivityIcon} title="No activity yet" text="Updates will land here as your team moves work forward." />;
  return <div className="space-y-4">{items.map((item, index) => <div key={item.id} data-testid={`activity-${item.id}`} className="relative flex gap-3">{index < items.length - 1 && <span className="absolute left-[9px] top-6 h-[calc(100%+8px)] w-px bg-border" />}<span className="relative mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary/15 text-primary"><span className="h-1.5 w-1.5 rounded-full bg-primary" /></span><div className="min-w-0"><p className="text-xs leading-5"><span className="font-bold">{item.action}</span> <span className="text-muted-foreground">{item.description}</span></p><p className="mono mt-1 text-[9px] uppercase tracking-[.07em] text-muted-foreground">{item.actor || 'Team'} · {compact ? shortDate(item.createdAt) : fullDate(item.createdAt)}</p></div></div>)}</div>;
}
