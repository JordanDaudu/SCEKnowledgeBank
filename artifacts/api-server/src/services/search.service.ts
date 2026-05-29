/**
 * Sprint-3 M3: search service.
 *
 * Owns the document discovery surface (search, facet counts,
 * autocomplete) behind a typed filter DSL. The legacy
 * `documentsService.listDocuments` / `GET /documents` path is left
 * untouched for one M3 cycle and removed in M7.
 *
 * Everything here funnels through the existing repo helpers and
 * `permissions.service` so visibility scoping stays a single source
 * of truth.
 */
import * as docsRepo from "../repositories/documents.repo";
import * as taxonomyRepo from "../repositories/taxonomy.repo";
import * as taxonomyService from "./taxonomy.service";
import * as usersService from "./users.service";
import * as documentsService from "./documents.service";
import * as permissions from "./permissions.service";
import type { AuthenticatedUser } from "../middlewares/auth";

export interface SearchFilters {
  q?: string;
  courseId?: string;
  courseCode?: string;
  lecturerName?: string;
  categoryId?: string;
  materialType?: string;
  semester?: string;
  academicYear?: number;
  tagIds?: string[];
  uploaderId?: string;
  status?: string;
  dateFrom?: Date;
  dateTo?: Date;
  sort: docsRepo.DocumentSort;
  page: number;
  pageSize: number;
}

export interface SearchHit extends documentsService.DocumentDTO {
  /** Sentinel-marked snippet from `ts_headline` — `[[KBMARK]]match[[/KBMARK]]`.
   *  The client must HTML-escape this before swapping the sentinels
   *  for `<mark>` tags (see `repo.SNIPPET_MARK_OPEN/CLOSE`).
   */
  headline?: string;
}

