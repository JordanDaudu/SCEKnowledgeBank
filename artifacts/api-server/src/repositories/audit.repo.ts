import { db } from "@workspace/db";

export async function insertAuditLog(values: {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await db.auditLog.create({
    data: {
      actorUserId: values.actorUserId,
      action: values.action,
      entityType: values.entityType,
      entityId: values.entityId,
      metadata: values.metadata as object,
    },
  });
}
