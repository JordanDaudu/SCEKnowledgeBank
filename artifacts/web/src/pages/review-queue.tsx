import { useState } from "react";
import { Link } from "wouter";
import {
  useListPendingReviewDocuments,
  useApproveDocument,
  useRejectDocument,
  getListPendingReviewDocumentsQueryKey,
  type Document,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { RejectDialog } from "@/components/document-detail/RejectDialog";
import { Check, X, FileText, ShieldCheck } from "lucide-react";

// Server clamps pageSize ≤100; 20 matches the notifications/list page
// pattern and keeps the queue scannable.
const PAGE_SIZE = 20;

export default function ReviewQueue() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [page, setPage] = useState(1);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const { data, isLoading, error } = useListPendingReviewDocuments({
    page,
    pageSize: PAGE_SIZE,
  });

  const approveMutation = useApproveDocument();
  const rejectMutation = useRejectDocument();

  // Re-fetch the queue itself (the just-actioned row drops out) plus
  // any per-doc cache so the detail page reflects the new status if
  // the reviewer navigates there next.
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: getListPendingReviewDocumentsQueryKey({
        page,
        pageSize: PAGE_SIZE,
      }),
    });

  const handleApprove = (id: string) => {
    approveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: "Approved" });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not approve" }),
      },
    );
  };

  const handleReject = (reason: string) => {
    if (!rejectingId) return;
    const id = rejectingId;
    rejectMutation.mutate(
      { id, data: { reason } },
      {
        onSuccess: () => {
          invalidate();
          setRejectingId(null);
          toast({ title: "Rejected" });
        },
        onError: () =>
          toast({ variant: "destructive", title: "Could not reject" }),
      },
    );
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-10 w-1/3" />
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (error) {
    // The hook surfaces 403 (not a reviewer) and 404 (feature off) the
    // same way — point users at where they came from rather than
    // showing an empty queue, which would be misleading.
    return (
      <div className="py-16 text-center">
        <h2 className="text-xl font-semibold mb-2">Review queue unavailable</h2>
        <p className="text-muted-foreground">
          You don&rsquo;t have access to the review queue.
        </p>
      </div>
    );
  }

  const items: Document[] = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="space-y-6" data-testid="review-queue">
      <div>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-amber-100 dark:bg-amber-950/30 shrink-0">
              <ShieldCheck className="h-5 w-5 text-amber-700 dark:text-amber-400" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Review Queue</h1>
          </div>
          {total > 0 && (
            <span className="text-sm font-medium text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/40 px-2.5 py-1 rounded-full tabular-nums">
              {total} pending
            </span>
          )}
        </div>
        <p className="text-muted-foreground mt-1 ml-[2.75rem]">
          Approve or reject student submissions before they appear publicly.
        </p>
      </div>

      {items.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center space-y-3">
            <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center">
              <Check className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
            </div>
            <h3 className="font-semibold text-foreground">Queue is clear</h3>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              All submissions have been reviewed. Check back later for new uploads.
            </p>
          </CardContent>
        </Card>
      ) : (
        items.map((doc) => {
          const submittedAt = doc.submittedForReviewAt ?? doc.createdAt;
          const busy =
            (approveMutation.isPending &&
              approveMutation.variables?.id === doc.id) ||
            (rejectMutation.isPending && rejectingId === doc.id);
          return (
            <Card key={doc.id} data-testid={`review-row-${doc.id}`}>
              <CardContent className="py-4 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-4">
                <div className="min-w-0 flex-1">
                  <Link
                    href={`/documents/${doc.id}`}
                    className="font-semibold hover:underline"
                  >
                    {doc.title}
                  </Link>
                  <div className="flex flex-wrap gap-2 mt-1.5 text-xs text-muted-foreground items-center">
                    {doc.course && (
                      <span className="course-tag inline-flex items-center rounded border px-2 py-0.5 text-xs">
                        {doc.course.code}
                      </span>
                    )}
                    <span>by {doc.uploader.displayName}</span>
                    <span>· {formatDateTime(submittedAt)}</span>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => handleApprove(doc.id)}
                    disabled={busy}
                    data-testid={`approve-${doc.id}`}
                    className="flex-1 sm:flex-none"
                  >
                    <Check className="mr-1 h-4 w-4" /> Approve
                  </Button>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() => setRejectingId(doc.id)}
                    disabled={busy}
                    data-testid={`reject-${doc.id}`}
                    className="flex-1 sm:flex-none"
                  >
                    <X className="mr-1 h-4 w-4" /> Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          );
        })
      )}

      {totalPages > 1 && (
        <div className="flex justify-center gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Previous
          </Button>
          <span className="text-sm self-center text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      )}

      <RejectDialog
        open={rejectingId !== null}
        onOpenChange={(v) => !v && setRejectingId(null)}
        onConfirm={handleReject}
        isSubmitting={rejectMutation.isPending}
      />
    </div>
  );
}
