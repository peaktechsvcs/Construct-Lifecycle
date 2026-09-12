import { useMemo, useState } from 'react';
import { Bell, CheckCheck, CircleAlert, Info, RefreshCw, ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import {
  getListNotificationsQueryKey,
  ListNotificationsStatus,
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationsRead,
  type Notification,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@workspace/construct-lifecycle-design-system/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@workspace/construct-lifecycle-design-system/components/ui/tabs';
import { PageTitle, EmptyState } from '@/components/app-ui';
import { cn } from '@workspace/construct-lifecycle-design-system/lib/utils';

type Filter = 'all' | 'unread';

function formatDate(value: string) {
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function SeverityIcon({ severity }: { severity: Notification['severity'] }) {
  if (severity === 'urgent') return <CircleAlert size={17} className="text-status-danger" aria-hidden="true" />;
  if (severity === 'attention') return <CircleAlert size={17} className="text-status-warning" aria-hidden="true" />;
  return <Info size={17} className="text-status-info" aria-hidden="true" />;
}

function NotificationRow({ notification, onOpen }: { notification: Notification; onOpen: (notification: Notification) => void }) {
  return (
    <Link
      href={notification.href}
      onClick={() => onOpen(notification)}
      data-testid={`link-notification-${notification.key}`}
      className={cn(
        'group flex min-w-0 gap-4 border-b border-border px-4 py-4 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:px-6',
        !notification.read && 'bg-primary/5',
      )}
    >
      <span className="mt-1 shrink-0"><SeverityIcon severity={notification.severity} /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <span className={cn('text-sm leading-6', !notification.read && 'font-bold')} data-testid={`text-notification-title-${notification.key}`}>
            {notification.title}
          </span>
          <span className="mono shrink-0 text-[10px] uppercase tracking-[.06em] text-muted-foreground">{formatDate(notification.createdAt)}</span>
        </span>
        <span className="mt-1 block text-sm leading-6 text-muted-foreground">{notification.description}</span>
        {notification.projectName && (
          <span className="mt-2 inline-flex max-w-full items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs font-medium text-secondary-foreground">
            {notification.projectName}
            {notification.projectId && <ArrowUpRight size={12} aria-hidden="true" />}
          </span>
        )}
      </span>
      {!notification.read && <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
    </Link>
  );
}

export function Notifications() {
  const [filter, setFilter] = useState<Filter>('all');
  const queryClient = useQueryClient();
  const params = useMemo(() => ({ status: filter === 'unread' ? ListNotificationsStatus.unread : ListNotificationsStatus.all, limit: 50 }), [filter]);
  const query = useListNotifications(params, {
    query: { queryKey: getListNotificationsQueryKey(params), staleTime: 30000, refetchInterval: 60000 },
  });
  const markRead = useMarkNotificationsRead();
  const markAll = useMarkAllNotificationsRead();
  const unreadCount = query.data?.unreadCount ?? 0;

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey(params) });
  const openNotification = (notification: Notification) => {
    if (!notification.read) markRead.mutate({ data: { notificationKeys: [notification.key] } }, { onSuccess: invalidate });
  };
  const handleMarkAll = () => markAll.mutate(undefined, { onSuccess: invalidate });

  return (
    <div className="animate-rise space-y-6">
      <PageTitle
        eyebrow="Daily inbox"
        title="Notifications"
        description="A focused view of changes and actions that need your attention."
        action={unreadCount > 0 ? (
          <Button variant="outline" onClick={handleMarkAll} disabled={markAll.isPending} data-testid="button-mark-all-notifications-read">
            <CheckCheck size={15} /> Mark all read
          </Button>
        ) : undefined}
      />
      <div className="flex flex-col gap-3 border-b border-border pb-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={filter} onValueChange={(value) => setFilter(value as Filter)}>
          <TabsList data-testid="tabs-notification-filter">
            <TabsTrigger value="all" data-testid="tab-notifications-all">All</TabsTrigger>
            <TabsTrigger value="unread" data-testid="tab-notifications-unread">
              Unread {unreadCount > 0 && <span className="ml-1 rounded-full bg-primary/15 px-1.5 text-[10px]">{unreadCount}</span>}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <span className="mono text-[10px] uppercase tracking-[.12em] text-muted-foreground">{query.data?.items.length ?? 0} notifications</span>
      </div>
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-sm" aria-label={`${filter} notifications`}>
        {query.isLoading ? (
          <div className="space-y-3 p-6" data-testid="loading-notifications">
            {[1, 2, 3, 4].map((item) => <div key={item} className="skeleton h-16 rounded-md" />)}
          </div>
        ) : query.isError ? (
          <div className="p-8 text-center" data-testid="error-notifications">
            <p className="text-sm font-semibold">Notifications could not be loaded.</p>
            <p className="mt-1 text-sm text-muted-foreground">Try again to reconnect to your daily inbox.</p>
            <Button variant="outline" className="mt-4" onClick={() => query.refetch()} data-testid="button-retry-notifications">
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        ) : query.data?.items.length === 0 ? (
          <div className="p-8" data-testid="empty-notifications">
            <EmptyState icon={Bell} title={filter === 'unread' ? 'No unread notifications' : 'No notifications yet'} text={filter === 'unread' ? 'You are up to date. New changes will appear here when they need your attention.' : 'Team activity and important project changes will appear here.'} />
          </div>
        ) : (
          query.data?.items.map((notification) => <NotificationRow key={notification.key} notification={notification} onOpen={openNotification} />)
        )}
      </section>
    </div>
  );
}