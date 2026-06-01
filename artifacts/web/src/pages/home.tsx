import {
  useListRecentDocuments,
  useListDocuments,
  useGetCurrentUser,
  useListPendingReviewDocuments,
  useSearchDocumentsV2,
  useGetMyStorageQuota,
  getSearchDocumentsV2QueryKey,
} from "@workspace/api-client-react";
import { SearchBar } from "@/components/search-bar";
import { RecentActivity } from "@/components/recent-activity";
import { TrendingDocuments } from "@/components/dashboard/trending-documents";
import { ContinueStudyingWidget } from "@/components/dashboard/continue-studying-widget";
import { AdminInsights } from "@/components/dashboard/admin-insights";
import DocumentCards from "@/components/browse/DocumentCards";
import { SectionHeader } from "@/components/section-header";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BookOpen,
  ChevronRight,
  Clock,
  Library,
  Search,
  Upload,
  MessageSquare,
  ShieldCheck,
  BarChart3,
  AlertCircle,
  XCircle,
  HardDrive,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { formatBytes } from "@/lib/format";

interface QuickAction {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  iconClass?: string;
}

function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <section aria-label="Quick actions">
      <div
        className={`grid gap-3 ${
          actions.length <= 3
            ? "grid-cols-1 sm:grid-cols-3"
            : actions.length === 4
            ? "grid-cols-2 sm:grid-cols-4"
            : "grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
        }`}
      >
        {actions.map(({ href, icon: Icon, label, description, iconClass }) => (
          <Link key={href} href={href}>
            <Card className="hover:border-primary/40 transition-all cursor-pointer h-full hover-elevate focus-within:ring-2 focus-within:ring-primary/40">
              <CardContent className="p-4 flex items-start gap-3">
                <div className={`p-2 rounded-md shrink-0 ${iconClass ?? "bg-primary/10 text-primary"}`}>
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm leading-tight">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2 hidden sm:block">
                    {description}
                  </div>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </section>
  );
}

function ReviewQueueSummary() {
  const { data, isLoading } = useListPendingReviewDocuments({ pageSize: 1 });
  const total = data?.total ?? 0;
  if (isLoading) return null;
  return (
    <section>
      <Link href="/review-queue">
        <Card
          className={`hover:border-primary/50 transition-colors cursor-pointer hover-elevate ${
            total > 0 ? "border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800" : ""
          }`}
        >
          <CardContent className="py-4 px-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div
                className={`p-2 rounded-md ${
                  total > 0
                    ? "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200"
                    : "bg-secondary text-muted-foreground"
                }`}
              >
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">
                  {total === 0
                    ? "Review queue is clear"
                    : `${total} submission${total === 1 ? "" : "s"} awaiting review`}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {total === 0
                    ? "No documents waiting for your approval."
                    : "Open the queue to approve or reject."}
                </div>
              </div>
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </Link>
    </section>
  );
}

function StorageCard() {
  const { data: quota } = useGetMyStorageQuota();
  if (!quota) return null;
  const pct =
    quota.quotaBytes > 0
      ? Math.min(100, (quota.usedBytes / quota.quotaBytes) * 100)
      : 0;
  const tone =
    pct >= 90
      ? "bg-destructive"
      : pct >= 70
      ? "bg-amber-500"
      : "bg-primary";
  return (
    <section>
      <Card>
        <CardContent className="py-4 px-5">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-md bg-secondary text-muted-foreground">
                <HardDrive className="h-5 w-5" />
              </div>
              <div>
                <div className="font-semibold text-sm">Your storage</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span data-testid="home-quota-used">{formatBytes(quota.usedBytes)}</span>
                  {" of "}
                  <span data-testid="home-quota-total">{formatBytes(quota.quotaBytes)}</span>
                  {" used"}
                </div>
              </div>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {formatBytes(quota.remainingBytes)} left
            </span>
          </div>
          <div className="h-2 w-full rounded-full bg-secondary overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${tone}`}
              style={{ width: `${pct}%` }}
              role="progressbar"
              aria-valuenow={Math.round(pct)}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  );
}

function MySubmissions({ userId }: { userId: string }) {
  const pendingParams = { uploaderId: userId, status: "pending_review", pageSize: 3 } as const;
  const rejectedParams = { uploaderId: userId, status: "rejected", pageSize: 3 } as const;
  const { data: pending } = useSearchDocumentsV2(pendingParams, {
    query: { queryKey: getSearchDocumentsV2QueryKey(pendingParams), staleTime: 60_000 },
  });
  const { data: rejected } = useSearchDocumentsV2(rejectedParams, {
    query: { queryKey: getSearchDocumentsV2QueryKey(rejectedParams), staleTime: 60_000 },
  });

  const pendingCount = pending?.total ?? 0;
  const rejectedCount = rejected?.total ?? 0;
  if (pendingCount === 0 && rejectedCount === 0) return null;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-serif font-bold flex items-center gap-2">
          <AlertCircle className="h-5 w-5 text-amber-500" />
          My submissions
        </h2>
        <Link
          href={`/browse?uploaderId=${userId}`}
          className="text-primary font-medium hover:underline flex items-center text-sm"
        >
          View all <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        {pendingCount > 0 && (
          <Link href={`/browse?uploaderId=${userId}&status=pending_review`}>
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-lg px-4 py-3 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors cursor-pointer">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">
                {pendingCount} pending review
              </span>
            </div>
          </Link>
        )}
        {rejectedCount > 0 && (
          <Link href={`/browse?uploaderId=${userId}&status=rejected`}>
            <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-4 py-3 hover:bg-destructive/15 transition-colors cursor-pointer">
              <XCircle className="h-4 w-4" />
              <span className="text-sm font-medium">
                {rejectedCount} rejected — action needed
              </span>
            </div>
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        Pending documents are only visible to you and your course lecturers until approved.
      </p>
    </section>
  );
}

function CardSkeleton() {
  return <Skeleton className="h-40 w-full rounded-xl" />;
}

export default function Home() {
  const { data: user } = useGetCurrentUser();
  const { data: recentDocs, isLoading: isLoadingRecent } = useListRecentDocuments({ limit: 4 });
  const { data: latestDocsPage, isLoading: isLoadingLatest } = useListDocuments({
    sort: "newest",
    pageSize: 4,
  });

  const roles = user?.roles ?? [];
  const isLecturerOrAdmin = roles.includes("lecturer") || roles.includes("admin");
  const isAdmin = roles.includes("admin");
  const isStudent = roles.includes("student") && !isLecturerOrAdmin;
  const canUpload = isLecturerOrAdmin || (user?.enrollments?.length ?? 0) > 0;

  const actions: QuickAction[] = user
    ? [
        {
          href: "/browse",
          icon: Search,
          label: "Browse",
          description: "Search every document with facets and snippets.",
          iconClass: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
        },
        ...(canUpload
          ? [
              {
                href: "/upload",
                icon: Upload,
                label: "Upload",
                description: isLecturerOrAdmin
                  ? "Publish or draft new course materials."
                  : "Submit materials for lecturer review.",
                iconClass: "bg-primary/10 text-primary",
              } as QuickAction,
            ]
          : []),
        {
          href: "/requests",
          icon: MessageSquare,
          label: "Requests",
          description: "Ask for missing materials or fulfil others.",
          iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
        },
        ...(isLecturerOrAdmin
          ? [
              {
                href: "/review-queue",
                icon: ShieldCheck,
                label: "Review queue",
                description: "Approve or reject pending submissions.",
                iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
              } as QuickAction,
            ]
          : []),
        ...(isAdmin
          ? [
              {
                href: "/admin/analytics",
                icon: BarChart3,
                label: "Analytics",
                description: "Corpus, contributor, and engagement stats.",
                iconClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
              } as QuickAction,
            ]
          : []),
      ]
    : [];

  return (
    <div className="space-y-8 pb-12">
      {/* Hero */}
      <section className="bg-gradient-to-b from-primary/8 via-primary/4 to-transparent -mx-4 px-4 py-8 sm:py-12 rounded-b-[2.5rem] border-b border-primary/10">
        <div className="max-w-3xl mx-auto text-center space-y-5">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-foreground tracking-tight">
            The Knowledge Bank
          </h1>
          <p className="text-base sm:text-lg text-muted-foreground max-w-2xl mx-auto">
            Discover, discuss, and request academic materials curated for your university coursework.
          </p>
          <div className="pt-2 max-w-2xl mx-auto">
            <SearchBar autoFocus />
          </div>
        </div>
      </section>

      <div className="max-w-6xl mx-auto">
        {/* ── Utility zone: tools + contextual status, kept visually light
              and tightly grouped directly under the hero. ──────────────── */}
        <div className="space-y-4">
          {user && <QuickActions actions={actions} />}

          {/* Student: pending/rejected submission alerts */}
          {user && isStudent && <MySubmissions userId={user.id} />}

          {/* Lecturer/admin: review queue summary */}
          {user && isLecturerOrAdmin && <ReviewQueueSummary />}

          {/* Admin: operational platform intelligence (Phase 8) */}
          {user && isAdmin && <AdminInsights />}

          {/* Storage usage — shown to anyone who can upload */}
          {user && canUpload && <StorageCard />}

          {/* Continue studying — Prep Hub progress (renders only when non-empty).
              Admins don't study (they moderate), so this is hidden for them. */}
          {user && !isAdmin && <ContinueStudyingWidget />}
        </div>

        {/* ── Discovery zone: the content the page is really about, set apart
              by larger top spacing and a clear header hierarchy. ────────── */}
        <div className="mt-12 space-y-10">
          {/* Continue reading — promoted primary band */}
          <section>
            <SectionHeader
              icon={Clock}
              title="Continue reading"
              subtitle="Pick up where you left off."
              size="lg"
            />
            {isLoadingRecent ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {Array(3)
                  .fill(0)
                  .map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
              </div>
            ) : recentDocs && recentDocs.length > 0 ? (
              <DocumentCards items={recentDocs} columns={3} />
            ) : (
              <div className="text-center py-12 bg-card rounded-xl border border-dashed">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">
                  Nothing here yet — open a document and it'll show up next time.
                </p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link href="/browse">Browse documents</Link>
                </Button>
              </div>
            )}
          </section>

          {/* Latest additions — secondary band */}
          <section>
            <SectionHeader
              icon={Library}
              title="Latest additions"
              actionHref="/browse"
            />
            {isLoadingLatest ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {Array(4)
                  .fill(0)
                  .map((_, i) => (
                    <CardSkeleton key={i} />
                  ))}
              </div>
            ) : latestDocsPage?.items && latestDocsPage.items.length > 0 ? (
              <DocumentCards items={latestDocsPage.items} />
            ) : (
              <div className="text-center py-12 bg-card rounded-xl border border-dashed">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">No documents have been added yet.</p>
              </div>
            )}
          </section>

          {/* Trending assets (Phase 8 / deferred Phase 2) — secondary band */}
          <TrendingDocuments />

          {/* Recent activity — admin only (activity logs live in Analytics) */}
          {user && isAdmin && <RecentActivity />}
        </div>
      </div>
    </div>
  );
}
