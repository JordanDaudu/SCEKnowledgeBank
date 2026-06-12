import { BadgeCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

/**
 * A small "verified contributor" check shown next to a user's name. A user is
 * verified when they are a lecturer, or a member who has contributed more than
 * the upload threshold (decided server-side; see `isVerifiedContributor`). The
 * caller decides whether to render it from the `verified` flag on the user
 * summary / leaderboard row.
 */
export function VerifiedBadge({
  className,
  size = "sm",
}: {
  className?: string;
  size?: "sm" | "md";
}) {
  const { t } = useTranslation();
  const label = t("common.verified");
  return (
    <span
      title={label}
      className="inline-flex shrink-0 align-middle"
      data-testid="verified-badge"
    >
      <BadgeCheck
        aria-label={label}
        className={cn(
          "text-sky-500",
          size === "sm" ? "h-3.5 w-3.5" : "h-4 w-4",
          className,
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
