import { Router, type IRouter } from "express";
import { and, desc, eq, isNull, inArray } from "drizzle-orm";
import {
  db,
  materialRequests,
  requestVotes,
  documents,
} from "@workspace/db";
import {
  CreateRequestBody,
  ListRequestsQueryParams,
  UpdateRequestBody,
  UpdateRequestParams,
  VoteRequestParams,
} from "@workspace/api-zod";
import { requireAuth, isAdmin, isLecturerOrAdmin } from "../middlewares/auth";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { loadCourses, loadUserSummaries } from "../lib/mappers";
import { audit } from "../lib/audit";

const router: IRouter = Router();

async function buildRequestDTO(
  ids: string[],
  currentUserId: string,
): Promise<unknown[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select()
    .from(materialRequests)
    .where(
      and(
        isNull(materialRequests.deletedAt),
        inArray(materialRequests.id, ids),
      ),
    );
  const filteredById = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids
    .map((id) => filteredById.get(id))
    .filter((r): r is (typeof rows)[number] => !!r);

  const [courses, users, voteRows] = await Promise.all([
    loadCourses(ordered.map((r) => r.courseId)),
    loadUserSummaries(ordered.map((r) => r.requestedBy)),
    db
      .select({
        requestId: requestVotes.requestId,
        userId: requestVotes.userId,
      })
      .from(requestVotes),
  ]);
  const voteCount = new Map<string, number>();
  const hasVotedSet = new Set<string>();
  for (const v of voteRows) {
    voteCount.set(v.requestId, (voteCount.get(v.requestId) ?? 0) + 1);
    if (v.userId === currentUserId) hasVotedSet.add(v.requestId);
  }
  return ordered.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? "",
    status: r.status,
    ...(r.courseId && courses.has(r.courseId)
      ? { course: courses.get(r.courseId) }
      : {}),
    requestedBy: users.get(r.requestedBy),
    voteCount: voteCount.get(r.id) ?? 0,
    hasVoted: hasVotedSet.has(r.id),
    ...(r.fulfillingDocumentId
      ? { fulfillingDocumentId: r.fulfillingDocumentId }
      : {}),
    createdAt: r.createdAt.toISOString(),
  }));
}

router.get("/requests", requireAuth, async (req, res, next) => {
  try {
    const q = ListRequestsQueryParams.parse(req.query);
    const filters = [isNull(materialRequests.deletedAt)];
    if (q.status) filters.push(eq(materialRequests.status, q.status));
    if (q.courseId) filters.push(eq(materialRequests.courseId, q.courseId));
    const rows = await db
      .select({ id: materialRequests.id })
      .from(materialRequests)
      .where(and(...filters))
      .orderBy(desc(materialRequests.createdAt));
    const dto = await buildRequestDTO(
      rows.map((r) => r.id),
      req.authUser!.id,
    );
    res.json(dto);
  } catch (err) {
    next(err);
  }
});

router.post("/requests", requireAuth, async (req, res, next) => {
  try {
    const body = CreateRequestBody.parse(req.body);
    const values: typeof materialRequests.$inferInsert = {
      title: body.title,
      description: body.description ?? "",
      requestedBy: req.authUser!.id,
    };
    if (body.courseId) values.courseId = body.courseId;
    const inserted = await db
      .insert(materialRequests)
      .values(values)
      .returning();
    await audit(
      req.authUser!.id,
      "request.create",
      "material_request",
      inserted[0].id,
    );
    const dto = await buildRequestDTO([inserted[0].id], req.authUser!.id);
    res.status(201).json(dto[0]);
  } catch (err) {
    next(err);
  }
});

router.patch("/requests/:id", requireAuth, async (req, res, next) => {
  try {
    const { id } = UpdateRequestParams.parse(req.params);
    const body = UpdateRequestBody.parse(req.body);
    const found = await db
      .select()
      .from(materialRequests)
      .where(
        and(eq(materialRequests.id, id), isNull(materialRequests.deletedAt)),
      )
      .limit(1);
    const r = found[0];
    if (!r) throw notFound("Request not found");
    const isOwner = r.requestedBy === req.authUser!.id;
    // Status/fulfillment changes: author or admin only.
    // Other edits (title/description): author or admin only.
    const wantsStatusChange =
      body.status !== undefined || body.fulfillingDocumentId !== undefined;
    if (wantsStatusChange && !isOwner && !isAdmin(req.authUser)) {
      throw forbidden("Only the request author or an admin can update status");
    }
    if (!isOwner && !isAdmin(req.authUser)) {
      throw forbidden("Cannot edit this request");
    }
    if (body.fulfillingDocumentId) {
      const doc = await db
        .select({ id: documents.id })
        .from(documents)
        .where(
          and(
            eq(documents.id, body.fulfillingDocumentId),
            isNull(documents.deletedAt),
          ),
        )
        .limit(1);
      if (!doc[0]) throw badRequest("Fulfilling document not found");
    }
    const patch: Partial<typeof materialRequests.$inferInsert> = {
      updatedAt: new Date(),
    };
    if (body.title !== undefined) patch.title = body.title;
    if (body.description !== undefined) patch.description = body.description;
    if (body.status !== undefined) patch.status = body.status;
    if (body.fulfillingDocumentId !== undefined) {
      patch.fulfillingDocumentId = body.fulfillingDocumentId;
    }
    await db
      .update(materialRequests)
      .set(patch)
      .where(eq(materialRequests.id, id));
    await audit(
      req.authUser!.id,
      "request.update",
      "material_request",
      id,
      patch as Record<string, unknown>,
    );
    const dto = await buildRequestDTO([id], req.authUser!.id);
    res.json(dto[0]);
  } catch (err) {
    next(err);
  }
});

router.post("/requests/:id/vote", requireAuth, async (req, res, next) => {
  try {
    const { id } = VoteRequestParams.parse(req.params);
    const found = await db
      .select()
      .from(materialRequests)
      .where(
        and(eq(materialRequests.id, id), isNull(materialRequests.deletedAt)),
      )
      .limit(1);
    if (!found[0]) throw notFound("Request not found");
    const existing = await db
      .select()
      .from(requestVotes)
      .where(
        and(
          eq(requestVotes.requestId, id),
          eq(requestVotes.userId, req.authUser!.id),
        ),
      )
      .limit(1);
    if (existing[0]) {
      throw conflict("You have already voted on this request");
    }
    await db
      .insert(requestVotes)
      .values({ requestId: id, userId: req.authUser!.id });
    await audit(req.authUser!.id, "request.vote", "material_request", id);
    const dto = await buildRequestDTO([id], req.authUser!.id);
    res.json(dto[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
