import { Link } from "wouter";
import { useGetAdminAnalyticsOverview } from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
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
  Users,
} from "lucide-react";

function WoW({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return <span className="text-muted-foreground">—</span>;
  if (prev === 0) return <span className="text-emerald-600">new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  const tone =
    pct > 0 ? "text-emerald-600" : pct < 0 ? "text-rose-600" : "text-muted-foreground";
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
}: {
  icon: typeof FileText;
  label: string;
  value: number | string;
  hint?: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className="text-3xl font-semibold mt-1">{value}</p>
            {hint && <p className="text-xs mt-1">{hint}</p>}
          </div>
          <Icon className="h-8 w-8 text-muted-foreground/60" />
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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart3 className="h-6 w-6" /> Workspace analytics
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Read-only snapshot. Updated {new Date(data.generatedAt).toLocaleTimeString()}.
          </p>
        </div>
        {t.pendingReviewCount > 0 && (
          <Link href="/review-queue">
            <Badge variant="secondary" className="cursor-pointer">
              <ShieldCheck className="h-3.5 w-3.5 mr-1" />
              {t.pendingReviewCount} pending review
            </Badge>
          </Link>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatTile icon={FileText} label="Documents" value={t.totalDocuments} />
        <StatTile icon={Users} label="Active users" value={t.totalUsers} />
        <StatTile icon={MessageSquare} label="Comments" value={t.totalComments} />
        <StatTile
          icon={FileText}
          label="Uploads this week"
          value={t.uploadsThisWeek}
        />
        <StatTile
          icon={Eye}
          label="Views this week"
          value={t.viewsThisWeek}
          hint={<WoW now={t.viewsThisWeek} prev={t.viewsPriorWeek} />}
        />
        <StatTile
          icon={Download}
          label="Downloads this week"
          value={t.downloadsThisWeek}
          hint={<WoW now={t.downloadsThisWeek} prev={t.downloadsPriorWeek} />}
        />
        <StatTile
          icon={ShieldCheck}
          label="Pending review"
          value={t.pendingReviewCount}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Uploads — last 14 days</CardTitle>
          <CardDescription>Documents created per day (deleted excluded).</CardDescription>
        </CardHeader>
        <CardContent className="h-64">
          {data.uploadsLast14Days.length === 0 ? (
            <p className="text-muted-foreground text-sm">No uploads in the last 14 days.</p>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.uploadsLast14Days}>
                <CartesianGrid strokeDasharray="3 3" />
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
          <CardTitle>Active uploaders this week</CardTitle>
        </CardHeader>
        <CardContent>
          {data.activeUploaders.length === 0 ? (
            <p className="text-muted-foreground text-sm">No uploads this week.</p>
          ) : (
            <ul className="space-y-2">
              {data.activeUploaders.map((u) => (
                <li
                  key={u.userId}
                  className="flex items-center justify-between border-b last:border-0 pb-2 last:pb-0"
                >
                  <span className="font-medium text-sm">{u.displayName}</span>
                  <Badge variant="secondary">{u.uploadCount}</Badge>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
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
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          {icon} {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">No data yet.</p>
        ) : (
          <ol className="space-y-2">
            {rows.map((r, idx) => (
              <li key={r.documentId} className="flex items-center gap-3 text-sm">
                <span className="text-muted-foreground w-4">{idx + 1}.</span>
                <Link
                  href={`/documents/${r.documentId}`}
                  className="flex-1 truncate hover:underline"
                >
                  {r.title}
                </Link>
                {r.courseCode && (
                  <Badge variant="outline" className="text-xs">
                    {r.courseCode}
                  </Badge>
                )}
                <span className="text-muted-foreground tabular-nums">
                  {r.count} {metricLabel}
                </span>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
