import { useEffect, useMemo, useRef, useState } from "react";
import {
  useSearchDocumentsV2,
  useSearchDocumentsFacets,
  useListCourses,
  useListCategories,
  useListTags,
  useListMyFavorites,
  getSearchDocumentsV2QueryKey,
  getSearchDocumentsFacetsQueryKey,
  getListMyFavoritesQueryKey,
  type SearchDocumentsV2Params,
} from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useSearch } from "wouter";
import FacetChips, { type FacetDim } from "@/components/browse/FacetChips";
import { useQueryStateSync } from "@/hooks/use-query-state-sync";
import { useDebounce } from "@/hooks/use-debounce";
import { useDocumentSnapshot } from "@/hooks/use-document-snapshot";
import { Input } from "@/components/ui/input";
import { Search, Library } from "lucide-react";
import BrowseFilters, {
  type Sort,
  type Semester,
} from "@/components/browse/BrowseFilters";
import DocumentCards from "@/components/browse/DocumentCards";
import DocumentTable from "@/components/browse/DocumentTable";
import SearchSuggestions from "@/components/browse/SearchSuggestions";
import RecentlyViewedStrip from "@/components/browse/RecentlyViewedStrip";
import {
  BrowseLoading,
  BrowseEmpty,
  BrowseNoResults,
  BrowseError,
  BrowseViewToggle,
  NewDocsBanner,
  BrowsePagination,
  type BrowseView,
} from "@/components/browse/BrowseStates";

const VIEW_KEY = "kb:browse:view";

function readView(): BrowseView {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "table" ? "table" : "cards";
  } catch {
    return "cards";
  }
}

