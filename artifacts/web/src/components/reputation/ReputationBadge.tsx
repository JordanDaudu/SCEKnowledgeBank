import { Award } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ReputationLevelData {
  key: "novice" | "contributor" | "scholar" | "sage" | string;
  label: string;
  minScore?: number;
}

// Per-level accent. Sage/scholar get warmer/cooler emphasis so higher levels
// read as more prestigious; novice stays muted.
const LEVEL_STYLES: Record<string, string> = {
  novice: "border-muted-foreground/20 bg-muted text-muted-foreground",
  contributor: "border-primary/30 bg-primary/10 text-primary",
  scholar: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400",
  sage: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
};

/**
 * Compact level + score chip shown next to an author's name (document cards,
 * detail) and on the profile. Subtle by design so it never crowds a card.
 */
export function ReputationBadge({
  level,
  score,
  showScore = true,
  size = "sm",
  className,
}: {
  level: ReputationLevelData;
  score?: number;
  showScore?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border font-medium",
        LEVEL_STYLES[level.key] ?? LEVEL_STYLES.novice,
        size === "sm" ? "px-1.5 py-0.5 text-[11px]" : "px-2 py-1 text-xs",
        className,
      )}
      data-testid="reputation-badge"
    >
      <Award className={size === "sm" ? "h-3 w-3" : "h-3.5 w-3.5"} />
      <span>{level.label}</span>
      {showScore && typeof score === "number" ? (
        <span className="opacity-70">· {score}</span>
      ) : null}
    </span>
  );
}
