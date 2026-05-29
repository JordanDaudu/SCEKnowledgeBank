import { useState } from "react";
import { Link } from "wouter";
import {
  useListActivity,
  getListActivityQueryKey,
  type ActivityEntry,
  type ListActivityParams,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Activity as ActivityIcon,
  Inbox,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { describeAction, iconForEntity } from "@/lib/activity-format";

const PAGE_SIZE = 20;

const ENTITY_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All activity" },
  { value: "document", label: "Documents" },
  { value: "comment", label: "Comments" },
  { value: "request", label: "Requests" },
  { value: "user", label: "Accounts" },
];

function ActivityRow({ entry }: { entry: ActivityEntry }) {
  const Icon = iconForEntity(entry.entityType);
  const actorName = entry.actor?.displayName ?? "Someone";
  const verb = describeAction(entry.action);
  const targetTitle = entry.target?.title;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
      <div className="p-2 rounded-md bg-secondary text-muted-foreground shrink-0">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug">
          <span className="font-medium">{actorName}</span>{" "}
          <span className="text-muted-foreground">{verb}</span>
          {targetTitle && (
            <>
              {" "}
              {entry.entityType === "document" ? (
                <Link
                  href={`/documents/${entry.entityId}`}
                  className="font-medium hover:underline hover:text-primary transition-colors"
                >
                  {targetTitle}
                </Link>
              ) : (
                <span className="font-medium">{targetTitle}</span>
              )}
            </>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {formatDateTime(entry.createdAt)}
        </p>
      </div>
    </li>
  );
}

export default function Activity() {
  const [page, setPage] = useState(1);
  const [entityType, setEntityType] = useState("all");
  const [mine, setMine] = useState(false);

  const params: ListActivityParams = {
    page,
    pageSize: PAGE_SIZE,
    ...(entityType !== "all" ? { entityType } : {}),
    // Omit `mine` entirely when off — the API coerces any present value to
    // true, so sending mine=false would wrongly filter to self.
    ...(mine ? { mine: true } : {}),
  };

  const { data, isLoading, isError, refetch } = useListActivity(params, {
    query: {
      queryKey: getListActivityQueryKey(params),
      staleTime: 15_000,
    },
  });

  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
              <ActivityIcon className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Activity</h1>
          </div>
          <p className="text-muted-foreground">
            A running log of recent actions you can see.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={mine ? "mine" : "all"}
            onValueChange={(v) => {
              setMine(v === "mine");
              setPage(1);
            }}
          >
            <SelectTrigger className="w-36" data-testid="activity-scope">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everyone</SelectItem>
              <SelectItem value="mine">Just me</SelectItem>
            </SelectContent>
          </Select>
          <Select
            value={entityType}
            onValueChange={(v) => {
              setEntityType(v);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-44" data-testid="activity-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ENTITY_FILTERS.map((f) => (
                <SelectItem key={f.value} value={f.value}>
                  {f.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="py-4 px-5" data-testid="activity-list">
          {isError ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground mb-4">Couldn't load activity.</p>
              <Button variant="outline" size="sm" onClick={() => refetch()}>
                Try again
              </Button>
            </div>
          ) : isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : data && data.items.length > 0 ? (
            <ul className="divide-y divide-border/60">
              {data.items.map((entry) => (
                <ActivityRow key={entry.id} entry={entry} />
              ))}
            </ul>
          ) : (
            <div className="text-center py-12">
              <Inbox className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
              <p className="text-muted-foreground">No activity to show yet.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft className="h-4 w-4" /> Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
