import { useTranslation } from "react-i18next";
import { Trophy } from "lucide-react";
import {
  useGetLeaderboard,
  useGetCurrentUser,
  type LeaderboardRow,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { ReputationBadge } from "@/components/reputation/ReputationBadge";
import { BadgeChip } from "@/components/reputation/BadgeChip";
import { apiUrl } from "@/lib/api-url";
import { cn } from "@/lib/utils";

function RankCell({ rank }: { rank: number }) {
  // Top three get a coloured medal tint; the rest a plain number.
  const medal =
    rank === 1
      ? "text-amber-500"
      : rank === 2
        ? "text-zinc-400"
        : rank === 3
          ? "text-orange-600"
          : "text-muted-foreground";
  return (
    <span className={cn("w-6 text-center text-sm font-semibold tabular-nums", medal)}>
      {rank <= 3 ? "🏅" : rank}
    </span>
  );
}

function LeaderboardRowItem({
  row,
  isMe,
}: {
  row: LeaderboardRow;
  isMe: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-md px-2 py-2",
        isMe && "bg-primary/5 ring-1 ring-primary/20",
      )}
      data-testid={`leaderboard-row-${row.rank}`}
    >
      <RankCell rank={row.rank} />
      <Avatar className="h-9 w-9">
        {row.avatarUrl ? <AvatarImage src={apiUrl(row.avatarUrl)} alt="" /> : null}
        <AvatarFallback>
          {row.displayName.charAt(0).toUpperCase()}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">
          {row.displayName}
          {isMe ? (
            <span className="ml-1 text-xs text-primary">({t("leaderboard.you")})</span>
          ) : null}
        </p>
        <ReputationBadge level={row.level} showScore={false} />
      </div>
      <div className="hidden items-center gap-1 sm:flex">
        {row.topBadges.map((b) => (
          <BadgeChip key={b.key} badge={b} size="sm" />
        ))}
      </div>
      <span className="w-14 text-right text-sm font-semibold tabular-nums">
        {row.score}
      </span>
    </div>
  );
}

export default function Leaderboard() {
  const { t } = useTranslation();
  const { data, isLoading } = useGetLeaderboard();
  const { data: me } = useGetCurrentUser();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Trophy className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("leaderboard.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("leaderboard.subtitle")}</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-3">
          {isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-2 py-2">
                  <Skeleton className="h-6 w-6" />
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <Skeleton className="h-4 flex-1" />
                  <Skeleton className="h-4 w-14" />
                </div>
              ))}
            </div>
          ) : !data || data.rows.length === 0 ? (
            <p className="px-2 py-8 text-center text-sm text-muted-foreground">
              {t("leaderboard.empty")}
            </p>
          ) : (
            <div className="divide-y">
              {data.rows.map((row) => (
                <LeaderboardRowItem
                  key={row.userId}
                  row={row}
                  isMe={!!me && me.id === row.userId}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
