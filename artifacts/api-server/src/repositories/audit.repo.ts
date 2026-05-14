import { db, auditLogs } from "@workspace/db";

export async function insertAuditLog(values: {
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
}): Promise<void> {
  await db.insert(auditLogs).values(values);
}
