import type { SearchFacets } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { formatMaterialType } from "@/lib/material-types";
import { cn } from "@/lib/utils";

interface Props {
  facets: SearchFacets | undefined;
  loading?: boolean;
  active: {
    courseId?: string;
    materialType?: string;
    semester?: string;
    status?: string;
    uploaderId?: string;
  };
  onPick: (dim: FacetDim, value: string) => void;
}

export type FacetDim =
  | "courseId"
  | "materialType"
  | "semester"
  | "status"
  | "uploaderId";

const STATUS_ACTIVE_CLASS: Record<string, string> = {
  published:      "bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white",
  approved:       "bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white",
  pending_review: "bg-amber-500 hover:bg-amber-600 border-amber-500 text-white",
  draft:          "bg-slate-500 hover:bg-slate-600 border-slate-500 text-white",
  rejected:       "bg-rose-600 hover:bg-rose-700 border-rose-600 text-white",
};

/**
 * Lazy facet panel. Renders a row of chips per dimension, each
 * labelled with the count and clickable to toggle the corresponding
 * filter (clicking the already-active value clears it).
 */
export default function FacetChips({ facets, loading, active, onPick }: Props) {
  if (loading && !facets) {
    return (
      <div className="text-xs text-muted-foreground" data-testid="facets-loading">
        Loading facets…
      </div>
    );
  }
  if (!facets) return null;

  const sections: Array<{
    title: string;
    dim: FacetDim;
    chips: { value: string; label: string; count: number }[];
  }> = [
    {
      title: "Course",
      dim: "courseId",
      chips: facets.course.map((c) => ({
        value: c.id,
        label: c.code,
        count: c.count,
      })),
    },
    {
      title: "Type",
      dim: "materialType",
      chips: facets.materialType.map((m) => ({
        value: m.value,
        label: formatMaterialType(m.value),
        count: m.count,
      })),
    },
    {
      title: "Semester",
      dim: "semester",
      chips: facets.semester.map((s) => ({
        value: s.value,
        label: s.value,
        count: s.count,
      })),
    },
    {
      title: "Status",
      dim: "status",
      chips: facets.status.map((s) => ({
        value: s.value,
        label: s.value.replace("_", " "),
        count: s.count,
      })),
    },
    {
      title: "Uploader",
      dim: "uploaderId",
      chips: facets.uploader.map((u) => ({
        value: u.id,
        label: u.displayName,
        count: u.count,
      })),
    },
  ];

  const visibleSections = sections.filter((s) => s.chips.length > 0);
  if (visibleSections.length === 0) return null;

  return (
    <div className="space-y-2.5" data-testid="facet-chips">
      {visibleSections.map((s) => (
        <div key={s.dim} className="flex items-start gap-3 text-xs">
          <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider shrink-0 mt-[5px] w-[58px]">
            {s.title}
          </span>
          <div className="flex flex-wrap gap-1.5">
            {s.chips.slice(0, 12).map((c) => {
              const isActive = active[s.dim] === c.value;
              const activeClass =
                s.dim === "status" && isActive
                  ? STATUS_ACTIVE_CLASS[c.value] ?? ""
                  : s.dim === "courseId" && isActive
                  ? "bg-emerald-700 hover:bg-emerald-800 border-emerald-700 text-white"
                  : "";

              return (
                <button
                  key={c.value}
                  type="button"
                  onClick={() => onPick(s.dim, c.value)}
                  data-testid={`facet-${s.dim}-${c.value}`}
                >
                  <Badge
                    variant={isActive ? "default" : "secondary"}
                    className={cn(
                      "capitalize cursor-pointer hover-elevate transition-all text-xs py-0.5",
                      isActive && activeClass,
                      !isActive && "hover:bg-muted-foreground/10",
                    )}
                  >
                    {c.label}
                    <span className="ml-1.5 text-[10px] opacity-60 tabular-nums">
                      {c.count}
                    </span>
                  </Badge>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
