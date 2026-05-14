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
import { formatDateTime } from "@/lib/format";
import { useQueryStateSync } from "@/hooks/use-query-state-sync";
import { useDebounce } from "@/hooks/use-debounce";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Search, FileText, BookOpen, X, SlidersHorizontal, RefreshCw } from "lucide-react";
import { Link } from "wouter";

type Sort = "newest" | "oldest" | "title" | "popularity";
type Semester = "fall" | "spring" | "summer" | "";

const MATERIAL_TYPES = [
  "lecture-notes", "problem-set", "exam", "syllabus", "slides", "project-report", "textbook",
];

export default function Browse() {
  const initialSearch = useSearch();

  // Initialize from URL (one-time read)
  const initialParams = useMemo(() => new URLSearchParams(initialSearch), []); // eslint-disable-line react-hooks/exhaustive-deps

  const [query, setQuery] = useState(initialParams.get("q") ?? "");
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

  // Debounce free-text fields so we don't spam the API as the user types
  const debouncedQuery = useDebounce(query, 300);
  const debouncedLecturer = useDebounce(lecturerName, 300);

  // Reset to page 1 whenever any filter changes
  useEffect(() => {
    setPage(1);
  }, [
    debouncedQuery, debouncedLecturer, courseId, semester, academicYear,
    categoryId, materialType, tagIds, dateFrom, dateTo, sort,
  ]);

  // Sync state back to URL so filters survive refresh / can be shared
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

  const { data: pageData, isLoading, isFetching } = useListDocuments(params, {
    query: {
      queryKey: getListDocumentsQueryKey(params),
      // Silently refetch every 30s while the tab is focused; React Query
      // pauses refetchInterval automatically when the window is blurred
      // (refetchIntervalInBackground defaults to false).
      refetchInterval: 30_000,
      refetchOnWindowFocus: true,
    },
  });

  // Snapshot of the currently displayed page. When a background refetch
  // brings in different items for the same filters, we show a banner
  // instead of swapping the list under the user's cursor.
  const paramsKey = useMemo(() => JSON.stringify(params), [params]);
  const [displayedData, setDisplayedData] = useState<typeof pageData>(undefined);
  const [displayedKey, setDisplayedKey] = useState<string>(paramsKey);
  const [hasNewDocuments, setHasNewDocuments] = useState(false);

  // When filters or page change, drop the old snapshot immediately so we
  // don't briefly show stale results from the previous filter while the
  // new query loads.
  useEffect(() => {
    if (paramsKey !== displayedKey) {
      setDisplayedData(undefined);
      setDisplayedKey(paramsKey);
      setHasNewDocuments(false);
    }
  }, [paramsKey, displayedKey]);

  useEffect(() => {
    if (!pageData) return;
    if (paramsKey !== displayedKey) return;
    if (!displayedData) {
      setDisplayedData(pageData);
      return;
    }
    const sameItems =
      displayedData.items.length === pageData.items.length &&
      displayedData.items.every((d, i) => d.id === pageData.items[i]?.id);
    if (!sameItems || displayedData.total !== pageData.total) {
      // If the user is currently looking at an empty result set, just
      // adopt the new data — there's nothing to preserve under their cursor.
      if (displayedData.items.length === 0) {
        setDisplayedData(pageData);
        setHasNewDocuments(false);
      } else {
        setHasNewDocuments(true);
      }
    }
  }, [pageData, paramsKey, displayedKey, displayedData]);

  const showLatest = () => {
    if (pageData) setDisplayedData(pageData);
    setHasNewDocuments(false);
  };

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

  return (
    <div className="space-y-8">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">Browse Library</h1>
          <p className="text-muted-foreground mt-1">Explore all available academic materials.</p>
        </div>
      </div>

      <div className="bg-card border rounded-xl p-4 space-y-4 shadow-sm">
        <div className="flex flex-col md:flex-row gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles, descriptions..."
              className="pl-9 w-full bg-background"
              data-testid="browse-search"
            />
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2" data-testid="browse-filters-trigger">
                <SlidersHorizontal className="h-4 w-4" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5">{activeFilterCount}</Badge>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[360px] max-h-[70vh] overflow-y-auto" align="end">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="font-medium text-sm">Refine results</h4>
                  {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearAll} className="h-auto px-2 py-1 text-xs">
                      Clear all
                    </Button>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Course</label>
                    <Select value={courseId} onValueChange={setCourseId}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All courses</SelectItem>
                        {courses?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Lecturer</label>
                    <Input
                      value={lecturerName}
                      onChange={(e) => setLecturerName(e.target.value)}
                      placeholder="e.g. Dr. Smith"
                      className="bg-background"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Semester</label>
                    <Select
                      value={semester || "any"}
                      onValueChange={(val) => setSemester(val === "any" ? "" : (val as Semester))}
                    >
                      <SelectTrigger className="bg-background"><SelectValue placeholder="Any" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="any">Any semester</SelectItem>
                        <SelectItem value="fall">Fall</SelectItem>
                        <SelectItem value="spring">Spring</SelectItem>
                        <SelectItem value="summer">Summer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Academic year</label>
                    <Input
                      type="number"
                      value={academicYear}
                      onChange={(e) => setAcademicYear(e.target.value)}
                      placeholder="e.g. 2024"
                      className="bg-background"
                    />
                  </div>

                  <div className="space-y-1.5 col-span-2">
                    <label className="text-xs font-medium text-muted-foreground">Category</label>
                    <Select value={categoryId} onValueChange={setCategoryId}>
                      <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All categories</SelectItem>
                        {categories?.map((c) => (
                          <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Uploaded from</label>
                    <Input
                      type="date"
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      className="bg-background"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Uploaded to</label>
                    <Input
                      type="date"
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      className="bg-background"
                    />
                  </div>
                </div>

                {tags && tags.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-muted-foreground">Tags</label>
                    <div className="flex flex-wrap gap-1.5">
                      {tags.map((t) => (
                        <Badge
                          key={t.id}
                          variant={tagIds.includes(t.id) ? "default" : "outline"}
                          className="cursor-pointer"
                          onClick={() => toggleTag(t.id)}
                        >
                          {t.name}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Select value={materialType} onValueChange={setMaterialType}>
            <SelectTrigger className="w-[160px] bg-background">
              <SelectValue placeholder="All Types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {MATERIAL_TYPES.map((t) => (
                <SelectItem key={t} value={t} className="capitalize">{t.replace("-", " ")}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select value={sort} onValueChange={(val) => setSort(val as Sort)}>
            <SelectTrigger className="w-[140px] bg-background">
              <SelectValue placeholder="Sort by" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="newest">Newest First</SelectItem>
              <SelectItem value="oldest">Oldest First</SelectItem>
              <SelectItem value="popularity">Most Viewed</SelectItem>
              <SelectItem value="title">A-Z</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {activeFilterCount > 0 && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">Active:</span>
            {courseId !== "all" && (
              <FilterChip onClear={() => setCourseId("all")}>
                Course: {courses?.find((c) => c.id === courseId)?.code ?? courseId}
              </FilterChip>
            )}
            {debouncedLecturer && (
              <FilterChip onClear={() => setLecturerName("")}>Lecturer: {debouncedLecturer}</FilterChip>
            )}
            {semester && <FilterChip onClear={() => setSemester("")}>Semester: {semester}</FilterChip>}
            {academicYear && (
              <FilterChip onClear={() => setAcademicYear("")}>Year: {academicYear}</FilterChip>
            )}
            {categoryId !== "all" && (
              <FilterChip onClear={() => setCategoryId("all")}>
                Category: {categories?.find((c) => c.id === categoryId)?.name ?? categoryId}
              </FilterChip>
            )}
            {materialType !== "all" && (
              <FilterChip onClear={() => setMaterialType("all")}>
                Type: {materialType.replace("-", " ")}
              </FilterChip>
            )}
            {tagIds.map((id) => (
              <FilterChip key={id} onClear={() => toggleTag(id)}>
                Tag: {tags?.find((t) => t.id === id)?.name ?? id}
              </FilterChip>
            ))}
            {dateFrom && <FilterChip onClear={() => setDateFrom("")}>From: {dateFrom}</FilterChip>}
            {dateTo && <FilterChip onClear={() => setDateTo("")}>To: {dateTo}</FilterChip>}
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={clearAll}>
              Clear all
            </Button>
          </div>
        )}
      </div>

      <div data-testid="browse-results">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {Array(8).fill(0).map((_, i) => <Skeleton key={i} className="h-48 w-full rounded-xl" />)}
          </div>
        ) : viewData?.items && viewData.items.length > 0 ? (
          <>
            {hasNewDocuments && (
              <div
                className="mb-3 flex items-center justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-2"
                data-testid="browse-new-docs-banner"
              >
                <p className="text-sm text-foreground">
                  New documents available
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={showLatest}
                  className="gap-1.5 text-primary hover:text-primary"
                  data-testid="browse-new-docs-refresh"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh
                </Button>
              </div>
            )}
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm text-muted-foreground">
                {viewData.total} result{viewData.total === 1 ? "" : "s"}
                {isFetching && " · refreshing…"}
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {viewData.items.map((doc) => (
                <Link key={doc.id} href={`/documents/${doc.id}`}>
                  <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate flex flex-col">
                    <CardContent className="p-5 flex flex-col flex-1">
                      <div className="flex justify-between items-start mb-3">
                        <div className="bg-secondary p-2 rounded-md text-primary">
                          <FileText className="h-5 w-5" />
                        </div>
                        {doc.course && (
                          <Badge variant="outline" className="font-mono font-normal">
                            {doc.course.code}
                          </Badge>
                        )}
                      </div>
                      <h3 className="font-serif font-semibold text-lg line-clamp-2 mb-2">{doc.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{doc.description}</p>

                      <div className="mt-auto flex justify-between items-center pt-2">
                        <Badge variant="secondary" className="capitalize text-xs font-normal">
                          {doc.materialType.replace("-", " ")}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatDateTime(doc.createdAt)}</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              ))}
            </div>

            {viewData.total > viewData.pageSize && (
              <div className="flex justify-center mt-8 gap-2">
                <Button variant="outline" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
                  Previous
                </Button>
                <div className="flex items-center px-4 text-sm font-medium">
                  Page {page} of {totalPages}
                </div>
                <Button
                  variant="outline"
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </div>
            )}
          </>
        ) : (
          <div className="text-center py-20 bg-card border border-dashed rounded-xl" data-testid="browse-empty">
            <BookOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4 opacity-50" />
            <h3 className="text-lg font-medium">No materials found</h3>
            <p className="text-muted-foreground mt-2 max-w-md mx-auto">
              {activeFilterCount > 0 || debouncedQuery
                ? "Try removing some filters or broadening your search."
                : "Nothing has been uploaded yet. Be the first to share."}
            </p>
            {(activeFilterCount > 0 || debouncedQuery) && (
              <Button variant="outline" className="mt-6" onClick={clearAll}>
                Clear filters
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <Badge variant="secondary" className="gap-1 pr-1">
      <span>{children}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-sm hover:bg-background/60 p-0.5"
        aria-label="Remove filter"
      >
        <X className="h-3 w-3" />
      </button>
    </Badge>
  );
}
