import type { DocumentDetail as DocumentDetailDto } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Edit, Trash2, Download, User, Clock } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";

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
}: Props) {
  return (
    <div>
      <div className="flex justify-between items-start mb-2 gap-2">
        <h1 className="text-2xl font-serif font-bold">{doc.title}</h1>
        {canEdit && (
          <div className="flex gap-1 ml-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={onEdit}
              data-testid="edit-metadata-trigger"
              aria-label="Edit metadata"
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={onToggleStatus} disabled={isStatusUpdating}>
              {doc.status === "published" ? "Archive" : "Publish"}
            </Button>
            {canDelete && (
              <Button variant="destructive" size="sm" onClick={onDelete} disabled={isDeleting} aria-label="Delete">
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-2 mb-4">
        {doc.status !== "published" && <Badge variant="destructive">{doc.status}</Badge>}
        {doc.course && <Badge variant="secondary" className="font-mono">{doc.course.code}</Badge>}
        <Badge variant="outline" className="capitalize">{formatMaterialType(doc.materialType)}</Badge>
        {doc.semester && <Badge variant="outline" className="capitalize">{doc.semester} {doc.academicYear}</Badge>}
        {doc.tags?.map((t) => <Badge key={t.id} variant="secondary" className="opacity-70">{t.name}</Badge>)}
      </div>
      <p className="text-muted-foreground text-sm mb-6">{doc.description}</p>

      <div className="flex items-center justify-between text-sm text-muted-foreground mb-6 pb-6 border-b">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1"><User className="h-3 w-3" /> {doc.uploader.displayName}</div>
          <div className="flex items-center gap-1"><Clock className="h-3 w-3" /> {formatDateTime(doc.createdAt)}</div>
        </div>
      </div>

      <Button className="w-full mb-8" size="lg" onClick={onDownload}>
        <Download className="mr-2 h-4 w-4" /> Download Material
      </Button>
    </div>
  );
}
