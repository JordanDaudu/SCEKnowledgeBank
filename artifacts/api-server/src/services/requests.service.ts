import * as requestsRepo from "../repositories/requests.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyService from "./taxonomy.service";
import * as usersService from "./users.service";
import * as auditService from "./audit.service";
import * as permissions from "./permissions.service";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface RequestDTO {
  id: string;
  title: string;
  description: string;
  status: string;
  course?: taxonomyService.CourseDTO;
  requestedBy?: usersService.UserSummaryDTO;
  voteCount: number;
  hasVoted: boolean;
  fulfillingDocumentId?: string;
  createdAt: string;
}

async function buildDTOs(
  ids: string[],
  currentUserId: string,
): Promise<RequestDTO[]> {
  if (ids.length === 0) return [];
  const rows = await requestsRepo.findAliveByIds(ids);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ordered = ids
    .map((id) => byId.get(id))
    .filter((r): r is requestsRepo.RequestRow => !!r);

  const orderedIds = ordered.map((r) => r.id);
  const [coursesMap, usersMap, voteCount, hasVotedSet] = await Promise.all([
    taxonomyService.loadCourses(ordered.map((r) => r.courseId)),
    usersService.loadUserSummaries(ordered.map((r) => r.requestedBy)),
    requestsRepo.countVotesByRequestIds(orderedIds),
    requestsRepo.findUserVotedRequestIds(currentUserId, orderedIds),
  ]);
  return ordered.map((r) => {
    const dto: RequestDTO = {
      id: r.id,
      title: r.title,
      description: r.description ?? "",
      status: r.status,
      voteCount: voteCount.get(r.id) ?? 0,
      hasVoted: hasVotedSet.has(r.id),
      createdAt: r.createdAt.toISOString(),
    };
    if (r.courseId && coursesMap.has(r.courseId)) {
      dto.course = coursesMap.get(r.courseId);
    }
    const u = usersMap.get(r.requestedBy);
    if (u) dto.requestedBy = u;
    if (r.fulfillingDocumentId)
      dto.fulfillingDocumentId = r.fulfillingDocumentId;
    return dto;
  });
}

export async function listRequests(
  filters: requestsRepo.ListRequestsFilters,
  user: AuthenticatedUser,
): Promise<RequestDTO[]> {
  const ids = await requestsRepo.listAliveIds(filters);
  return buildDTOs(ids, user.id);
}

export async function createRequest(
  body: { title: string; description?: string; courseId?: string },
  user: AuthenticatedUser,
): Promise<RequestDTO> {
  const values: requestsRepo.RequestInsert = {
    title: body.title,
    description: body.description ?? "",
    requestedBy: user.id,
  };
  if (body.courseId) values.courseId = body.courseId;
  const inserted = await requestsRepo.insertRequest(values);
  await auditService.record(
    user.id,
    "request.create",
    "material_request",
    inserted.id,
  );
  const dtos = await buildDTOs([inserted.id], user.id);
  return dtos[0];
}

export async function updateRequest(
  id: string,
  body: {
    title?: string;
    description?: string;
    status?: string;
    fulfillingDocumentId?: string | null;
  },
  user: AuthenticatedUser,
): Promise<RequestDTO> {
  const r = await requestsRepo.findAliveById(id);
  if (!r) throw notFound("Request not found");
  const isOwner = r.requestedBy === user.id;
  const wantsStatusChange =
    body.status !== undefined || body.fulfillingDocumentId !== undefined;
  const wantsContentChange =
    body.title !== undefined || body.description !== undefined;
  // Status fulfillment is open to admins, the author, and lecturers who
  // teach the request's course (or any lecturer when the request is
  // course-less). Editing title/description stays restricted to the
  // author or an admin.
  if (
    wantsStatusChange &&
    !permissions.canFulfilRequest(user, {
      requestedBy: r.requestedBy,
      courseId: r.courseId,
    })
  ) {
    throw forbidden(
      "Only the request author, a lecturer for this course, or an admin can change request status",
    );
  }
  if (wantsContentChange && !isOwner && !permissions.isAdmin(user)) {
    throw forbidden("Only the request author or an admin can edit this request");
  }
  if (body.fulfillingDocumentId) {
    const doc = await docsRepo.findByIdAlive(body.fulfillingDocumentId);
    if (!doc) throw badRequest("Fulfilling document not found");
  }
  const patch: Partial<requestsRepo.RequestInsert> = {
    updatedAt: new Date(),
  };
  if (body.title !== undefined) patch.title = body.title;
  if (body.description !== undefined) patch.description = body.description;
  if (body.status !== undefined) patch.status = body.status;
  if (body.fulfillingDocumentId !== undefined) {
    patch.fulfillingDocumentId = body.fulfillingDocumentId;
  }
  await requestsRepo.updateRequestById(id, patch);
  await auditService.record(
    user.id,
    "request.update",
    "material_request",
    id,
    patch as Record<string, unknown>,
  );
  const dtos = await buildDTOs([id], user.id);
  return dtos[0];
}

/**
 * Vote on a request. Race-safe: the insert is gated by a unique index on
 * (user_id, request_id) via `ON CONFLICT DO NOTHING`, so two concurrent
 * requests cannot both succeed. Semantics: a duplicate vote returns 409
 * (we never silently swallow it — the client uses this to flip the vote
 * button into its "voted" state and to surface "already voted").
 */
export async function voteOnRequest(
  id: string,
  user: AuthenticatedUser,
): Promise<RequestDTO> {
  const r = await requestsRepo.findAliveById(id);
  if (!r) throw notFound("Request not found");
  const inserted = await requestsRepo.insertVoteIfAbsent(id, user.id);
  if (!inserted) throw conflict("You have already voted on this request");
  await auditService.record(user.id, "request.vote", "material_request", id);
  const dtos = await buildDTOs([id], user.id);
  return dtos[0];
}
