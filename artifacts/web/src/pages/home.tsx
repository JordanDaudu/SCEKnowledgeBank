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
import { ReputationHomeWidget } from "@/components/dashboard/reputation-widget";
import { AdminInsights } from "@/components/dashboard/admin-insights";
import { StatsBand } from "@/components/dashboard/stats-band";
import { Reveal } from "@/components/reveal";
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
import { useTranslation } from "react-i18next";
import { formatBytes } from "@/lib/format";

interface QuickAction {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
  iconClass?: string;
}

function QuickActions({ actions }: { actions: QuickAction[] }) {
  const { t } = useTranslation();
  if (actions.length === 0) return null;
  return (
    <section aria-label={t("home.quickActions")}>
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
  const { t } = useTranslation();
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
                    ? t("home.reviewClear")
                    : t("home.reviewAwaiting", { count: total })}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {total === 0
                    ? t("home.reviewClearDesc")
                    : t("home.reviewOpenDesc")}
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
  const { t } = useTranslation();
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
                <div className="font-semibold text-sm">{t("home.yourStorage")}</div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  <span data-testid="home-quota-used">{formatBytes(quota.usedBytes)}</span>
                  {" "}{t("home.storageOf")}{" "}
                  <span data-testid="home-quota-total">{formatBytes(quota.quotaBytes)}</span>
                  {" "}{t("home.storageUsedSuffix")}
                </div>
              </div>
            </div>
            <span className="text-xs text-muted-foreground tabular-nums shrink-0">
              {t("home.storageLeft", { left: formatBytes(quota.remainingBytes) })}
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
  const { t } = useTranslation();
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
          {t("home.mySubmissions")}
        </h2>
        <Link
          href={`/browse?uploaderId=${userId}`}
          className="text-primary font-medium hover:underline flex items-center text-sm"
        >
          {t("home.viewAll")} <ChevronRight className="h-4 w-4" />
        </Link>
      </div>
      <div className="flex flex-wrap gap-3">
        {pendingCount > 0 && (
          <Link href={`/browse?uploaderId=${userId}&status=pending_review`}>
            <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200 rounded-lg px-4 py-3 hover:bg-amber-100 dark:hover:bg-amber-950/40 transition-colors cursor-pointer">
              <Clock className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("home.pendingReview", { count: pendingCount })}
              </span>
            </div>
          </Link>
        )}
        {rejectedCount > 0 && (
          <Link href={`/browse?uploaderId=${userId}&status=rejected`}>
            <div className="flex items-center gap-2 bg-destructive/10 border border-destructive/20 text-destructive rounded-lg px-4 py-3 hover:bg-destructive/15 transition-colors cursor-pointer">
              <XCircle className="h-4 w-4" />
              <span className="text-sm font-medium">
                {t("home.rejectedAction", { count: rejectedCount })}
              </span>
            </div>
          </Link>
        )}
      </div>
      <p className="text-xs text-muted-foreground mt-2">
        {t("home.pendingNote")}
      </p>
    </section>
  );
}

function CardSkeleton() {
  return <Skeleton className="h-40 w-full rounded-xl" />;
}

