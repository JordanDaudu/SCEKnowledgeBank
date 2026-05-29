import { db, Prisma } from "@workspace/db";

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

export interface ActivityRow {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  actorId: string | null;
  actorDisplayName: string | null;
  documentTitle: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

export type ActivityScope =
  | { kind: "all" }
  | { kind: "self"; userId: string }
  | { kind: "lecturer"; userId: string; courseIds: string[] };

export interface ListActivityOptions {
  scope: ActivityScope;
  entityType?: string;
  limit: number;
  offset: number;
}

function buildScopeWhere(scope: ActivityScope): Prisma.Sql {
  if (scope.kind === "all") return Prisma.sql`TRUE`;
  if (scope.kind === "self") {
    return Prisma.sql`a.actor_user_id = ${scope.userId}::uuid`;
  }
  // lecturer: own actions OR document-entity rows whose document belongs
  // to a course they teach.
  if (scope.courseIds.length === 0) {
    return Prisma.sql`a.actor_user_id = ${scope.userId}::uuid`;
  }
  const courseList = Prisma.join(
    scope.courseIds.map((id) => Prisma.sql`${id}::uuid`),
  );
  return Prisma.sql`(
    a.actor_user_id = ${scope.userId}::uuid
    OR (
      a.entity_type = 'document'
      AND EXISTS (
        SELECT 1 FROM documents d
        WHERE d.id::text = a.entity_id
          AND d.course_id IN (${courseList})
      )
    )
  )`;
}

export async function listActivity(
  opts: ListActivityOptions,
): Promise<{ rows: ActivityRow[]; total: number }> {
  const scopeWhere = buildScopeWhere(opts.scope);
  const entityWhere = opts.entityType
    ? Prisma.sql`AND a.entity_type = ${opts.entityType}`
    : Prisma.empty;

  const rows = await db.$queryRaw<
    Array<{
      id: bigint;
      action: string;
      entity_type: string;
      entity_id: string;
      actor_id: string | null;
      actor_display_name: string | null;
      document_title: string | null;
      metadata: unknown;
      created_at: Date;
    }>
  >`
    SELECT a.id,
           a.action,
           a.entity_type,
           a.entity_id,
           a.actor_user_id::text AS actor_id,
           u.display_name AS actor_display_name,
           d.title AS document_title,
           a.metadata,
           a.created_at
    FROM audit_logs a
    LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN documents d
      ON a.entity_type = 'document' AND d.id::text = a.entity_id
    WHERE ${scopeWhere} ${entityWhere}
    ORDER BY a.created_at DESC, a.id DESC
    LIMIT ${opts.limit} OFFSET ${opts.offset}
  `;

  const countRows = await db.$queryRaw<Array<{ total: bigint }>>`
    SELECT COUNT(*)::bigint AS total
    FROM audit_logs a
    WHERE ${scopeWhere} ${entityWhere}
  `;

  return {
    rows: rows.map((r) => ({
      id: r.id.toString(),
      action: r.action,
      entityType: r.entity_type,
      entityId: r.entity_id,
      actorId: r.actor_id,
      actorDisplayName: r.actor_display_name,
      documentTitle: r.document_title,
      metadata: (r.metadata ?? {}) as Record<string, unknown>,
      createdAt: r.created_at,
    })),
    total: Number(countRows[0]?.total ?? 0),
  };
}
