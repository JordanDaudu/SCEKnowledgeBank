import * as requestsRepo from "../repositories/requests.repo";
import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyService from "./taxonomy.service";
import * as usersService from "./users.service";
import * as auditService from "./audit.service";
import * as notificationsService from "./notifications.service";
import * as permissions from "./permissions.service";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors";
import { logger } from "../lib/logger";
import type { AuthenticatedUser } from "../middlewares/auth";

// Sprint-3 M6: `in_progress` is the new intermediate state between
// `open` and `fulfilled`. Kept as a const so route/zod validation and
// service-side checks share one source of truth.
export const REQUEST_STATUSES = [
  "open",
  "in_progress",
  "fulfilled",
  "closed",
] as const;
const REQUEST_STATUS_SET: ReadonlySet<string> = new Set(REQUEST_STATUSES);

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

/**
 * Course-scoped requests are visible to admins, the request's course
 * lecturers, and students enrolled in that course. Course-less
 * (`courseId === null`) requests stay globally visible.
 *
 * Returns the array of course ids this user is allowed to see; an
 * `undefined` return means "no scoping" (admin).
 */
function visibleCourseIdsFor(user: AuthenticatedUser): string[] | undefined {
  if (permissions.isAdmin(user)) return undefined;
  return user.enrollments.map((e) => e.courseId);
}

function canSeeRequest(user: AuthenticatedUser, r: { courseId: string | null }): boolean {
  if (permissions.isAdmin(user)) return true;
  if (!r.courseId) return true;
  return user.enrollments.some((e) => e.courseId === r.courseId);
}

export async function listRequests(
  filters: requestsRepo.ListRequestsFilters,
  user: AuthenticatedUser,
): Promise<RequestDTO[]> {
  const scoped: requestsRepo.ListRequestsFilters = { ...filters };
  const visible = visibleCourseIdsFor(user);
  if (visible !== undefined) scoped.visibleCourseIds = visible;
  const ids = await requestsRepo.listAliveIds(scoped);
  return buildDTOs(ids, user.id);
}

export async function createRequest(
  body: { title: string; description?: string; courseId?: string },
  user: AuthenticatedUser,
): Promise<RequestDTO> {
  // Course-aware creation (Sprint-2 audit). Mirrors the
  // visibility/voting scoping in `canSeeRequest` / `visibleCourseIdsFor`:
  // you cannot raise a request in a course you wouldn't otherwise be
  // able to see, so any enrollment (lecturer- or student-role) grants
  // creation rights for that course.
  //   - Admin: any course (or none).
  //   - Lecturer: courses they have any enrollment in (typically the
  //     ones they teach).
  //   - Student: courses they are enrolled in.
  //   - Any authenticated user: a global request with no courseId.
  if (body.courseId) {
    const courses = await taxonomyService.loadCourses([body.courseId]);
    const exists = courses.has(body.courseId);
    const allowed =
      exists && permissions.canCreateRequestForCourse(user, body.courseId);
    if (!exists || !allowed) {
      // Collapse "course doesn't exist" and "you can't see this course"
      // into the same 404 for non-admins so course ids aren't
      // enumerable via the create endpoint. Admins still get a precise
      // 404 because they have visibility to everything.
      if (!exists) throw notFound("Course not found");
      if (permissions.isAdmin(user)) {
        // Unreachable in practice (admin is always allowed when the
        // course exists) but kept for explicitness.
        throw forbidden(
          "You do not have access to create a request for this course",
        );
      }
      throw notFound("Course not found");
    }
  }
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
  // Same visibility scoping as listRequests: a user outside the
  // request's course shouldn't even be able to see it, let alone
  // mutate it.
  if (!canSeeRequest(user, r)) throw notFound("Request not found");
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
  // Validate the proposed status against the allow-list rather than
  // letting arbitrary strings flow into the DB (Sprint-3 M6 added
  // `in_progress`; zod at the edge enforces the same set, but the
  // service-level guard is the canonical check).
  if (body.status !== undefined && !REQUEST_STATUS_SET.has(body.status)) {
    throw badRequest(`Unknown request status: ${body.status}`);
  }
  const statusChanged =
    body.status !== undefined && body.status !== r.status;
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

  // Sprint-3 M6: notify the request author when someone *else* moves
  // their request through the workflow. Fire-and-forget; same
  // sync-throw-safe pattern as comment.create.
  if (statusChanged && r.requestedBy !== user.id) {
    void Promise.resolve()
      .then(() =>
        notificationsService.notify({
          recipientId: r.requestedBy,
          actorId: user.id,
          type: "request.status",
          subjectType: "material_request",
          // Encode the new status into the subject so each distinct
          // transition is unique under the notification dedupe key
          // (`recipient + type + subjectType + subjectId`). Otherwise
          // the move open→in_progress→fulfilled would only ever notify
          // the author once.
          subjectId: `${id}:${body.status}`,
          body: `Status changed to ${body.status}`,
          url: `/requests#${id}`,
        }),
      )
      .catch((err) => logger.warn({ err }, "request.status notify threw"));
  }

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
  // Visibility check: a user must be able to see the request to vote
  // on it. Otherwise course-scoped requests would leak via the 409
  // duplicate-vote channel (you could probe by attempting a vote).
  if (!canSeeRequest(user, r)) throw notFound("Request not found");
  const inserted = await requestsRepo.insertVoteIfAbsent(id, user.id);
  if (!inserted) throw conflict("You have already voted on this request");
  await auditService.record(user.id, "request.vote", "material_request", id);
  const dtos = await buildDTOs([id], user.id);
  return dtos[0];
}

/**
 * US-60: surface a newly-uploaded document to the authors of OPEN requests in
 * the same course, as a possible match (a notification linking to the new
 * document). Deliberately NON-destructive — it never auto-marks a request
 * "fulfilled"; that stays a deliberate manual action (so unrelated requests
 * can't be closed by accident). Best-effort and safe to call fire-and-forget.
 */
export async function notifyMatchingRequestsForUpload(doc: {
  id: string;
  courseId: string | null;
  title: string;
  uploaderId: string;
  status: string;
}): Promise<void> {
  // Only match once the document is actually discoverable.
  if (!doc.courseId) return;
  if (doc.status !== "published" && doc.status !== "approved") return;
  const ids = await requestsRepo.listAliveIds({
    status: "open",
    courseId: doc.courseId,
  });
  if (ids.length === 0) return;
  const rows = await requestsRepo.findAliveByIds(ids);
  for (const r of rows) {
    if (r.requestedBy === doc.uploaderId) continue; // don't ping yourself
    void Promise.resolve()
      .then(() =>
        notificationsService.notify({
          recipientId: r.requestedBy,
          actorId: doc.uploaderId,
          type: "request.possible_match",
          subjectType: "material_request",
          // (request, document) pair is unique under the dedupe key, so each
          // distinct candidate upload notifies once.
          subjectId: `${r.id}:${doc.id}`,
          body: `A new document "${doc.title}" may match your request "${r.title}"`,
          url: `/documents/${doc.id}`,
        }),
      )
      .catch((err) => logger.warn({ err }, "request match notify threw"));
  }
}
