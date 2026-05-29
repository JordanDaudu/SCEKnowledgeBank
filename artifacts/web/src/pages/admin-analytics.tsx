import { Link } from "wouter";
import { useGetAdminAnalyticsOverview } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import {
  BarChart3,
  Copy,
  Download,
  Eye,
  FileText,
  FolderTree,
  Loader2,
  MessageSquare,
  ShieldCheck,
  Users,
} from "lucide-react";
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "@/components/ui/tabs";
import { ActivityFeed } from "@/components/activity-feed";
import { cn } from "@/lib/utils";

function WoW({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="text-muted-foreground">—</span>;
  if (prev === 0) return <span className="text-emerald-600 font-medium">new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const tone =
    pct > 0
      ? "text-emerald-600 font-medium"
      : pct < 0
      ? "text-rose-600 font-medium"
      : "text-muted-foreground";
  return (
    <span className={tone}>
      {pct > 0 ? "+" : ""}
      {pct}% vs last week
    </span>
  );
}

function StatTile({
  icon: Icon,
  label,
  value,
  hint,
  tileClass = "bg-secondary text-muted-foreground",
  cardClass,
}: {
  icon: typeof FileText;
  label: string;
  value: number | string;
  hint?: React.ReactNode;
  tileClass?: string;
  cardClass?: string;
}) {
  return (
    <Card className={cardClass}>
      <CardContent className="pt-5 pb-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-bold mt-1 tabular-nums">{value}</p>
            {hint && <p className="text-xs mt-1.5">{hint}</p>}
          </div>
          <div className={cn("p-2.5 rounded-lg shrink-0", tileClass)}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function AdminAnalytics() {
  const { data, isLoading, error } = useGetAdminAnalyticsOverview();

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="container mx-auto p-6">
        <p className="text-rose-600">Failed to load analytics.</p>
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> Workspace analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Read-only snapshot · updated {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
        </div>
        {t.pendingReviewCount > 0 && (
          <Link href="/review-queue">
            <span className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer">
              <ShieldCheck className="h-4 w-4" />
              {t.pendingReviewCount} pending review
            </span>
          </Link>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="activity">Activity logs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6 mt-4">

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={FileText}
          label="Documents"
          value={t.totalDocuments}
          tileClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400"
        />
        <StatTile
          icon={Users}
          label="Active users"
          value={t.totalUsers}
          tileClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
        />
        <StatTile
          icon={MessageSquare}
          label="Comments"
          value={t.totalComments}
          tileClass="bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
        />
        <StatTile
          icon={FileText}
          label="Uploads this week"
          value={t.uploadsThisWeek}
          tileClass="bg-primary/10 text-primary"
        />
        <StatTile
          icon={Eye}
          label="Views this week"
          value={t.viewsThisWeek}
          hint={<WoW now={t.viewsThisWeek} prev={t.viewsPriorWeek} />}
          tileClass="bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
        />
        <StatTile
          icon={Download}
          label="Downloads this week"
          value={t.downloadsThisWeek}
          hint={<WoW now={t.downloadsThisWeek} prev={t.downloadsPriorWeek} />}
          tileClass="bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
        />
        <StatTile
          icon={ShieldCheck}
          label="Pending review"
          value={t.pendingReviewCount}
          tileClass={
            t.pendingReviewCount > 0
              ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
              : "bg-secondary text-muted-foreground"
          }
          cardClass={t.pendingReviewCount > 0 ? "border-amber-200 dark:border-amber-800" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploads — last 14 days</CardTitle>
          <CardDescription>Documents created per day (deleted excluded).</CardDescription>
        </CardHeader>
        <CardContent className="h-56 sm:h-64">
          {data.uploadsLast14Days.length === 0 ? (
            <p className="text-muted-foreground text-sm">No uploads in the last 14 days.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.uploadsLast14Days}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="count" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Leaderboard
          title="Most viewed (30 days)"
          icon={<Eye className="h-4 w-4" />}
          rows={data.topDocumentsByViews}
          metricLabel="views"
        />
        <Leaderboard
          title="Most downloaded (30 days)"
          icon={<Download className="h-4 w-4" />}
          rows={data.topDocumentsByDownloads}
          metricLabel="downloads"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Active uploaders this week</CardTitle>
        </CardHeader>
        <CardContent>
          {data.activeUploaders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No uploads this week.</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.activeUploaders.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                >
                  <span className="font-medium text-sm truncate">{u.displayName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums ml-3 shrink-0">
                    {u.uploadCount} upload{u.uploadCount !== 1 ? "s" : ""}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <FolderTree className="h-4 w-4" /> Top categories
            </CardTitle>
            <CardDescription>Published documents grouped by category.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topCategories.length === 0 ? (
              <p className="text-muted-foreground text-sm">No categorised documents yet.</p>
            ) : (
              <ol className="divide-y divide-border/60">
                {data.topCategories.map((c, idx) => (
                  <li
                    key={c.categoryId}
                    className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm"
                  >
                    <span className="text-muted-foreground w-4 shrink-0 tabular-nums">{idx + 1}.</span>
                    <Link
                      href={`/browse?categoryId=${c.categoryId}`}
                      className="flex-1 truncate hover:underline hover:text-primary transition-colors"
                      title={c.name}
                    >
                      {c.name}
                    </Link>
                    <span className="text-muted-foreground tabular-nums shrink-0">
                      {c.documentCount}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Copy className="h-4 w-4" /> Possible duplicates
            </CardTitle>
            <CardDescription>Files that share identical content checksums.</CardDescription>
          </CardHeader>
          <CardContent>
            {data.duplicateGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm">No duplicate files detected.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {data.duplicateGroups.map((g) => (
                  <li
                    key={g.checksum}
                    className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm"
                  >
                    <Link
                      href={`/documents/${g.sampleDocumentId}`}
                      className="flex-1 truncate hover:underline hover:text-primary transition-colors"
                      title={g.sampleTitle}
                    >
                      {g.sampleTitle}
                    </Link>
                    <span className="inline-flex items-center rounded border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-xs text-amber-700 shrink-0 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-400">
                      {g.count} copies
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityFeed />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Leaderboard({
  title,
  icon,
  rows,
  metricLabel,
}: {
  title: string;
  icon: React.ReactNode;
  rows: Array<{ documentId: string; title: string; courseCode: string | null; count: number }>;
  metricLabel: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No data yet.</p>
        ) : (
          <ol className="divide-y divide-border/60">
            {rows.map((r, idx) => (
              <li key={r.documentId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm">
                <span className="text-muted-foreground w-4 shrink-0 tabular-nums">{idx + 1}.</span>
                <Link
                  href={`/documents/${r.documentId}`}
                  className="flex-1 truncate hover:underline hover:text-primary transition-colors"
                  title={r.title}
                >
                  {r.title}
                </Link>
                {r.courseCode && (
                  <span className="course-tag inline-flex items-center rounded border px-1.5 py-0.5 text-xs shrink-0">
                    {r.courseCode}
                  </span>
                )}
                <span className="text-muted-foreground tabular-nums shrink-0">
                  {r.count}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
