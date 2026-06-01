import { useState } from "react";
import { Link } from "wouter";
import {
  useGetNotificationUnreadCount,
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
  getGetNotificationUnreadCountQueryKey,
  type Notification,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Bell, CheckCheck } from "lucide-react";
import { Button } from "./ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "./ui/popover";
import { ScrollArea } from "./ui/scroll-area";
import { formatDateTime } from "@/lib/format";

const POLL_MS = 30_000;

function typeLabel(type: string): string {
  switch (type) {
    case "comment.mention":
      return "mentioned you";
    case "comment.reply":
      return "replied to your comment";
    case "account.deleted":
      return "deleted their account";
    case "document.review_requested":
      return "sent you a document to review";
    case "document.admin_review_requested":
      return "needs admin approval";
    case "document.approved":
      return "approved your document";
    case "document.rejected":
      return "rejected your document";
    default:
      return type;
  }
}

function NotificationRow({
  n,
  onClick,
}: {
  n: Notification;
  onClick: (n: Notification) => void;
}) {
  const unread = n.readAt == null;
  const inner = (
    <div
      className={`p-3 border-b last:border-b-0 cursor-pointer hover:bg-secondary/50 ${unread ? "bg-primary/5" : ""}`}
      onClick={() => onClick(n)}
      data-testid={`notification-row-${n.id}`}
    >
      <div className="flex items-start gap-2">
        {unread && (
          <span className="mt-1.5 h-2 w-2 rounded-full bg-primary shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-sm">
            <span className="font-medium">
              {n.actor?.displayName ?? "Someone"}
            </span>{" "}
            <span className="text-muted-foreground">{typeLabel(n.type)}</span>
          </p>
          {n.body && (
            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
              {n.body}
            </p>
          )}
          <p className="text-xs text-muted-foreground mt-1">
            {formatDateTime(n.createdAt)}
          </p>
        </div>
      </div>
    </div>
  );
  return n.url ? (
    <Link href={n.url} className="block">
      {inner}
    </Link>
  ) : (
    inner
  );
}

export function NotificationBell() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data: countData } = useGetNotificationUnreadCount({
    query: {
      queryKey: getGetNotificationUnreadCountQueryKey(),
      refetchInterval: POLL_MS,
      refetchOnMount: true,
      staleTime: 0,
    },
  });
  const listParams = { limit: 10 };
  const { data: list } = useListNotifications(listParams, {
    query: {
      queryKey: getListNotificationsQueryKey(listParams),
      // Only poll the list when the dropdown is open — the bell badge
      // is the cheap thing we always poll; the full list refreshes on
      // open and every 30s while visible.
      refetchInterval: open ? POLL_MS : false,
      refetchOnMount: true,
      staleTime: 0,
      enabled: open,
    },
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/notifications"] });
    void queryClient.invalidateQueries({
      queryKey: getGetNotificationUnreadCountQueryKey(),
    });
  };

  const markRead = useMarkNotificationRead({
    mutation: { onSuccess: invalidate },
  });
  const markAll = useMarkAllNotificationsRead({
    mutation: { onSuccess: invalidate },
  });

  const unread = countData?.unread ?? 0;
  const items = list ?? [];

  const handleClick = (n: Notification) => {
    if (n.readAt == null) markRead.mutate({ id: n.id });
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          title="Notifications"
          data-testid="notification-bell"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unread > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center"
              data-testid="notification-unread-badge"
            >
              {unread > 99 ? "99+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-1rem)] p-0">
        <div className="flex items-center justify-between p-3 border-b">
          <span className="font-medium text-sm">Notifications</span>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => markAll.mutate()}
            disabled={unread === 0 || markAll.isPending}
            data-testid="notification-mark-all"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Mark all read
          </Button>
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <p className="p-6 text-sm text-center text-muted-foreground">
              No notifications yet
            </p>
          ) : (
            items.map((n) => (
              <NotificationRow key={n.id} n={n} onClick={handleClick} />
            ))
          )}
        </ScrollArea>
        <div className="p-2 border-t">
          <Link
            href="/notifications"
            onClick={() => setOpen(false)}
            className="block text-center text-xs text-primary hover:underline py-1"
          >
            View all
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
