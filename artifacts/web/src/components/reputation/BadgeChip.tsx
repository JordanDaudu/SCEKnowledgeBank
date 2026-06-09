import {
  Award,
  Download,
  Files,
  FolderHeart,
  Library,
  MessageSquare,
  ShieldCheck,
  Star,
  ThumbsUp,
  Upload,
  type LucideIcon,
} from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Badge view shape mirrors the API `ReputationBadge` schema. */
export interface BadgeChipData {
  key: string;
  name: string;
  description: string;
  icon: string;
}

// Map the API's lucide icon names to components. Unknown names fall back to a
// generic award icon so a new badge never crashes the UI.
const ICONS: Record<string, LucideIcon> = {
  Upload,
  Files,
  Library,
  Download,
  Star,
  ShieldCheck,
  MessageSquare,
  ThumbsUp,
  FolderHeart,
};

export function BadgeChip({
  badge,
  earned = true,
  progress,
  size = "md",
}: {
  badge: BadgeChipData;
  /** Earned badges render in full colour; locked ones are greyed. */
  earned?: boolean;
  /** Optional progress hint shown in the tooltip for locked badges. */
  progress?: string;
  /** `md` (48px) on the badge shelf; `sm` (32px) inline in lists. */
  size?: "sm" | "md";
}) {
  const Icon = ICONS[badge.icon] ?? Award;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex items-center justify-center rounded-full border transition-colors",
            size === "sm" ? "h-8 w-8" : "h-12 w-12",
            earned
              ? "border-primary/30 bg-primary/10 text-primary"
              : "border-muted bg-muted/40 text-muted-foreground/50",
          )}
          aria-label={badge.name}
          data-testid={`badge-${badge.key}`}
        >
          <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p className="font-medium">{badge.name}</p>
        <p className="text-xs text-muted-foreground">{badge.description}</p>
        {!earned && progress ? (
          <p className="mt-1 text-xs text-muted-foreground">{progress}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}
