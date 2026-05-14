import { db, auditLogs } from "@workspace/db";
import { logger } from "./logger";

export async function audit(
  actorUserId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorUserId,
      action,
      entityType,
      entityId,
      metadata,
    });
  } catch (err) {
    logger.warn({ err, action, entityType, entityId }, "Audit log insert failed");
  }
}
