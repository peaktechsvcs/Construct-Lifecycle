import { Bell, CheckCheck, CircleAlert, Info, ArrowUpRight } from 'lucide-react';
import { Link } from 'wouter';
import {
  getListNotificationsQueryKey,
  useListNotifications,
  useMarkNotificationsRead,
  type Notification,
} from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@workspace/construct-lifecycle-design-system/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@workspace/construct-lifecycle-design-system/components/ui/popover';
import { cn } from '@workspace/construct-lifecycle-design-system/lib/utils';

function relativeTime(value: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return 'Just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function SeverityIcon({ notification }: { notification: Notification }) {
  if (notification.severity === 'urgent') return <CircleAlert size={15} className="text-status-danger" aria-hidden="true" />;
  if (notification.severity === 'attention') return <CircleAlert size={15} className="text-status-warning" aria-hidden="true" />;
  return <Info size={15} className="text-status-info" aria-hidden="true" />;
}

export function NotificationPreview() {
  const queryClient = useQueryClient();
  const query = useListNotifications(undefined, {
    query: { queryKey: getListNotificationsQueryKey(), staleTime: 30000, refetchInterval: 60000 },
  });
  const markRead = useMarkNotificationsRead();
  const items = query.data?.items.slice(0, 5) ?? [];

  const handleOpen = (notification: Notification) => {
    if (notification.read) return;
    markRead.mutate({ data: { notificationKeys: [notification.key] } }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNotificationsQueryKey() }),
    });
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-testid="button-notifications"
          className="relative rounded-lg p-2 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`Notifications${(query.data?.unreadCount ?? 0) > 0 ? `, ${query.data?.unreadCount} unread` : ''}`}
        >
          <Bell size={18} />
          {(query.data?.unreadCount ?? 0) > 0 && (
            <span data-testid="status-notification-unread-count" className="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-center text-[9px] font-bold leading-4 text-primary-foreground">
              {query.data?.unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={8} className="w-[min(380px,calc(100vw-2rem))] border-border bg-popover p-0 text-popover-foreground shadow-lg">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <p className="text-sm font-bold">Notifications</p>
            <p className="mono mt-0.5 text-[10px] uppercase tracking-[.1em] text-muted-foreground">
              {(query.data?.unreadCount ?? 0) > 0 ? `${query.data?.unreadCount} need attention` : 'All caught up'}
            </p>
          </div>
          <Bell size={16} className="text-muted-foreground" aria-hidden="true" />
        </div>
        <div className="max-h-96 overflow-y-auto">
          {query.isLoading ? (
            <div className="space-y-3 p-4" data-testid="loading-notification-preview">
              {[1, 2, 3].map((item) => <div key={item} className="skeleton h-12 rounded-md" />)}
            </div>
          ) : query.isError ? (
            <div className="p-4 text-sm text-muted-foreground" data-testid="error-notification-preview">
              Notifications are temporarily unavailable.
            </div>
          ) : items.length === 0 ? (
            <div className="p-6 text-center" data-testid="empty-notification-preview">
              <CheckCheck size={20} className="mx-auto mb-2 text-status-success" />
              <p className="text-sm font-semibold">No new notifications</p>
              <p className="mt-1 text-xs text-muted-foreground">Updates that need your attention will appear here.</p>
            </div>
          ) : (
            items.map((notification) => (
              <Link
                key={notification.key}
                href={notification.href}
                onClick={() => handleOpen(notification)}
                data-testid={`link-notification-preview-${notification.key}`}
                className={cn(
                  'flex gap-3 border-b border-border px-4 py-3 transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                  !notification.read && 'bg-primary/5',
                )}
              >
                <span className="mt-0.5 shrink-0"><SeverityIcon notification={notification} /></span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-start justify-between gap-2">
                    <span className={cn('text-xs leading-5', !notification.read && 'font-bold')}>{notification.title}</span>
                    {!notification.read && <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-xs leading-5 text-muted-foreground">{notification.description}</span>
                  <span className="mono mt-1 block text-[9px] uppercase tracking-[.06em] text-muted-foreground">{relativeTime(notification.createdAt)}</span>
                </span>
              </Link>
            ))
          )}
        </div>
        <div className="border-t border-border p-3">
          <Button asChild variant="outline" className="w-full justify-center text-xs">
            <Link href="/notifications" data-testid="link-view-all-notifications">
              View all notifications <ArrowUpRight size={14} />
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}