import { Link } from "wouter";
import {
  useListActivity,
  getListActivityQueryKey,
  type ListActivityParams,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateTime } from "@/lib/format";
import { describeAction, iconForEntity } from "@/lib/activity-format";

/**
 * Phase 5 — compact recent-activity widget for the dashboard. Reuses the
 * role-scoped activity feed (so each viewer sees only what they're allowed
 * to) and links through to the full Activity page.
 */
export function RecentActivity() {
  const params: ListActivityParams = { page: 1, pageSize: 6 };
  const { data, isLoading } = useListActivity(params, {
    query: { queryKey: getListActivityQueryKey(params), staleTime: 15_000 },
  });

  // Nothing to show (e.g. a brand-new account) — stay out of the way.
  if (!isLoading && (!data || data.items.length === 0)) return null;

  return (
    <section aria-label="Recent activity">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-serif text-xl font-bold text-foreground">
          Recent activity
        </h2>
        <Link
          href="/activity"
          className="text-sm font-medium text-primary hover:underline"
        >
          View all
        </Link>
      </div>
      <Card>
        <CardContent className="px-5 py-3" data-testid="home-recent-activity">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-10 w-full rounded-md" />
              ))}
            </div>
          ) : (
            <ul className="divide-y divide-border/60">
              {data!.items.map((entry) => {
                const Icon = iconForEntity(entry.entityType);
                const actorName = entry.actor?.displayName ?? "Someone";
                const targetTitle = entry.target?.title;
                return (
                  <li key={entry.id} className="flex items-start gap-3 py-2.5">
                    <div className="shrink-0 rounded-md bg-secondary p-1.5 text-muted-foreground">
                      <Icon className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm leading-snug">
                        <span className="font-medium">{actorName}</span>{" "}
                        <span className="text-muted-foreground">
                          {describeAction(entry.action)}
                        </span>
                        {targetTitle && (
                          <>
                            {" "}
                            {entry.entityType === "document" ? (
                              <Link
                                href={`/documents/${entry.entityId}`}
                                className="font-medium transition-colors hover:text-primary hover:underline"
                              >
                                {targetTitle}
                              </Link>
                            ) : (
                              <span className="font-medium">{targetTitle}</span>
                            )}
                          </>
                        )}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                      </p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
