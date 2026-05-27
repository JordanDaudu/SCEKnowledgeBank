/**
 * Sprint-3 M4: dedup lookup.
 *
 * The upload form calls this *before* shipping bytes so the user can
 * choose to abort when an identical file (same sha256) already lives
 * in the bank. We deliberately don't auto-block — the user can still
 * upload (the existing per-uploader dedup inside the upload pipeline
 * remains the hard guard), but the banner saves the round-trip in
 * the common case.
 *
 * Visibility scoping: the candidate list is filtered through
 * `permissions.canView` so a user never learns about the existence
 * of a private doc owned by someone else. If every candidate fails
 * the visibility predicate the result is `null` — same as "no
 * duplicate exists" from the client's perspective.
 */
import * as docsRepo from "../../repositories/documents.repo";
import * as permissions from "../permissions.service";
import type { AuthenticatedUser } from "../../middlewares/auth";

export interface DuplicateHit {
  documentId: string;
  title: string;
  uploaderDisplayName: string;
  uploadedAt: string;
}

export async function findVisibleDuplicateByChecksum(
  checksum: string,
  user: AuthenticatedUser,
): Promise<DuplicateHit | null> {
  if (!checksum) return null;
  const candidates = await docsRepo.findAliveDocumentsByChecksum(checksum);
  for (const c of candidates) {
    // Visibility check uses the same `canView` predicate the rest of
    // the read paths use — keeps the policy in exactly one place.
    // CRITICAL: pass the candidate's REAL visibility/status/courseId
    // (not hardcoded public/published) — otherwise this endpoint
    // would leak the existence of private or in-review docs uploaded
    // by other users whenever someone happened to upload the same
    // bytes.
    const visible = permissions.canView(
      {
        uploaderId: c.uploaderId,
        ownerId: c.ownerId,
        visibility: c.visibility,
        courseId: c.courseId,
        status: c.status,
      },
      user,
    );
    if (!visible) continue;
    return {
      documentId: c.documentId,
      title: c.documentTitle,
      uploaderDisplayName: c.uploaderDisplayName,
      uploadedAt: c.uploadedAt.toISOString(),
    };
  }
  return null;
}
