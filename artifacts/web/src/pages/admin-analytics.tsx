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
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

function WoW({ now, prev }: { now: number; prev: number }) {
  const { t } = useTranslation();
  if (prev === 0 && now === 0) return <span className="text-muted-foreground">—</span>;
  if (prev === 0) return <span className="text-emerald-600 font-medium">{t("admin.analytics.new")}</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const tone =
    pct > 0
      ? "text-emerald-600 font-medium"
      : pct < 0
      ? "text-rose-600 font-medium"
      : "text-muted-foreground";
  return (
    <span className={tone}>
      {t("admin.analytics.vsLastWeek", { pct: (pct > 0 ? "+" : "") + pct })}
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
  const { t } = useTranslation();
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
        <p className="text-rose-600">{t("admin.analytics.loadFailed")}</p>
      </div>
    );
  }

  const totals = data.totals;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" /> {t("admin.analytics.title")}
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            {t("admin.analytics.updated", { time: new Date(data.generatedAt).toLocaleTimeString() })}
          </p>
        </div>
        {totals.pendingReviewCount > 0 && (
          <Link href="/review-queue">
            <span className="inline-flex items-center gap-1.5 rounded border px-3 py-1.5 text-sm font-medium bg-amber-50 text-amber-700 border-amber-200 hover:bg-amber-100 transition-colors cursor-pointer">
              <ShieldCheck className="h-4 w-4" />
              {t("admin.analytics.pendingReview", { count: totals.pendingReviewCount })}
            </span>
          </Link>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("admin.analytics.overview")}</TabsTrigger>
          <TabsTrigger value="activity">{t("admin.analytics.activityLogs")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="space-y-6 mt-4">

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          icon={FileText}
          label={t("admin.analytics.documents")}
          value={totals.totalDocuments}
          tileClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400"
        />
        <StatTile
          icon={Users}
          label={t("admin.analytics.activeUsers")}
          value={totals.totalUsers}
          tileClass="bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 dark:text-emerald-400"
        />
        <StatTile
          icon={MessageSquare}
          label={t("admin.analytics.comments")}
          value={totals.totalComments}
          tileClass="bg-violet-100 text-violet-600 dark:bg-violet-950/40 dark:text-violet-400"
        />
        <StatTile
          icon={FileText}
          label={t("admin.analytics.uploadsThisWeek")}
          value={totals.uploadsThisWeek}
          tileClass="bg-primary/10 text-primary"
        />
        <StatTile
          icon={Eye}
          label={t("admin.analytics.viewsThisWeek")}
          value={totals.viewsThisWeek}
          hint={<WoW now={totals.viewsThisWeek} prev={totals.viewsPriorWeek} />}
          tileClass="bg-sky-100 text-sky-600 dark:bg-sky-950/40 dark:text-sky-400"
        />
        <StatTile
          icon={Download}
          label={t("admin.analytics.downloadsThisWeek")}
          value={totals.downloadsThisWeek}
          hint={<WoW now={totals.downloadsThisWeek} prev={totals.downloadsPriorWeek} />}
          tileClass="bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
        />
        <StatTile
          icon={ShieldCheck}
          label={t("admin.analytics.pendingReviewLabel")}
          value={totals.pendingReviewCount}
          tileClass={
            totals.pendingReviewCount > 0
              ? "bg-amber-100 text-amber-600 dark:bg-amber-950/40 dark:text-amber-400"
              : "bg-secondary text-muted-foreground"
          }
          cardClass={totals.pendingReviewCount > 0 ? "border-amber-200 dark:border-amber-800" : undefined}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("admin.analytics.uploads14")}</CardTitle>
          <CardDescription>{t("admin.analytics.uploads14Desc")}</CardDescription>
        </CardHeader>
        <CardContent className="h-56 sm:h-64">
          {data.uploadsLast14Days.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("admin.analytics.noUploads14")}</p>
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
          title={t("admin.analytics.mostViewed30")}
          icon={<Eye className="h-4 w-4" />}
          rows={data.topDocumentsByViews}
          metricLabel="views"
        />
        <Leaderboard
          title={t("admin.analytics.mostDownloaded30")}
          icon={<Download className="h-4 w-4" />}
          rows={data.topDocumentsByDownloads}
          metricLabel="downloads"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("admin.analytics.activeUploaders")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.activeUploaders.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t("admin.analytics.noUploadsWeek")}</p>
          ) : (
            <ul className="divide-y divide-border/60">
              {data.activeUploaders.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center justify-between py-2 first:pt-0 last:pb-0"
                >
                  <span className="font-medium text-sm truncate">{u.displayName}</span>
                  <span className="text-xs text-muted-foreground tabular-nums ms-3 shrink-0">
                    {t("admin.analytics.uploadCount", { count: u.uploadCount })}
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
              <FolderTree className="h-4 w-4" /> {t("admin.analytics.topCategories")}
            </CardTitle>
            <CardDescription>{t("admin.analytics.topCategoriesDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.topCategories.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("admin.analytics.noCategorised")}</p>
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
              <Copy className="h-4 w-4" /> {t("admin.analytics.possibleDuplicates")}
            </CardTitle>
            <CardDescription>{t("admin.analytics.possibleDuplicatesDesc")}</CardDescription>
          </CardHeader>
          <CardContent>
            {data.duplicateGroups.length === 0 ? (
              <p className="text-muted-foreground text-sm">{t("admin.analytics.noDuplicates")}</p>
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
                      {t("admin.analytics.copies", { count: g.count })}
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
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("admin.analytics.noData")}</p>
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
