import * as auditRepo from "../repositories/audit.repo";
import { logger } from "../lib/logger";

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