export interface SearchPageResult {
  items: SearchHit[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Resolve filter inputs that reference taxonomy by name into the
 * primary-key form the repo expects. Returns `null` when a lookup
 * produced an empty set (caller should short-circuit to zero hits).
 */
async function resolveFilters(
  q: SearchFilters,
  user: AuthenticatedUser,
): Promise<docsRepo.DocumentListFilters | null> {
  const filters: docsRepo.DocumentListFilters = {
    visibility: permissions.visibleDocumentFilter(user),
  };
  if (q.courseId) filters.courseId = q.courseId;
  if (q.categoryId) filters.categoryId = q.categoryId;
  if (q.materialType) filters.materialType = q.materialType;
  if (q.semester) filters.semester = q.semester;
  if (q.academicYear != null) filters.academicYear = q.academicYear;
  if (q.dateFrom) filters.dateFrom = q.dateFrom;
  if (q.dateTo) filters.dateTo = q.dateTo;
  if (q.q) filters.q = q.q;
  if (q.uploaderId) filters.uploaderId = q.uploaderId;
  if (q.status) filters.status = q.status;

  if (q.courseCode || q.lecturerName) {
    const ids = await taxonomyRepo.findCourseIdsByCodeOrLecturer(
      q.courseCode,
      q.lecturerName,
    );
    if (ids.length === 0) return null;
    filters.restrictCourseIds = ids;
  }
  if (q.tagIds && q.tagIds.length > 0) {
    const docIds = await docsRepo.findDocumentIdsByTagIds(q.tagIds);
    if (docIds.length === 0) return null;
    filters.restrictDocumentIds = docIds;
  }
  return filters;
}

export async function searchDocuments(
  q: SearchFilters,
  user: AuthenticatedUser,
): Promise<SearchPageResult> {
  const filters = await resolveFilters(q, user);
  if (filters === null) {
    return { items: [], total: 0, page: q.page, pageSize: q.pageSize };
  }
  if (q.q) {
    const visibilitySql = permissions.visibleDocumentFilterSql(user);
    const [total, { rows, headlines }] = await Promise.all([
      docsRepo.countSearchDocuments(q.q, filters, visibilitySql),
      docsRepo.searchDocumentsRankedWithSnippets(q.q, filters, visibilitySql, {
        sort: q.sort,
        page: q.page,
        pageSize: q.pageSize,
      }),
    ]);
    // Typo tolerance: when the exact/prefix FTS path finds nothing, retry
    // through the trigram fuzzy fallback (same filters + visibility). The
    // fuzzy path has no FTS headline, so hits come back without snippets.
    if (total === 0) {
      const [fuzzyTotal, fuzzyRows] = await Promise.all([
        docsRepo.countFuzzyDocuments(q.q, filters, visibilitySql),
        docsRepo.searchDocumentsFuzzy(q.q, filters, visibilitySql, {
          sort: q.sort,
          page: q.page,
          pageSize: q.pageSize,
        }),
      ]);
      const fuzzyDtos = await documentsService.assembleDocuments(fuzzyRows, user);
      return {
        items: fuzzyDtos,
        total: fuzzyTotal,
        page: q.page,
        pageSize: q.pageSize,
      };
    }
    const dtos = await documentsService.assembleDocuments(rows, user);
    const items: SearchHit[] = dtos.map((d) => {
      const h = headlines.get(d.id);
      return h ? { ...d, headline: h } : d;
    });
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
  const total = await docsRepo.countDocuments(filters);
  const rows = await docsRepo.listDocuments(filters, {
    sort: q.sort,
    page: q.page,
    pageSize: q.pageSize,
  });
  const items = await documentsService.assembleDocuments(rows, user);
  return { items, total, page: q.page, pageSize: q.pageSize };
}

export interface SearchFacets {
  course: Array<{ id: string; code: string; title: string; count: number }>;
  materialType: Array<{ value: string; count: number }>;
  semester: Array<{ value: string; count: number }>;
  status: Array<{ value: string; count: number }>;
  uploader: Array<{ id: string; displayName: string; count: number }>;
}

export async function searchFacets(
  q: SearchFilters,
  user: AuthenticatedUser,
): Promise<SearchFacets> {
  const filters = await resolveFilters(q, user);
  if (filters === null) {
    return {
      course: [],
      materialType: [],
      semester: [],
      status: [],
      uploader: [],
    };
  }
  const visibilitySql = permissions.visibleDocumentFilterSql(user);
  const counts = await docsRepo.computeFacetCounts(
    q.q,
    filters,
    visibilitySql,
  );

  // Hydrate id-bearing facets so the UI can label chips without an
  // extra round-trip. Names that fail to resolve (deleted entities)
  // are dropped — the count is meaningless without a label.
  const courseIds = counts.courseId.map((c) => c.value);
  const uploaderIds = counts.uploaderId.map((u) => u.value);
  const [coursesMap, uploadersMap] = await Promise.all([
    taxonomyService.loadCourses(courseIds),
    usersService.loadUserSummaries(uploaderIds),
  ]);

  const course = counts.courseId
    .map((c) => {
      const meta = coursesMap.get(c.value);
      return meta
        ? { id: c.value, code: meta.code, title: meta.title, count: c.count }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const uploader = counts.uploaderId
    .map((u) => {
      const meta = uploadersMap.get(u.value);
      return meta
        ? { id: u.value, displayName: meta.displayName, count: u.count }
        : null;
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    course,
    materialType: counts.materialType,
    semester: counts.semester,
    status: counts.status,
    uploader,
  };
}

export interface AutocompleteResult {
  tags: Array<{ id: string; name: string; count: number }>;
  courses: Array<{ id: string; code: string; title: string; count: number }>;
  uploaders: Array<{ id: string; displayName: string; count: number }>;
}

export async function autocomplete(
  prefix: string,
  limit: number,
  user: AuthenticatedUser,
): Promise<AutocompleteResult> {
  const trimmed = prefix.trim();
  if (trimmed.length === 0) {
    return { tags: [], courses: [], uploaders: [] };
  }
  const visibilitySql = permissions.visibleDocumentFilterSql(user);
  return docsRepo.findAutocomplete(trimmed, limit, visibilitySql);
}
