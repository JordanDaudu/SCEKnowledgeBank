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
import { Check, X, FileText } from "lucide-react";

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
    <div className="space-y-4" data-testid="review-queue">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-serif font-bold">Review queue</h1>
        <span className="text-sm text-muted-foreground">
          {total} pending
        </span>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="h-8 w-8 mx-auto mb-2 opacity-60" />
            Nothing waiting for review.
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
                  <div className="flex flex-wrap gap-2 mt-1 text-xs text-muted-foreground">
                    {doc.course && (
                      <Badge variant="secondary" className="font-mono">
                        {doc.course.code}
                      </Badge>
                    )}
                    <span>by {doc.uploader.displayName}</span>
                    <span>· submitted {formatDateTime(submittedAt)}</span>
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