export default function Home() {
  const { t } = useTranslation();
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
          label: t("home.browse"),
          description: t("home.browseDesc"),
          iconClass: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
        },
        ...(canUpload && !isAdmin
          ? [
              {
                href: "/upload",
                icon: Upload,
                label: t("home.upload"),
                description: isLecturerOrAdmin
                  ? t("home.uploadDescLecturer")
                  : t("home.uploadDescStudent"),
                iconClass: "bg-primary/10 text-primary",
              } as QuickAction,
            ]
          : []),
        {
          href: "/requests",
          icon: MessageSquare,
          label: t("home.requests"),
          description: t("home.requestsDesc"),
          iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
        },
        ...(isLecturerOrAdmin
          ? [
              {
                // Admins review inside the combined Admin Approvals page.
                href: isAdmin ? "/admin/approvals" : "/review-queue",
                icon: ShieldCheck,
                label: isAdmin ? t("home.approvalsReview") : t("home.reviewQueue"),
                description: isAdmin
                  ? t("home.approvalsDescAdmin")
                  : t("home.approvalsDescLecturer"),
                iconClass: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400",
              } as QuickAction,
            ]
          : []),
        ...(isAdmin
          ? [
              {
                href: "/admin/analytics",
                icon: BarChart3,
                label: t("home.analytics"),
                description: t("home.analyticsDesc"),
                iconClass: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-400",
              } as QuickAction,
            ]
          : []),
      ]
    : [];

  return (
    <div className="space-y-8 pb-12">
      {/* Hero — frosted glass panel floating over the low-poly knowledge
          banner, with a one-time "idea ignition" reveal (see .hero-knowledge
          in index.css). All photo/glow/spark layers are decorative. */}
      <section className="hero-knowledge relative isolate overflow-hidden -mx-4 px-4 py-14 sm:py-20 rounded-b-[2.5rem] border-b border-white/10">
        <div aria-hidden="true" className="hero-knowledge__photo pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="hero-knowledge__dim pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="hero-knowledge__glow pointer-events-none absolute inset-0" />
        <div aria-hidden="true" className="hero-knowledge__sparks pointer-events-none absolute inset-0" />

        <div className="hero-knowledge__card relative z-10 max-w-2xl mx-auto text-center space-y-5 rounded-3xl border border-white/15 bg-white/[0.06] px-6 py-8 sm:px-10 sm:py-10 backdrop-blur-xl shadow-[0_12px_48px_-12px_rgba(0,0,0,0.65)]">
          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white tracking-tight drop-shadow-[0_2px_12px_rgba(0,0,0,0.5)]">
            {t("home.heroTitle")}
          </h1>
          <p className="text-base sm:text-lg text-blue-100/85 max-w-2xl mx-auto">
            {t("home.heroSubtitle")}
          </p>
          <div className="pt-2 max-w-2xl mx-auto">
            <SearchBar autoFocus className="hero-search" />
          </div>
        </div>
      </section>

      {/* Light-thread seam stitching the dark hero to the light page, with the
          living stats band showing the platform's scale just beneath it. */}
      <div className="max-w-6xl mx-auto px-4 -mt-3">
        <div aria-hidden="true" className="hero-seam" />
        <div className="mt-5">
          <StatsBand />
        </div>
      </div>

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

          {/* Storage usage — shown to non-admin uploaders. Admins have no
              quota (unlimited), so the bar would just read multiple EB free. */}
          {user && canUpload && !isAdmin && <StorageCard />}

          {/* Continue studying — Prep Hub progress (renders only when non-empty).
              Admins don't study (they moderate), so this is hidden for them. */}
          {user && !isAdmin && <ContinueStudyingWidget />}

          {/* Reputation snapshot + top contributors. */}
          {user && <ReputationHomeWidget userId={user.id} />}
        </div>

        {/* ── Discovery zone: the content the page is really about, set apart
              by larger top spacing and a clear header hierarchy. ────────── */}
        <div className="mt-12 space-y-10">
          {/* Continue reading — promoted primary band */}
          <Reveal>
          <section>
            <SectionHeader
              icon={Clock}
              title={t("home.continueReading")}
              subtitle={t("home.continueReadingSubtitle")}
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
                  {t("home.continueReadingEmpty")}
                </p>
                <Button variant="outline" size="sm" className="mt-4" asChild>
                  <Link href="/browse">{t("home.browseDocuments")}</Link>
                </Button>
              </div>
            )}
          </section>
          </Reveal>

          {/* Latest additions — secondary band */}
          <Reveal>
          <section>
            <SectionHeader
              icon={Library}
              title={t("home.latestAdditions")}
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
                <p className="text-muted-foreground">{t("home.noDocuments")}</p>
              </div>
            )}
          </section>
          </Reveal>

          {/* Trending assets (Phase 8 / deferred Phase 2) — secondary band */}
          <Reveal>
            <TrendingDocuments />
          </Reveal>

          {/* Recent activity — admin only (activity logs live in Analytics) */}
          {user && isAdmin && (
            <Reveal>
              <RecentActivity />
            </Reveal>
          )}
        </div>
      </div>
    </div>
  );
}
