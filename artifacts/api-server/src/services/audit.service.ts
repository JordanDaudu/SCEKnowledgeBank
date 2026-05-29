import * as auditRepo from "../repositories/audit.repo";
import { logger } from "../lib/logger";
import type { AuthenticatedUser } from "../middlewares/auth";

export async function record(
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await auditRepo.insertAuditLog({
      actorUserId,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    logger.warn(
      { err, action, entityType, entityId },
      "Audit log insert failed",
    );
  }
}

// ─── Activity feed (Sprint-3 refinement) ────────────────────────────
//
// Read-side over the existing audit_logs table. Role-scoped:
//   - admin    → every recorded action
//   - lecturer → their own actions + document actions in courses they
//                teach
//   - student  → their own actions only
//
// No new writes — this is purely a projection of the audit trail.

export interface ActivityEntry {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actor: { id: string; displayName: string } | null;
  target: { title: string } | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityPage {
  items: ActivityEntry[];
  total: number;
  page: number;
  pageSize: number;
}

function lecturerCourseIds(user: AuthenticatedUser): string[] {
  return user.enrollments
    .filter((e) => e.roleInCourse === "lecturer")
    .map((e) => e.courseId);
}

export async function listActivity(
  user: AuthenticatedUser,
  opts: {
    page?: number;
    pageSize?: number;
    entityType?: string;
    /** Restrict to the current user's own actions (per-user history). */
    mine?: boolean;
  } = {},
): Promise<ActivityPage> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 20));

  const isAdmin = user.roles.includes("admin");
  const isLecturer = user.roles.includes("lecturer");
  // `mine` forces the self scope (actor = me) regardless of role, giving
  // every user a "my activity" history. Otherwise role-scoped as before.
  const scope: auditRepo.ActivityScope = opts.mine
    ? { kind: "self", userId: user.id }
    : isAdmin
      ? { kind: "all" }
      : isLecturer
        ? { kind: "lecturer", userId: user.id, courseIds: lecturerCourseIds(user) }
        : { kind: "self", userId: user.id };

  const { rows, total } = await auditRepo.listActivity({
    scope,
    entityType: opts.entityType,
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return {
    items: rows.map((r) => ({
      id: r.id,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      actor:
        r.actorId && r.actorDisplayName
          ? { id: r.actorId, displayName: r.actorDisplayName }
          : null,
      target: r.documentTitle ? { title: r.documentTitle } : null,
      metadata: r.metadata,
      createdAt: r.createdAt.toISOString(),
    })),
    total,
    page,
    pageSize,
  };
}
