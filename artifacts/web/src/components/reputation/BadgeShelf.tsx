import { useTranslation } from "react-i18next";
import { BadgeChip, type BadgeChipData } from "./BadgeChip";

/**
 * Grid of badges: earned ones in colour, locked ones greyed. Used on the
 * profile page. `locked` is optional — pass the not-yet-earned set to show
 * what's left to unlock.
 */
export function BadgeShelf({
  earned,
  locked = [],
}: {
  earned: BadgeChipData[];
  locked?: BadgeChipData[];
}) {
  const { t } = useTranslation();

  if (earned.length === 0 && locked.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">{t("reputation.noBadgesYet")}</p>
    );
  }

  return (
    <div className="space-y-4">
      {earned.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            {t("reputation.earnedBadges")}
          </h4>
          <div className="flex flex-wrap gap-3">
            {earned.map((b) => (
              <BadgeChip key={b.key} badge={b} earned />
            ))}
          </div>
        </div>
      ) : null}

      {locked.length > 0 ? (
        <div>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">
            {t("reputation.lockedBadges")}
          </h4>
          <div className="flex flex-wrap gap-3">
            {locked.map((b) => (
              <BadgeChip key={b.key} badge={b} earned={false} />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
