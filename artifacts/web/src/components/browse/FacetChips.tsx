import type { SearchFacets } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { formatMaterialType } from "@/lib/material-types";

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
        label: s.value,
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

  return (
    <div className="space-y-2" data-testid="facet-chips">
      {sections
        .filter((s) => s.chips.length > 0)
        .map((s) => {
          // Status is shown for situational awareness only on the browse
          // page — status filtering lives in the review queue, so the
          // chips render as flat pills (no button semantics, no hover
          // affordance) to avoid promising an interaction we don't honour.
          const interactive = s.dim !== "status";
          return (
            <div key={s.dim} className="flex items-start gap-2 text-xs">
              <span className="font-medium text-muted-foreground shrink-0 mt-0.5 w-16">
                {s.title}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {s.chips.slice(0, 12).map((c) => {
                  const isActive = interactive && active[s.dim] === c.value;
                  const inner = (
                    <Badge
                      variant={isActive ? "default" : "outline"}
                      className={
                        interactive
                          ? "capitalize cursor-pointer hover-elevate"
                          : "capitalize"
                      }
                    >
                      {c.label}
                      <span className="ml-1.5 text-[10px] opacity-70">
                        {c.count}
                      </span>
                    </Badge>
                  );
                  return interactive ? (
                    <button
                      key={c.value}
                      type="button"
                      onClick={() => onPick(s.dim, c.value)}
                      data-testid={`facet-${s.dim}-${c.value}`}
                    >
                      {inner}
                    </button>
                  ) : (
                    <span
                      key={c.value}
                      data-testid={`facet-${s.dim}-${c.value}`}
                    >
                      {inner}
                    </span>
                  );
                })}
              </div>
            </div>
          );
        })}
    </div>
  );
}
