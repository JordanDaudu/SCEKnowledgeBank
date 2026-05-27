import { Link, useParams } from "wouter";
import { useGetCourseAnalytics } from "@workspace/api-client-react";
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
  Download,
  Eye,
  FileText,
  Loader2,
  MessageSquare,
  ShieldCheck,
} from "lucide-react";
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

export default function CourseAnalytics() {
  const { courseId } = useParams<{ courseId: string }>();
  const { data, isLoading, error } = useGetCourseAnalytics(courseId ?? "");

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
        <p className="text-rose-600">
          Failed to load course analytics. You may not have permission to view this course.
        </p>
      </div>
    );
  }

  const t = data.totals;

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-serif font-bold flex items-center gap-2">
          <BarChart3 className="h-6 w-6 text-primary" />
          <span className="course-tag inline-flex items-center rounded border px-2 py-0.5 text-base">
            {data.course.code}
          </span>
          analytics
        </h1>
        <p className="text-muted-foreground text-sm mt-1">
          {data.course.title} · updated {new Date(data.generatedAt).toLocaleTimeString()}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatTile
          icon={FileText}
          label="Documents"
          value={t.totalDocuments}
          tileClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 dark:text-indigo-400"
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
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Uploads — last 14 days</CardTitle>
          <CardDescription>Documents created per day in this course.</CardDescription>
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
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Eye className="h-4 w-4" /> Most viewed (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topDocumentsByViews.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
              <ol className="divide-y divide-border/60">
                {data.topDocumentsByViews.map((r, idx) => (
                  <li key={r.documentId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm">
                    <span className="text-muted-foreground w-4 shrink-0 tabular-nums">{idx + 1}.</span>
                    <Link
                      href={`/documents/${r.documentId}`}
                      className="flex-1 truncate hover:underline hover:text-primary transition-colors"
                      title={r.title}
                    >
                      {r.title}
                    </Link>
                    <span className="text-muted-foreground tabular-nums shrink-0">{r.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <Download className="h-4 w-4" /> Most downloaded (30 days)
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.topDocumentsByDownloads.length === 0 ? (
              <p className="text-muted-foreground text-sm">No data yet.</p>
            ) : (
              <ol className="divide-y divide-border/60">
                {data.topDocumentsByDownloads.map((r, idx) => (
                  <li key={r.documentId} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0 text-sm">
                    <span className="text-muted-foreground w-4 shrink-0 tabular-nums">{idx + 1}.</span>
                    <Link
                      href={`/documents/${r.documentId}`}
                      className="flex-1 truncate hover:underline hover:text-primary transition-colors"
                      title={r.title}
                    >
                      {r.title}
                    </Link>
                    <span className="text-muted-foreground tabular-nums shrink-0">{r.count}</span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-3">
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
    </div>
  );
}