export default function Browse() {
  const currentSearch = useSearch();
  const initialParams = useMemo(() => new URLSearchParams(currentSearch), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [query, setQuery] = useState(initialParams.get("q") ?? "");
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [courseId, setCourseId] = useState<string>(initialParams.get("courseId") ?? "all");
  const [lecturerName, setLecturerName] = useState<string>(initialParams.get("lecturerName") ?? "");
  const [semester, setSemester] = useState<Semester>(
    ((initialParams.get("semester") as Semester) || "") as Semester,
  );
  const [academicYear, setAcademicYear] = useState<string>(initialParams.get("academicYear") ?? "");
  const [categoryId, setCategoryId] = useState<string>(initialParams.get("categoryId") ?? "all");
  const [materialType, setMaterialType] = useState<string>(initialParams.get("materialType") ?? "all");
  const [tagIds, setTagIds] = useState<string[]>(initialParams.getAll("tagIds"));
  const [uploaderId, setUploaderId] = useState<string>(initialParams.get("uploaderId") ?? "");
  const [status, setStatus] = useState<string>(initialParams.get("status") ?? "");
  const [dateFrom, setDateFrom] = useState<string>(initialParams.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState<string>(initialParams.get("dateTo") ?? "");
  const [sort, setSort] = useState<Sort>(((initialParams.get("sort") as Sort) || "relevance") as Sort);
  const [page, setPage] = useState<number>(Number(initialParams.get("page") ?? "1") || 1);

  // Two-way URL sync: when the URL search string changes from outside
  // (browser back/forward, an external setLocation), rehydrate state.
  // We use a guard ref so our own writes (via useQueryStateSync below)
  // don't trigger a spurious re-rehydration cycle.
  const lastAppliedSearchRef = useRef<string>(currentSearch);
  useEffect(() => {
    if (currentSearch === lastAppliedSearchRef.current) return;
    lastAppliedSearchRef.current = currentSearch;
    const p = new URLSearchParams(currentSearch);
    setQuery(p.get("q") ?? "");
    setCourseId(p.get("courseId") ?? "all");
    setLecturerName(p.get("lecturerName") ?? "");
    setSemester(((p.get("semester") as Semester) || "") as Semester);
    setAcademicYear(p.get("academicYear") ?? "");
    setCategoryId(p.get("categoryId") ?? "all");
    setMaterialType(p.get("materialType") ?? "all");
    setTagIds(p.getAll("tagIds"));
    setUploaderId(p.get("uploaderId") ?? "");
    setStatus(p.get("status") ?? "");
    setDateFrom(p.get("dateFrom") ?? "");
    setDateTo(p.get("dateTo") ?? "");
    setSort(((p.get("sort") as Sort) || "relevance") as Sort);
    setPage(Number(p.get("page") ?? "1") || 1);
  }, [currentSearch]);
  const [view, setView] = useState<BrowseView>(() => readView());

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  const debouncedQuery = useDebounce(query, 300);
  const debouncedLecturer = useDebounce(lecturerName, 300);

  // Serialize tagIds so the page-reset effect doesn't fire on a new array
  // identity that contains the same ids.
  const tagIdsKey = tagIds.join(",");

  // Skip the initial-mount page-reset so a deep link like
  // `/browse?page=3&q=foo` is preserved on first render. Subsequent
  // filter changes still snap back to page 1.
  const filtersSettled = useRef(false);
  useEffect(() => {
    if (!filtersSettled.current) {
      filtersSettled.current = true;
      return;
    }
    setPage(1);
  }, [
    debouncedQuery, debouncedLecturer, courseId, semester, academicYear,
    categoryId, materialType, tagIdsKey, uploaderId, status, dateFrom, dateTo, sort,
  ]);

  // Rebuild the tagIds array from the canonical primitive key so
  // downstream memos are driven purely by primitive deps.
  const tagIdsStable = useMemo<string[]>(
    () => (tagIdsKey ? tagIdsKey.split(",") : []),
    [tagIdsKey],
  );

  // Memoize the URL-sync input on purely primitive deps so
  // useQueryStateSync's internal useMemo([state]) sees a stable
  // reference between renders.
  const urlState = useMemo(
    () => ({
      q: debouncedQuery || undefined,
      courseId: courseId !== "all" ? courseId : undefined,
      lecturerName: debouncedLecturer || undefined,
      semester: semester || undefined,
      academicYear: academicYear || undefined,
      categoryId: categoryId !== "all" ? categoryId : undefined,
      materialType: materialType !== "all" ? materialType : undefined,
      tagIds: tagIdsStable.length > 0 ? tagIdsStable : undefined,
      uploaderId: uploaderId || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sort: sort !== "relevance" ? sort : undefined,
      page: page > 1 ? page : undefined,
    }),
    [
      debouncedQuery, courseId, debouncedLecturer, semester, academicYear,
      categoryId, materialType, tagIdsStable, uploaderId, status, dateFrom, dateTo, sort, page,
    ],
  );
  useQueryStateSync(urlState);

  const { data: courses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: tags } = useListTags();

  // Memoize the request params on primitives so TanStack Query keys stay
  // referentially stable and we don't generate duplicate in-flight fetches.
  const params = useMemo<SearchDocumentsV2Params>(
    () => ({
      q: debouncedQuery || undefined,
      courseId: courseId !== "all" ? courseId : undefined,
      lecturerName: debouncedLecturer || undefined,
      semester: (semester || undefined) as SearchDocumentsV2Params["semester"],
      academicYear: academicYear ? Number(academicYear) : undefined,
      categoryId: categoryId !== "all" ? categoryId : undefined,
      materialType: materialType !== "all" ? materialType : undefined,
      tagIds: tagIdsStable.length > 0 ? tagIdsStable : undefined,
      uploaderId: uploaderId || undefined,
      status: status || undefined,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
      sort,
      page,
      pageSize: 12,
    }),
    [
      debouncedQuery, courseId, debouncedLecturer, semester, academicYear,
      categoryId, materialType, tagIdsStable, uploaderId, status, dateFrom, dateTo, sort, page,
    ],
  );

  const { data: pageData, isLoading, isFetching, isError, refetch } = useSearchDocumentsV2(params, {
    query: {
      queryKey: getSearchDocumentsV2QueryKey(params),
      // Silently refetch every 30s while the tab is focused; React Query
      // pauses refetchInterval automatically when the window is blurred.
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
      staleTime: 15_000,
    },
  });

  // Facets come from a *separate*, lower-priority query so the results
  // grid paints first. Same filter inputs minus paging/sort, with a
  // longer staleTime — facet counts shift slowly relative to result
  // listings and don't justify the same refetch cadence.
  const facetParams = useMemo(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { page: _p, pageSize: _ps, sort: _s, ...rest } = params;
    return rest;
  }, [params]);
  const { data: facetData, isFetching: facetsFetching } = useSearchDocumentsFacets(
    facetParams,
    {
      query: {
        queryKey: getSearchDocumentsFacetsQueryKey(facetParams),
        staleTime: 60_000,
        refetchOnWindowFocus: false,
      },
    },
  );

  const { displayedData, hasNewDocuments, showLatest } = useDocumentSnapshot(pageData, params);

  const activeFilterCount =
    (courseId !== "all" ? 1 : 0) +
    (debouncedLecturer ? 1 : 0) +
    (semester ? 1 : 0) +
    (academicYear ? 1 : 0) +
    (categoryId !== "all" ? 1 : 0) +
    (materialType !== "all" ? 1 : 0) +
    tagIds.length +
    (uploaderId ? 1 : 0) +
    (status ? 1 : 0) +
    (dateFrom ? 1 : 0) +
    (dateTo ? 1 : 0);

  const clearAll = () => {
    setQuery("");
    setCourseId("all");
    setLecturerName("");
    setSemester("");
    setAcademicYear("");
    setCategoryId("all");
    setMaterialType("all");
    setTagIds([]);
    setUploaderId("");
    setStatus("");
    setDateFrom("");
    setDateTo("");
    setSort("relevance");
    setPage(1);
  };

  const toggleTag = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const viewData = displayedData ?? pageData;
  const totalPages = viewData ? Math.max(1, Math.ceil(viewData.total / viewData.pageSize)) : 1;
  const hasFiltersOrQuery = activeFilterCount > 0 || !!debouncedQuery;

  // Sprint-3 M6 — "Following" tab is server-backed by the favorites
  // service (`GET /me/favorites`). The list is intentionally
  // unpaginated; the API today caps results and the typical favorite
  // set is small. We invalidate via the favorites query key whenever
  // the detail page toggles a star.
  const [tab, setTab] = useState<"library" | "following">("library");
  // Fetched regardless of tab so Library cards can show favorite state on
  // their heart toggle (not just the Following tab). Small, cached payload.
  const { data: favorites, isLoading: favoritesLoading } = useListMyFavorites({
    query: {
      queryKey: getListMyFavoritesQueryKey(),
      staleTime: 30_000,
    },
  });
  const favoritedIds = useMemo(
    () => new Set((favorites ?? []).map((d) => d.id)),
    [favorites],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2.5 mb-1">
            <div className="p-1.5 rounded-lg bg-primary/10 shrink-0">
              <Library className="h-5 w-5 text-primary" />
            </div>
            <h1 className="text-3xl font-serif font-bold text-foreground">Browse Library</h1>
          </div>
          <p className="text-muted-foreground">Discover course materials by title, topic, course, or lecturer.</p>
        </div>
      </div>

      <RecentlyViewedStrip />

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="library" data-testid="browse-tab-library">
            Library
          </TabsTrigger>
          <TabsTrigger value="following" data-testid="browse-tab-following">
            Following
          </TabsTrigger>
        </TabsList>

        <TabsContent value="following" className="mt-6">
          {favoritesLoading ? (
            <BrowseLoading view={view} />
          ) : favorites && favorites.length > 0 ? (
            <DocumentCards items={favorites} favoritedIds={favoritedIds} />
          ) : (
            <div
              className="text-center py-20 bg-card rounded-xl border border-dashed"
              data-testid="following-empty"
            >
              <p className="text-muted-foreground">
                You're not following any documents yet. Star a document to get
                notified when new comments are posted.
              </p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="library" className="mt-6 space-y-8">
      <div className="bg-card border rounded-xl p-4 space-y-4 shadow-sm sticky top-16 z-30">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground z-10" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setShowSuggestions(false)}
              placeholder="Search titles, descriptions..."
              className="pl-9 w-full bg-background"
              data-testid="browse-search"
            />
            {showSuggestions && (
              <SearchSuggestions
                query={query}
                onSelect={(title) => { setQuery(title); setShowSuggestions(false); }}
                onPickCourse={(id) => { setCourseId(id); setQuery(""); setShowSuggestions(false); }}
                onPickUploader={(id) => { setUploaderId(id); setQuery(""); setShowSuggestions(false); }}
                onPickTag={(id) => {
                  setTagIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
                  setQuery("");
                  setShowSuggestions(false);
                }}
              />
            )}
          </div>

          <BrowseFilters
            courseId={courseId} setCourseId={setCourseId}
            lecturerName={lecturerName} setLecturerName={setLecturerName}
            semester={semester} setSemester={setSemester}
            academicYear={academicYear} setAcademicYear={setAcademicYear}
            categoryId={categoryId} setCategoryId={setCategoryId}
            materialType={materialType} setMaterialType={setMaterialType}
            tagIds={tagIds} toggleTag={toggleTag}
            dateFrom={dateFrom} setDateFrom={setDateFrom}
            dateTo={dateTo} setDateTo={setDateTo}
            sort={sort} setSort={setSort}
            courses={courses} categories={categories} tags={tags}
            debouncedLecturer={debouncedLecturer}
            activeFilterCount={activeFilterCount}
            clearAll={clearAll}
          />

          <BrowseViewToggle view={view} onChange={setView} />
        </div>

        <FacetChips
          facets={facetData}
          loading={facetsFetching}
          active={{
            courseId: courseId !== "all" ? courseId : undefined,
            materialType: materialType !== "all" ? materialType : undefined,
            semester: semester || undefined,
            status: status || undefined,
            uploaderId: uploaderId || undefined,
          }}
          onPick={(dim: FacetDim, value: string) => {
            switch (dim) {
              case "courseId":
                setCourseId(courseId === value ? "all" : value);
                break;
              case "materialType":
                setMaterialType(materialType === value ? "all" : value);
                break;
              case "semester":
                setSemester(
                  (semester === value ? "" : value) as typeof semester,
                );
                break;
              case "uploaderId":
                setUploaderId(uploaderId === value ? "" : value);
                break;
              case "status":
                setStatus(status === value ? "" : value);
                break;
            }
          }}
        />
      </div>

      <div data-testid="browse-results">
        {isError ? (
          <BrowseError onRetry={() => refetch()} />
        ) : isLoading ? (
          <BrowseLoading view={view} />
        ) : viewData?.items && viewData.items.length > 0 ? (
          <>
            {hasNewDocuments && <NewDocsBanner onRefresh={showLatest} />}
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">
                <span className="font-semibold text-foreground tabular-nums">{viewData.total}</span>
                {" "}result{viewData.total === 1 ? "" : "s"}
                {isFetching && <span className="ml-2 text-primary/60 animate-pulse">· refreshing…</span>}
              </p>
            </div>

            {view === "table"
              ? <DocumentTable
                  items={viewData.items}
                  tags={tags}
                  categories={categories}
                  sort={sort}
                  onSortChange={(s) => {
                    setSort(s as Sort);
                    setPage(1);
                  }}
                />
              : <DocumentCards items={viewData.items} favoritedIds={favoritedIds} />}

            {viewData.total > viewData.pageSize && (
              <BrowsePagination page={page} totalPages={totalPages} onChange={setPage} />
            )}
          </>
        ) : hasFiltersOrQuery ? (
          <BrowseNoResults onClear={clearAll} />
        ) : (
          <BrowseEmpty />
        )}
      </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
