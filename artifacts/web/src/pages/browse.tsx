import { useEffect, useMemo, useState } from "react";
import {
  useListDocuments,
  useListCourses,
  useListCategories,
  useListTags,
  getListDocumentsQueryKey,
  type ListDocumentsParams,
} from "@workspace/api-client-react";
import { useSearch } from "wouter";
import { useQueryStateSync } from "@/hooks/use-query-state-sync";
import { useDebounce } from "@/hooks/use-debounce";
import { useDocumentSnapshot } from "@/hooks/use-document-snapshot";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";
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
  const initialSearch = useSearch();
  const initialParams = useMemo(() => new URLSearchParams(initialSearch), []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const [dateFrom, setDateFrom] = useState<string>(initialParams.get("dateFrom") ?? "");
  const [dateTo, setDateTo] = useState<string>(initialParams.get("dateTo") ?? "");
  const [sort, setSort] = useState<Sort>(((initialParams.get("sort") as Sort) || "newest") as Sort);
  const [page, setPage] = useState<number>(Number(initialParams.get("page") ?? "1") || 1);
  const [view, setView] = useState<BrowseView>(() => readView());

  useEffect(() => {
    try { localStorage.setItem(VIEW_KEY, view); } catch { /* ignore */ }
  }, [view]);

  const debouncedQuery = useDebounce(query, 300);
  const debouncedLecturer = useDebounce(lecturerName, 300);

  useEffect(() => {
    setPage(1);
  }, [
    debouncedQuery, debouncedLecturer, courseId, semester, academicYear,
    categoryId, materialType, tagIds, dateFrom, dateTo, sort,
  ]);

  useQueryStateSync({
    q: debouncedQuery || undefined,
    courseId: courseId !== "all" ? courseId : undefined,
    lecturerName: debouncedLecturer || undefined,
    semester: semester || undefined,
    academicYear: academicYear || undefined,
    categoryId: categoryId !== "all" ? categoryId : undefined,
    materialType: materialType !== "all" ? materialType : undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sort: sort !== "newest" ? sort : undefined,
    page: page > 1 ? page : undefined,
  });

  const { data: courses } = useListCourses();
  const { data: categories } = useListCategories();
  const { data: tags } = useListTags();

  const params: ListDocumentsParams = {
    q: debouncedQuery || undefined,
    courseId: courseId !== "all" ? courseId : undefined,
    lecturerName: debouncedLecturer || undefined,
    semester: (semester || undefined) as ListDocumentsParams["semester"],
    academicYear: academicYear ? Number(academicYear) : undefined,
    categoryId: categoryId !== "all" ? categoryId : undefined,
    materialType: materialType !== "all" ? materialType : undefined,
    tagIds: tagIds.length > 0 ? tagIds : undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    sort,
    page,
    pageSize: 12,
  };

  const { data: pageData, isLoading, isFetching, isError, refetch } = useListDocuments(params, {
    query: {
      queryKey: getListDocumentsQueryKey(params),
      // Silently refetch every 30s while the tab is focused; React Query
      // pauses refetchInterval automatically when the window is blurred.
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  const { displayedData, hasNewDocuments, showLatest } = useDocumentSnapshot(pageData, params);

  const activeFilterCount =
    (courseId !== "all" ? 1 : 0) +
    (debouncedLecturer ? 1 : 0) +
    (semester ? 1 : 0) +
    (academicYear ? 1 : 0) +
    (categoryId !== "all" ? 1 : 0) +
    (materialType !== "all" ? 1 : 0) +
    tagIds.length +
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
    setDateFrom("");
    setDateTo("");
    setSort("newest");
    setPage(1);
  };

  const toggleTag = (id: string) => {
    setTagIds((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));
  };

  const viewData = displayedData ?? pageData;
  const totalPages = viewData ? Math.max(1, Math.ceil(viewData.total / viewData.pageSize)) : 1;
  const hasFiltersOrQuery = activeFilterCount > 0 || !!debouncedQuery;

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Browse Library</h1>
          <p className="text-muted-foreground mt-1">Explore all available academic materials.</p>
        </div>
      </div>

      <RecentlyViewedStrip />

      <div className="bg-card border rounded-xl p-4 space-y-4 shadow-sm">
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
      </div>

      <div data-testid="browse-results">
        {isError ? (
          <BrowseError onRetry={() => refetch()} />
        ) : isLoading ? (
          <BrowseLoading view={view} />
        ) : viewData?.items && viewData.items.length > 0 ? (
          <>
            {hasNewDocuments && <NewDocsBanner onRefresh={showLatest} />}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">
                {viewData.total} result{viewData.total === 1 ? "" : "s"}
                {isFetching && " · refreshing…"}
              </p>
            </div>

            {view === "table"
              ? <DocumentTable items={viewData.items} />
              : <DocumentCards items={viewData.items} />}

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
    </div>
  );
}
