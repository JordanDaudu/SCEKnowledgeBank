import type { Course, Category, Tag } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SlidersHorizontal, X } from "lucide-react";
import { MATERIAL_TYPES, formatMaterialType } from "@/lib/material-types";

export type Sort = "newest" | "oldest" | "title" | "popularity";
export type Semester = "fall" | "spring" | "summer" | "";

interface Props {
  courseId: string;
  setCourseId: (v: string) => void;
  lecturerName: string;
  setLecturerName: (v: string) => void;
  semester: Semester;
  setSemester: (v: Semester) => void;
  academicYear: string;
  setAcademicYear: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  materialType: string;
  setMaterialType: (v: string) => void;
  tagIds: string[];
  toggleTag: (id: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  sort: Sort;
  setSort: (v: Sort) => void;
  courses: Course[] | undefined;
  categories: Category[] | undefined;
  tags: Tag[] | undefined;
  debouncedLecturer: string;
  activeFilterCount: number;
  clearAll: () => void;
}

export default function BrowseFilters(props: Props) {
  const {
    courseId,
    setCourseId,
    lecturerName,
    setLecturerName,
    semester,
    setSemester,
    academicYear,
    setAcademicYear,
    categoryId,
    setCategoryId,
    materialType,
    setMaterialType,
    tagIds,
    toggleTag,
    dateFrom,
    setDateFrom,
    dateTo,
    setDateTo,
    sort,
    setSort,
    courses,
    categories,
    tags,
    debouncedLecturer,
    activeFilterCount,
    clearAll,
  } = props;

  return (
    <>
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
            <SelectItem key={t.value} value={t.value} className="capitalize">{t.label}</SelectItem>
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

      <ActiveChipsContainer
        courseId={courseId}
        setCourseId={setCourseId}
        debouncedLecturer={debouncedLecturer}
        setLecturerName={setLecturerName}
        semester={semester}
        setSemester={setSemester}
        academicYear={academicYear}
        setAcademicYear={setAcademicYear}
        categoryId={categoryId}
        setCategoryId={setCategoryId}
        materialType={materialType}
        setMaterialType={setMaterialType}
        tagIds={tagIds}
        toggleTag={toggleTag}
        dateFrom={dateFrom}
        setDateFrom={setDateFrom}
        dateTo={dateTo}
        setDateTo={setDateTo}
        courses={courses}
        categories={categories}
        tags={tags}
        activeFilterCount={activeFilterCount}
        clearAll={clearAll}
      />
    </>
  );
}

interface ChipsProps {
  courseId: string;
  setCourseId: (v: string) => void;
  debouncedLecturer: string;
  setLecturerName: (v: string) => void;
  semester: Semester;
  setSemester: (v: Semester) => void;
  academicYear: string;
  setAcademicYear: (v: string) => void;
  categoryId: string;
  setCategoryId: (v: string) => void;
  materialType: string;
  setMaterialType: (v: string) => void;
  tagIds: string[];
  toggleTag: (id: string) => void;
  dateFrom: string;
  setDateFrom: (v: string) => void;
  dateTo: string;
  setDateTo: (v: string) => void;
  courses: Course[] | undefined;
  categories: Category[] | undefined;
  tags: Tag[] | undefined;
  activeFilterCount: number;
  clearAll: () => void;
}

function ActiveChipsContainer(p: ChipsProps) {
  if (p.activeFilterCount === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 items-center w-full">
      <span className="text-xs text-muted-foreground">Active:</span>
      {p.courseId !== "all" && (
        <FilterChip onClear={() => p.setCourseId("all")}>
          Course: {p.courses?.find((c) => c.id === p.courseId)?.code ?? p.courseId}
        </FilterChip>
      )}
      {p.debouncedLecturer && (
        <FilterChip onClear={() => p.setLecturerName("")}>Lecturer: {p.debouncedLecturer}</FilterChip>
      )}
      {p.semester && <FilterChip onClear={() => p.setSemester("")}>Semester: {p.semester}</FilterChip>}
      {p.academicYear && (
        <FilterChip onClear={() => p.setAcademicYear("")}>Year: {p.academicYear}</FilterChip>
      )}
      {p.categoryId !== "all" && (
        <FilterChip onClear={() => p.setCategoryId("all")}>
          Category: {p.categories?.find((c) => c.id === p.categoryId)?.name ?? p.categoryId}
        </FilterChip>
      )}
      {p.materialType !== "all" && (
        <FilterChip onClear={() => p.setMaterialType("all")}>
          Type: {formatMaterialType(p.materialType)}
        </FilterChip>
      )}
      {p.tagIds.map((id) => (
        <FilterChip key={id} onClear={() => p.toggleTag(id)}>
          Tag: {p.tags?.find((t) => t.id === id)?.name ?? id}
        </FilterChip>
      ))}
      {p.dateFrom && <FilterChip onClear={() => p.setDateFrom("")}>From: {p.dateFrom}</FilterChip>}
      {p.dateTo && <FilterChip onClear={() => p.setDateTo("")}>To: {p.dateTo}</FilterChip>}
      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={p.clearAll}>
        Clear all
      </Button>
    </div>
  );
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 pr-1 pl-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
      <span>{children}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full hover:bg-primary/20 p-0.5 transition-colors"
        aria-label="Remove filter"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
