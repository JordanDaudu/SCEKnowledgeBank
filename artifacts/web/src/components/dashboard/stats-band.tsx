import { useEffect, useRef, useState } from "react";
import {
  useListDocuments,
  useListCourses,
  useListCategories,
} from "@workspace/api-client-react";
import { useTranslation } from "react-i18next";
import { FileText, GraduationCap, Layers, type LucideIcon } from "lucide-react";

/**
 * Counts from 0 → target with an ease-out curve the first time `target`
 * becomes positive. Honours prefers-reduced-motion by snapping to the value.
 */
function useCountUp(target: number, durationMs = 1200): number {
  const [value, setValue] = useState(0);
  const playedRef = useRef(false);

  useEffect(() => {
    if (target <= 0) return;
    if (playedRef.current) {
      setValue(target);
      return;
    }
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    if (reduce) {
      setValue(target);
      playedRef.current = true;
      return;
    }
    playedRef.current = true;
    let raf = 0;
    let start: number | null = null;
    const tick = (ts: number) => {
      if (start === null) start = ts;
      const p = Math.min(1, (ts - start) / durationMs);
      const eased = 1 - Math.pow(1 - p, 3); // easeOutCubic
      setValue(Math.round(target * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, durationMs]);

  return value;
}

function Stat({
  icon: Icon,
  value,
  label,
}: {
  icon: LucideIcon;
  value: number;
  label: string;
}) {
  const animated = useCountUp(value);
  return (
    <div className="flex items-center gap-2.5">
      <Icon className="h-4 w-4 text-primary/70 shrink-0" />
      <span className="font-serif text-lg font-bold tabular-nums text-foreground leading-none">
        {animated.toLocaleString()}
      </span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

/**
 * A slim "living" strip under the hero showing the platform's scale —
 * materials, courses, and subjects — with the numbers counting up on load.
 * Renders nothing until at least one real count is available, so it never
 * flashes a row of zeros.
 */
export function StatsBand() {
  const { t } = useTranslation();
  const { data: docs } = useListDocuments({ sort: "newest", pageSize: 1 });
  const { data: courses } = useListCourses();
  const { data: categories } = useListCategories();

  const materials = docs?.total ?? 0;
  const courseCount = courses?.length ?? 0;
  const subjectCount = categories?.length ?? 0;

  if (materials + courseCount + subjectCount === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-3 sm:gap-x-10">
      <Stat icon={FileText} value={materials} label={t("home.statsMaterials")} />
      <span aria-hidden className="hidden sm:block h-4 w-px bg-border" />
      <Stat icon={GraduationCap} value={courseCount} label={t("home.statsCourses")} />
      <span aria-hidden className="hidden sm:block h-4 w-px bg-border" />
      <Stat icon={Layers} value={subjectCount} label={t("home.statsSubjects")} />
    </div>
  );
}
