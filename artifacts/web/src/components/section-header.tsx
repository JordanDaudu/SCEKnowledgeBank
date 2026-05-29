import { Link } from "wouter";
import { ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  actionHref?: string;
  /** Defaults to "View all". */
  actionLabel?: string;
  /** "lg" = promoted (text-2xl); "md" = secondary (text-xl, default). */
  size?: "lg" | "md";
}

/**
 * Consistent section header for the dashboard's content bands. The `size`
 * prop drives the visual tier: the promoted band uses "lg", secondary bands
 * use "md", so the page reads with a clear hierarchy instead of a flat stack
 * of identical headers.
 */
export function SectionHeader({
  icon: Icon,
  title,
  subtitle,
  actionHref,
  actionLabel = "View all",
  size = "md",
}: SectionHeaderProps) {
  const lg = size === "lg";
  return (
    <div className="mb-4 flex items-end justify-between gap-4">
      <div className="flex items-start gap-2.5 min-w-0">
        <Icon
          className={cn(
            "shrink-0 text-primary",
            lg ? "h-6 w-6 mt-0.5" : "h-5 w-5 mt-0.5",
          )}
        />
        <div className="min-w-0">
          <h2
            className={cn(
              "font-serif font-bold leading-tight",
              lg ? "text-2xl" : "text-xl",
            )}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      </div>
      {actionHref && (
        <Link
          href={actionHref}
          className="flex shrink-0 items-center text-sm font-medium text-primary hover:underline"
        >
          {actionLabel}
          <ChevronRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
