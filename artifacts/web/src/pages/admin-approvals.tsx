import { useState } from "react";
import {
  useListPendingAdminApprovalDocuments,
  getListPendingAdminApprovalDocumentsQueryKey,
  useAdminApproveDocument,
  useRejectDocument,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import { ShieldCheck, Loader2 } from "lucide-react";
import ReviewQueue from "./review-queue";

export default function AdminApprovals() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const params = { page: 1, pageSize: 20 };
  const { data, isLoading } = useListPendingAdminApprovalDocuments(params, {
    query: { queryKey: getListPendingAdminApprovalDocumentsQueryKey(params) },
  });
  const approveMut = useAdminApproveDocument();
  const rejectMut = useRejectDocument();
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListPendingAdminApprovalDocumentsQueryKey(params) });

  const items = data?.items ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5"><ShieldCheck className="h-5 w-5 text-primary" /></div>
        <h1 className="font-serif text-3xl font-bold text-foreground">{t("admin.approvals.title")}</h1>
      </div>
      <p className="text-muted-foreground">{t("admin.approvals.subtitle")}</p>
      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : items.length > 0 ? (
        <ul className="space-y-3" data-testid="admin-approvals">
          {items.map((d) => (
            <li key={d.id}>
              <Card>
                <CardContent className="space-y-2 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/documents/${d.id}`} className="min-w-0 truncate font-medium hover:text-primary">
                      {d.title}
                    </Link>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={approveMut.isPending}
                        onClick={() =>
                          approveMut.mutate({ id: d.id }, {
                            onSuccess: () => { refresh(); toast({ title: t("admin.approvals.approvedPublished") }); },
                            onError: () => toast({ variant: "destructive", title: t("reviewQueue.approveFailed") }),
                          })
                        }
                        data-testid="admin-approve"
                      >
                        {approveMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("reviewQueue.approve")}
                      </Button>
                      <Button
                        variant="destructive"
                        size="sm"
                        onClick={() => { setRejectingId(d.id); setReason(""); }}
                        data-testid="admin-reject-open"
                      >
                        {t("reviewQueue.reject")}
                      </Button>
                    </div>
                  </div>
                  {rejectingId === d.id && (
                    <div className="space-y-2">
                      <Input
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        placeholder={t("admin.approvals.reasonPlaceholder")}
                        data-testid="admin-reject-reason"
                      />
                      <Button
                        variant="destructive"
                        size="sm"
                        disabled={!reason.trim() || rejectMut.isPending}
                        onClick={() =>
                          rejectMut.mutate({ id: d.id, data: { reason: reason.trim() } }, {
                            onSuccess: () => { setRejectingId(null); refresh(); toast({ title: t("reviewQueue.rejected") }); },
                            onError: () => toast({ variant: "destructive", title: t("reviewQueue.rejectFailed") }),
                          })
                        }
                        data-testid="admin-reject-confirm"
                      >
                        {t("admin.approvals.confirmRejection")}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-xl border border-dashed bg-card py-16 text-center">
          <p className="text-muted-foreground">{t("admin.approvals.empty")}</p>
        </div>
      )}

      {/* Student-submission review queue, appended so admins handle both
          their restricted-type sign-offs and standard review in one place. */}
      <div className="border-t pt-6" data-testid="approvals-review-section">
        <ReviewQueue embedded />
      </div>
    </div>
  );
}
