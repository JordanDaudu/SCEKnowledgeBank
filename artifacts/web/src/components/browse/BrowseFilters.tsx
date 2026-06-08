import type { Course, Category, Tag } from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
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

// Canonical ranking sorts (Refinement Phase 2). Legacy values
// ("newest"/"popularity") are still accepted by the API and tolerated from
// old bookmarked URLs, but the UI offers the canonical set below.
export type Sort =
  | "relevance"
  | "recent"
  | "viewed"
  | "downloaded"
  | "favorited"
  | "trending"
  | "oldest"
  | "title"
  | "newest"
  | "popularity";
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
  const { t } = useTranslation();
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
            {t("browse.filters.filters")}
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ms-1 px-1.5">{activeFilterCount}</Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[360px] max-h-[70vh] overflow-y-auto" align="end">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h4 className="font-medium text-sm">{t("browse.filters.refine")}</h4>
              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" onClick={clearAll} className="h-auto px-2 py-1 text-xs">
                  {t("browse.filters.clearAll")}
                </Button>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5 col-span-2">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.course")}</label>
                <Select value={courseId} onValueChange={setCourseId}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("browse.filters.allCourses")}</SelectItem>
                    {courses?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5 col-span-2">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.lecturer")}</label>
                <Input
                  value={lecturerName}
                  onChange={(e) => setLecturerName(e.target.value)}
                  placeholder={t("browse.filters.lecturerPlaceholder")}
                  className="bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.semester")}</label>
                <Select
                  value={semester || "any"}
                  onValueChange={(val) => setSemester(val === "any" ? "" : (val as Semester))}
                >
                  <SelectTrigger className="bg-background"><SelectValue placeholder={t("browse.filters.any")} /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">{t("browse.filters.anySemester")}</SelectItem>
                    <SelectItem value="fall">{t("browse.filters.fall")}</SelectItem>
                    <SelectItem value="spring">{t("browse.filters.spring")}</SelectItem>
                    <SelectItem value="summer">{t("browse.filters.summer")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.academicYear")}</label>
                <Input
                  type="number"
                  value={academicYear}
                  onChange={(e) => setAcademicYear(e.target.value)}
                  placeholder={t("browse.filters.yearPlaceholder")}
                  className="bg-background"
                />
              </div>

              <div className="space-y-1.5 col-span-2">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.category")}</label>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t("browse.filters.allCategories")}</SelectItem>
                    {categories?.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.uploadedFrom")}</label>
                <Input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => setDateFrom(e.target.value)}
                  className="bg-background"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.uploadedTo")}</label>
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
                <label className="text-xs font-medium text-muted-foreground">{t("browse.filters.tags")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant={tagIds.includes(tag.id) ? "default" : "outline"}
                      className="cursor-pointer"
                      onClick={() => toggleTag(tag.id)}
                    >
                      {tag.name}
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
          <SelectValue placeholder={t("browse.filters.allTypes")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">{t("browse.filters.allTypes")}</SelectItem>
          {MATERIAL_TYPES.map((mt) => (
            <SelectItem key={mt.value} value={mt.value} className="capitalize">{mt.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select value={sort} onValueChange={(val) => setSort(val as Sort)}>
        <SelectTrigger className="w-[150px] bg-background">
          <SelectValue placeholder={t("browse.filters.sortBy")} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="relevance">{t("browse.sort.relevance")}</SelectItem>
          <SelectItem value="recent">{t("browse.sort.recent")}</SelectItem>
          <SelectItem value="trending">{t("browse.sort.trending")}</SelectItem>
          <SelectItem value="viewed">{t("browse.sort.viewed")}</SelectItem>
          <SelectItem value="downloaded">{t("browse.sort.downloaded")}</SelectItem>
          <SelectItem value="favorited">{t("browse.sort.favorited")}</SelectItem>
          <SelectItem value="oldest">{t("browse.sort.oldest")}</SelectItem>
          <SelectItem value="title">{t("browse.sort.title")}</SelectItem>
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
  const { t } = useTranslation();
  if (p.activeFilterCount === 0) return null;
  return (
    <div className="flex flex-wrap gap-2 items-center w-full">
      <span className="text-xs text-muted-foreground">{t("browse.filters.active")}</span>
      {p.courseId !== "all" && (
        <FilterChip onClear={() => p.setCourseId("all")}>
          {t("browse.filters.chipCourse", { value: p.courses?.find((c) => c.id === p.courseId)?.code ?? p.courseId })}
        </FilterChip>
      )}
      {p.debouncedLecturer && (
        <FilterChip onClear={() => p.setLecturerName("")}>{t("browse.filters.chipLecturer", { value: p.debouncedLecturer })}</FilterChip>
      )}
      {p.semester && (
        <FilterChip onClear={() => p.setSemester("")}>
          {t("browse.filters.chipSemester", { value: t(`browse.filters.${p.semester}`) })}
        </FilterChip>
      )}
      {p.academicYear && (
        <FilterChip onClear={() => p.setAcademicYear("")}>{t("browse.filters.chipYear", { value: p.academicYear })}</FilterChip>
      )}
      {p.categoryId !== "all" && (
        <FilterChip onClear={() => p.setCategoryId("all")}>
          {t("browse.filters.chipCategory", { value: p.categories?.find((c) => c.id === p.categoryId)?.name ?? p.categoryId })}
        </FilterChip>
      )}
      {p.materialType !== "all" && (
        <FilterChip onClear={() => p.setMaterialType("all")}>
          {t("browse.filters.chipType", { value: formatMaterialType(p.materialType) })}
        </FilterChip>
      )}
      {p.tagIds.map((id) => (
        <FilterChip key={id} onClear={() => p.toggleTag(id)}>
          {t("browse.filters.chipTag", { value: p.tags?.find((tg) => tg.id === id)?.name ?? id })}
        </FilterChip>
      ))}
      {p.dateFrom && <FilterChip onClear={() => p.setDateFrom("")}>{t("browse.filters.chipFrom", { value: p.dateFrom })}</FilterChip>}
      {p.dateTo && <FilterChip onClear={() => p.setDateTo("")}>{t("browse.filters.chipTo", { value: p.dateTo })}</FilterChip>}
      <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={p.clearAll}>
        {t("browse.filters.clearAll")}
      </Button>
    </div>
  );
}

function FilterChip({ children, onClear }: { children: React.ReactNode; onClear: () => void }) {
  const { t } = useTranslation();
  return (
    <span className="inline-flex items-center gap-1 pe-1 ps-2.5 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary border border-primary/20">
      <span>{children}</span>
      <button
        type="button"
        onClick={onClear}
        className="rounded-full hover:bg-primary/20 p-0.5 transition-colors"
        aria-label={t("browse.filters.removeFilter")}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}
