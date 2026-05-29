import { Link } from "wouter";
import {
  useGetAdminAnalyticsOverview,
  getGetAdminAnalyticsOverviewQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart3,
  Eye,
  Download,
  Upload,
  ShieldCheck,
  Copy,
  ArrowUp,
  ArrowDown,
} from "lucide-react";

/**
 * Phase 8 — admin dashboard intelligence. A compact, operational summary that
 * reuses the 30s-cached analytics overview (no new backend load): engagement
 * deltas, review backlog, duplicate warnings, top categories, active
 * uploaders. Links through to the full analytics page.
 */
function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0) return null;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return <span className="text-xs text-muted-foreground">±0%</span>;
  const up = pct > 0;
  return (
    <span
      className={
        "inline-flex items-center text-xs " +
        (up ? "text-emerald-600" : "text-rose-600")
      }
    >
      {up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function Tile({
  icon: Icon,
  label,
  value,
  delta,
}: {
  icon: typeof Eye;
  label: string;
  value: number;
  delta?: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card px-3 py-2.5">
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tabular-nums">{value}</span>
        {delta}
      </div>
    </div>
  );
}

export function AdminInsights() {
  const { data, isLoading } = useGetAdminAnalyticsOverview({
    query: {
      queryKey: getGetAdminAnalyticsOverviewQueryKey(),
      staleTime: 30_000,
    },
  });

  if (isLoading) {
    return (
      <section aria-label="Platform insights">
        <h2 className="mb-3 font-serif text-xl font-bold text-foreground">
          Platform insights
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </section>
    );
  }
  if (!data) return null;

  const t = data.totals;
  const dupCount = data.duplicateGroups.length;

  return (
    <section aria-label="Platform insights">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-foreground">
          <BarChart3 className="h-5 w-5 text-primary" />
          Platform insights
        </h2>
        <Link
          href="/admin/analytics"
          className="text-sm font-medium text-primary hover:underline"
        >
          Full analytics
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile
          icon={Eye}
          label="Views this week"
          value={t.viewsThisWeek}
          delta={<Delta now={t.viewsThisWeek} prev={t.viewsPriorWeek} />}
        />
        <Tile
          icon={Download}
          label="Downloads this week"
          value={t.downloadsThisWeek}
          delta={<Delta now={t.downloadsThisWeek} prev={t.downloadsPriorWeek} />}
        />
        <Tile icon={Upload} label="Uploads this week" value={t.uploadsThisWeek} />
        <Link href="/review-queue" className="block">
          <div className="h-full rounded-lg border bg-card px-3 py-2.5 transition-colors hover:border-primary/40">
            <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Pending review
            </div>
            <span className="text-xl font-semibold tabular-nums">
              {t.pendingReviewCount}
            </span>
          </div>
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Duplicate warning */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Copy className="h-3.5 w-3.5" />
              Duplicate warnings
            </div>
            {dupCount === 0 ? (
              <p className="text-sm text-muted-foreground">No duplicate groups.</p>
            ) : (
              <p className="text-sm">
                <span className="font-semibold text-amber-600">{dupCount}</span> group
                {dupCount === 1 ? "" : "s"} of identical files.{" "}
                <Link href="/admin/analytics" className="text-primary hover:underline">
                  Review
                </Link>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Top categories */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              Most-used categories
            </div>
            {data.topCategories.length === 0 ? (
              <p className="text-sm text-muted-foreground">No data yet.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {data.topCategories.slice(0, 3).map((c) => (
                  <li key={c.categoryId} className="flex justify-between gap-2">
                    <span className="truncate">{c.name}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {c.documentCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Active uploaders */}
        <Card>
          <CardContent className="p-3">
            <div className="mb-1.5 text-xs font-medium text-muted-foreground">
              Active uploaders (7d)
            </div>
            {data.activeUploaders.length === 0 ? (
              <p className="text-sm text-muted-foreground">No uploads this week.</p>
            ) : (
              <ul className="space-y-0.5 text-sm">
                {data.activeUploaders.slice(0, 3).map((u) => (
                  <li key={u.userId} className="flex justify-between gap-2">
                    <span className="truncate">{u.displayName}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {u.uploadCount}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}
