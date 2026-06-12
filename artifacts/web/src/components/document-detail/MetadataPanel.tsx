import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Download, User, Clock, Send, Check, X, Sparkles } from "lucide-react";
import { formatDateTime, formatVersion } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";
import { useTranslation } from "react-i18next";
import { StatusBadge } from "./StatusBadge";
import { ReputationBadge } from "@/components/reputation/ReputationBadge";
import { VerifiedBadge } from "@/components/reputation/VerifiedBadge";

interface Props {
  doc: DocumentDetailDto;
  canEdit: boolean;
  /**
   * Delete is now gated by a separate server-issued flag (Sprint-2
   * audit). Owners can always edit their docs but only owners/admins
   * can delete — these no longer collapse to a single boolean.
   */
  canDelete: boolean;
  onEdit: () => void;
  onToggleStatus: () => void;
  onDelete: () => void;
  onDownload: () => void;
  isStatusUpdating: boolean;
  isDeleting: boolean;
  // ── Review workflow (Sprint-3 M2). All optional so callers that
  // don't need it don't have to wire it up.
  onSubmitForReview?: () => void;
  onApprove?: () => void;
  onReject?: () => void;
  isReviewMutating?: boolean;
}

export default function MetadataPanel({
  doc,
  canEdit,
  canDelete,
  onEdit,
  onToggleStatus,
  onDelete,
  onDownload,
  isStatusUpdating,
  isDeleting,
  onSubmitForReview,
  onApprove,
  onReject,
  isReviewMutating,
}: Props) {
  const { t } = useTranslation();
  const canSubmitForReview = doc.permissions.canSubmitForReview;
  const canReview = doc.permissions.canReview;
  // Sprint-3 M2: hide the legacy publish/archive toggle while the doc
  // is in any review-machine state. Status transitions in that range
  // are owned exclusively by the review endpoints (the server PATCH
  // path also rejects those — this just keeps the UI honest).
  const inReviewState =
    doc.status === "pending_review" ||
    doc.status === "approved" ||
    doc.status === "rejected";
  const showToggleStatus = canEdit && !inReviewState;
  return (
    <div>
      <div className="flex justify-between items-start mb-2 gap-2">
        <div className="min-w-0">
          <h1 className="text-2xl font-serif font-bold">{doc.title}</h1>
          <span
            className="mt-1 inline-flex items-center rounded border px-1.5 py-0.5 text-xs tabular-nums text-muted-foreground"
            title={t("uploads.currentVersion")}
            data-testid="doc-version"
          >
            {formatVersion(doc.currentVersion)}
          </span>
        </div>
        {canEdit && (
          <div className="flex gap-1 ms-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              data-testid="edit-metadata-trigger"
              aria-label={t("documentDetail.editMetadata")}
            >
              <Edit className="h-4 w-4" />
            </Button>
            {showToggleStatus && (
              <Button variant="outline" size="sm" onClick={onToggleStatus} disabled={isStatusUpdating}>
                {doc.status === "published" ? t("documentDetail.archive") : t("documentDetail.publish")}
              </Button>
            )}
            {canDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting} aria-label={t("documentDetail.deleteAria")}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {doc.status !== "published" && <StatusBadge status={doc.status} />}
        {doc.course && <Badge variant="secondary" className="font-mono">{doc.course.code}</Badge>}
        <Badge variant="outline" className="capitalize">{formatMaterialType(doc.materialType)}</Badge>
        {doc.semester && <Badge variant="outline" className="capitalize">{doc.semester} {doc.academicYear}</Badge>}
        {doc.tags?.map((t) => <Badge key={t.id} variant="secondary" className="opacity-70">{t.name}</Badge>)}
      </div>
      {/* Sprint-3 M4: surface detected language + keywords from the
          primary file's extracted metadata. We pick the first file
          with intelligence data — most docs have only one file, and
          when there are multiple the primary is the natural choice. */}
      {(() => {
        const meta = doc.file?.extractedMetadata;
        if (!meta) return null;
        const hasIntel =
          !!meta.language || (meta.keywords && meta.keywords.length > 0);
        if (!hasIntel) return null;
        return (
          <div className="flex flex-wrap items-center gap-2 mb-4 text-xs text-muted-foreground" data-testid="document-intelligence">
            {meta.language && (
              <Badge variant="outline" className="uppercase" data-testid="document-language">
                {meta.language}
              </Badge>
            )}
            {meta.keywords?.slice(0, 8).map((kw) => (
              <Badge key={kw} variant="outline" className="font-normal" data-testid="document-keyword">
                {kw}
              </Badge>
            ))}
          </div>
        );
      })()}
      {doc.status === "rejected" && doc.reviewReason && (
        <div
          className="mb-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm"
          data-testid="reject-reason-display"
        >
          <div className="font-medium text-destructive mb-1">
            {doc.reviewer ? t("documentDetail.rejectedBy", { name: doc.reviewer.displayName }) : t("documentDetail.rejectedTitle")}
          </div>
          <div className="text-foreground/80 whitespace-pre-wrap">{doc.reviewReason}</div>
        </div>
      )}
      <p className="text-muted-foreground text-sm mb-6">{doc.description}</p>

      {doc.aiSummary ? (
        <div className="mt-3 mb-6" data-testid="ai-summary">
          <Badge variant="secondary" className="mb-1">
            <Sparkles className="h-3 w-3 me-1" />
            {t("aiSuggestions.aiSummaryBadge")}
          </Badge>
          <p className="text-sm text-muted-foreground">{doc.aiSummary}</p>
        </div>
      ) : null}

      {(canSubmitForReview || canReview) && (
        <div className="flex flex-wrap gap-2 mb-6">
          {canSubmitForReview && (
            <Button
              variant="default"
              size="sm"
              onClick={onSubmitForReview}
              disabled={isReviewMutating}
              data-testid="submit-for-review"
            >
              <Send className="me-2 h-4 w-4" /> {t("documentDetail.submitForReview")}
            </Button>
          )}
          {canReview && (
            <>
              <Button
                variant="default"
                size="sm"
                onClick={onApprove}
                disabled={isReviewMutating}
                data-testid="approve"
              >
                <Check className="me-2 h-4 w-4" /> {t("reviewQueue.approve")}
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={onReject}
                disabled={isReviewMutating}
                data-testid="reject"
              >
                <X className="me-2 h-4 w-4" /> {t("reviewQueue.reject")}
              </Button>
            </>
          )}
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground mb-6 pb-6 border-b">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="flex items-center gap-1">
              <User className="h-3 w-3" /> {doc.uploader.displayName}
              {doc.uploader.verified ? <VerifiedBadge /> : null}
            </span>
            {doc.uploader.reputation ? (
              <ReputationBadge
                level={doc.uploader.reputation.level}
                score={doc.uploader.reputation.score}
              />
            ) : null}
          </div>
          <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDateTime(doc.createdAt)}</div>
        </div>
      </div>

      <Button className="w-full mb-8" size="lg" onClick={onDownload}>
        <Download className="me-2 h-4 w-4" /> {t("documentDetail.downloadMaterial")}
      </Button>
    </div>
  );
}
