import { ReactNode, type ButtonHTMLAttributes } from 'react';
import { TrendingUp, CalendarDays, Activity as ActivityIcon } from 'lucide-react';
import { Activity } from '@workspace/api-client-react';
import {
  Button as DesignButton,
  type ButtonProps as DesignButtonProps,
} from '@workspace/construct-lifecycle-design-system/components/ui/button';
import {
  Badge as DesignBadge,
  type BadgeProps as DesignBadgeProps,
} from '@workspace/construct-lifecycle-design-system/components/ui/badge';
import { Modal as DesignModal } from '@workspace/construct-lifecycle-design-system/components/ui/modal';
import { LoadingPanel as DesignLoadingPanel } from '@workspace/construct-lifecycle-design-system/components/ui/loading-panel';
import { ErrorPanel as DesignErrorPanel } from '@workspace/construct-lifecycle-design-system/components/ui/error-panel';
import { PageTitle as DesignPageTitle } from '@workspace/construct-lifecycle-design-system/components/ui/page-title';
import { EmptyState as DesignEmptyState } from '@workspace/construct-lifecycle-design-system/components/ui/empty-state';
import { StatCard as DesignStatCard } from '@workspace/construct-lifecycle-design-system/components/ui/stat-card';

export { stageLabels, stageColors } from '@/lib/stage-config';

export const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
export const shortDate = (value?: string | null) =>
  value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value)) : '—';
export const fullDate = (value?: string | null) =>
  value
    ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
    : '—';

const buttonVariants: Record<NonNullable<ButtonProps['variant']>, DesignButtonProps['variant']> = {
  primary: 'default',
  outline: 'outline',
  ghost: 'ghost',
  danger: 'destructive',
};

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
};

export function Button({ variant = 'primary', ...props }: ButtonProps) {
  return <DesignButton {...props} variant={buttonVariants[variant]} />;
}

const badgeVariants: Record<BadgeTone, DesignBadgeProps['variant']> = {
  neutral: 'neutral',
  teal: 'info',
  orange: 'warning',
  green: 'success',
  red: 'danger',
  violet: 'primary',
};

type BadgeTone = 'neutral' | 'teal' | 'orange' | 'green' | 'red' | 'violet';

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: BadgeTone }) {
  return <DesignBadge variant={badgeVariants[tone]}>{children}</DesignBadge>;
}

export const PageTitle = DesignPageTitle;
export const Modal = DesignModal;
export const LoadingPanel = DesignLoadingPanel;
export const ErrorPanel = DesignErrorPanel;
export const EmptyState = DesignEmptyState;

export function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  accent = 'teal',
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof TrendingUp;
  accent?: 'teal' | 'orange' | 'violet' | 'green';
}) {
  const accents = {
    teal: 'primary',
    orange: 'warning',
    violet: 'info',
    green: 'success',
  } as const;

  return (
    <DesignStatCard
      label={label}
      value={value}
      detail={detail}
      icon={Icon}
      accent={accents[accent]}
    />
  );
}

export function ActivityList({ items, compact = false }: { items: Activity[]; compact?: boolean }) {
  if (items.length === 0) {
    return (
      <DesignEmptyState
        icon={ActivityIcon}
        title="No activity yet"
        text="Updates will land here as your team moves work forward."
      />
    );
  }

  return (
    <div className="space-y-4">
      {items.map((item, index) => (
        <div key={item.id} data-testid={`activity-${item.id}`} className="relative flex gap-3">
          {index < items.length - 1 && (
            <span className="absolute left-[9px] top-6 h-[calc(100%+8px)] w-px bg-border" />
          )}
          <span className="relative mt-0.5 flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full border-2 border-card bg-primary/15 text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" />
          </span>
          <div className="min-w-0">
            <p className="text-xs leading-5">
              <span className="font-bold">{item.action}</span>{' '}
              <span className="text-muted-foreground">{item.description}</span>
            </p>
            <p className="mono mt-1 text-[9px] uppercase tracking-[.07em] text-muted-foreground">
              {item.actor || 'Team'} · {compact ? shortDate(item.createdAt) : fullDate(item.createdAt)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}