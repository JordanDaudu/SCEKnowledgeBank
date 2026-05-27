import { Link } from "wouter";
import {
  useListNotifications,
  useMarkNotificationRead,
  useMarkAllNotificationsRead,
  getListNotificationsQueryKey,
  getGetNotificationUnreadCountQueryKey,
  type Notification,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCheck, Loader2 } from "lucide-react";
import { formatDateTime } from "@/lib/format";

function typeLabel(type: string): string {
  switch (type) {
    case "comment.mention":
      return "mentioned you in a comment";
    case "comment.reply":
      return "replied to your comment";
    default:
      return type;
  }
}

export default function NotificationsPage() {
  const queryClient = useQueryClient();
  const listParams = { limit: 100 };
  const { data: list, isLoading } = useListNotifications(listParams, {
    query: {
      queryKey: getListNotificationsQueryKey(listParams),
      refetchOnMount: true,
      staleTime: 0,
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

  const items = list ?? [];
  const unreadCount = items.filter((n) => n.readAt == null).length;

  const handleClick = (n: Notification) => {
    if (n.readAt == null) markRead.mutate({ id: n.id });
  };

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-serif font-bold">Notifications</h1>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          onClick={() => markAll.mutate()}
          disabled={unreadCount === 0 || markAll.isPending}
          data-testid="notification-mark-all"
        >
          <CheckCheck className="h-4 w-4" />
          Mark all read
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base font-medium">
            {isLoading
              ? "Loading"
              : items.length === 0
                ? "No notifications yet"
                : `${items.length} item${items.length === 1 ? "" : "s"}`}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading && (
            <div className="p-8 flex justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {!isLoading &&
            items.map((n) => {
              const unread = n.readAt == null;
              const row = (
                <div
                  className={`p-4 border-b last:border-b-0 cursor-pointer hover:bg-secondary/40 ${unread ? "bg-primary/5" : ""}`}
                  onClick={() => handleClick(n)}
                  data-testid={`notification-row-${n.id}`}
                >
                  <div className="flex items-start gap-3">
                    {unread && (
                      <span className="mt-2 h-2 w-2 rounded-full bg-primary shrink-0" />
                    )}
                    <div className="flex-1">
                      <p className="text-sm">
                        <span className="font-medium">
                          {n.actor?.displayName ?? "Someone"}
                        </span>{" "}
                        <span className="text-muted-foreground">
                          {typeLabel(n.type)}
                        </span>
                      </p>
                      {n.body && (
                        <p className="text-sm text-muted-foreground mt-1 line-clamp-3">
                          {n.body}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mt-2">
                        {formatDateTime(n.createdAt)}
                      </p>
                    </div>
                  </div>
                </div>
              );
              return n.url ? (
                <Link key={n.id} href={n.url} className="block">
                  {row}
                </Link>
              ) : (
                <div key={n.id}>{row}</div>
              );
            })}
        </CardContent>
      </Card>
    </div>
  );
}
