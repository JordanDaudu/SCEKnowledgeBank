import {
  useListRecentDocuments,
  useListDocuments,
  useGetCurrentUser,
  type Document,
} from "@workspace/api-client-react";
import { SearchBar } from "@/components/search-bar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  BookOpen,
  FileText,
  ChevronRight,
  Clock,
  Library,
  Search,
  Upload,
  MessageSquare,
  ShieldCheck,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { formatDateTime } from "@/lib/format";
import { Skeleton } from "@/components/ui/skeleton";

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "bg-muted text-muted-foreground" },
  pending_review: {
    label: "Pending review",
    className: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  },
  rejected: {
    label: "Rejected",
    className: "bg-destructive/15 text-destructive",
  },
  approved: {
    label: "Approved",
    className: "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  },
  archived: { label: "Archived", className: "bg-muted text-muted-foreground" },
};

function renderDocumentCard(doc: Document) {
  const badge = doc.status && doc.status !== "published" ? STATUS_BADGE[doc.status] : null;
  return (
    <Link key={doc.id} href={`/documents/${doc.id}`}>
      <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate focus-within:ring-2 focus-within:ring-primary/40">
        <CardContent className="p-5 flex flex-col h-full">
          <div className="flex justify-between items-start mb-3 gap-2">
            <div className="bg-secondary p-2 rounded-md text-primary shrink-0">
              <FileText className="h-5 w-5" />
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {badge && (
                <span
                  className={`text-[10px] font-medium uppercase tracking-wide px-2 py-1 rounded ${badge.className}`}
                >
                  {badge.label}
                </span>
              )}
              {doc.course && (
                <span className="text-xs font-mono bg-secondary/50 px-2 py-1 rounded text-muted-foreground">
                  {doc.course.code}
                </span>
              )}
            </div>
          </div>
          <h3 className="font-serif font-semibold text-lg line-clamp-2 mb-1">{doc.title}</h3>
          <div className="text-sm text-muted-foreground mt-auto flex justify-between items-center pt-4">
            <span className="capitalize">{doc.materialType.replace(/[-_]/g, " ")}</span>
            <span className="text-xs">{formatDateTime(doc.createdAt)}</span>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

interface QuickAction {
  href: string;
  icon: LucideIcon;
  label: string;
  description: string;
}

function QuickActions({ actions }: { actions: QuickAction[] }) {
  if (actions.length === 0) return null;
  return (
    <section aria-label="Quick actions">
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        {actions.map(({ href, icon: Icon, label, description }) => (
          <Link key={href} href={href}>
            <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate focus-within:ring-2 focus-within:ring-primary/40">
              <CardContent className="p-4 flex items-start gap-3">
                <div className="bg-primary/10 text-primary p-2 rounded-md shrink-0">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <div className="font-medium text-sm leading-tight">{label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
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
  const canUpload =
    isLecturerOrAdmin || (user?.enrollments?.length ?? 0) > 0;

  const actions: QuickAction[] = [
    { href: "/browse", icon: Search, label: "Browse", description: "Search every document with facets and snippets." },
    ...(canUpload
      ? [
          {
            href: "/upload",
            icon: Upload,
            label: "Upload",
            description: isLecturerOrAdmin
              ? "Publish or draft new course materials."
              : "Submit materials for lecturer review.",
          } as QuickAction,
        ]
      : []),
    { href: "/requests", icon: MessageSquare, label: "Requests", description: "Ask for missing materials or fulfil others." },
    ...(isLecturerOrAdmin
      ? [
          {
            href: "/review-queue",
            icon: ShieldCheck,
            label: "Review queue",
            description: "Approve or reject pending submissions.",
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
          } as QuickAction,
        ]
      : []),
  ];

  return (
    <div className="space-y-10 pb-12">
      <section className="bg-primary/5 -mx-4 px-4 py-10 sm:py-14 rounded-b-[2.5rem] border-b border-primary/10">
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
          {user && !canUpload && (
            <p className="text-xs text-muted-foreground">
              <Badge variant="outline" className="mr-2">Read-only</Badge>
              You aren't enrolled in any course yet, so uploads are disabled until a lecturer or admin enrolls you.
            </p>
          )}
        </div>
      </section>

      <div className="max-w-6xl mx-auto space-y-10">
        {user && <QuickActions actions={actions} />}

        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
              <Clock className="h-6 w-6 text-primary" />
              Continue reading
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {isLoadingRecent ? (
              Array(4)
                .fill(0)
                .map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
            ) : recentDocs && recentDocs.length > 0 ? (
              recentDocs.map(renderDocumentCard)
            ) : (
              <div className="col-span-full text-center py-12 bg-card rounded-xl border border-dashed">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">
                  Nothing here yet — open a document and it'll show up next time.
                </p>
              </div>
            )}
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-2xl font-serif font-bold flex items-center gap-2">
              <Library className="h-6 w-6 text-primary" />
              Latest additions
            </h2>
            <Link
              href="/browse"
              className="text-primary font-medium hover:underline flex items-center text-sm"
            >
              View all <ChevronRight className="h-4 w-4" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {isLoadingLatest ? (
              Array(4)
                .fill(0)
                .map((_, i) => <Skeleton key={i} className="h-40 w-full rounded-xl" />)
            ) : latestDocsPage?.items && latestDocsPage.items.length > 0 ? (
              latestDocsPage.items.map(renderDocumentCard)
            ) : (
              <div className="col-span-full text-center py-12 bg-card rounded-xl border border-dashed">
                <BookOpen className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-50" />
                <p className="text-muted-foreground">No documents have been added yet.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
