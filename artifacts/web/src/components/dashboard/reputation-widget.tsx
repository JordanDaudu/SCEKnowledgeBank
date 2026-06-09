import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Trophy, ChevronRight } from "lucide-react";
import {
  useGetUserReputation,
  getGetUserReputationQueryKey,
  useGetLeaderboard,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { ReputationBadge } from "@/components/reputation/ReputationBadge";
import { cn } from "@/lib/utils";

/**
 * Compact home-dashboard card: the viewer's own reputation snapshot plus a
 * top-3 contributors mini-list that links through to the full leaderboard.
 */
export function ReputationHomeWidget({ userId }: { userId: string }) {
  const { t } = useTranslation();
  const { data: rep } = useGetUserReputation(userId, {
    query: { queryKey: getGetUserReputationQueryKey(userId), enabled: !!userId },
  });
  const { data: lb } = useGetLeaderboard();
  const top = lb?.rows.slice(0, 3) ?? [];

  return (
    <Card>
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">{t("reputation.yourReputation")}</h3>
          </div>
          {rep ? <ReputationBadge level={rep.level} score={rep.score} /> : null}
        </div>

        {top.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">
              {t("reputation.topContributors")}
            </p>
            {top.map((row) => (
              <div key={row.userId} className="flex items-center gap-2 text-sm">
                <span
                  className={cn(
                    "w-4 text-center text-xs font-semibold tabular-nums",
                    row.userId === userId ? "text-primary" : "text-muted-foreground",
                  )}
                >
                  {row.rank}
                </span>
                <span className="min-w-0 flex-1 truncate">{row.displayName}</span>
                <span className="text-xs font-medium tabular-nums text-muted-foreground">
                  {row.score}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <Link
          href="/leaderboard"
          className="flex items-center justify-end gap-0.5 text-xs font-medium text-primary hover:underline"
        >
          {t("nav.leaderboard")}
          <ChevronRight className="h-3 w-3" />
        </Link>
      </CardContent>
    </Card>
  );
}
