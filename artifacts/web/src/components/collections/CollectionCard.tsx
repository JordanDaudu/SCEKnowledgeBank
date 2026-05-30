import { Link } from "wouter";
import { type StudyCollectionSummary } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FolderOpen, Users, TrendingUp } from "lucide-react";

export const KIND_LABEL: Record<string, string> = {
  collection: "Collection",
  exam_prep: "Exam prep",
  revision: "Revision",
  semester: "Semester",
  learning_path: "Learning path",
};

/** A study-bundle (collection) card with progress + follower count, reused
 *  across the Collections workspace, Suggested bundles, and Discover. The
 *  link target is configurable via `basePath` so the same card links to the
 *  manage view (`/collections`) or the read-only Prep Hub view (`/prep-hub`). */
export function CollectionCard({
  c,
  basePath,
}: {
  c: StudyCollectionSummary;
  basePath: string;
}) {
  return (
    <Link href={`${basePath}/${c.id}`}>
      <Card className="hover-elevate h-full cursor-pointer transition-colors">
        <CardContent className="flex h-full flex-col p-4">
          <div className="mb-2 flex items-start justify-between gap-2">
            <FolderOpen className="h-5 w-5 text-primary" />
            <div className="flex items-center gap-1.5">
              {c.isOfficial && (
                <Badge variant="outline" className="border-primary/40 text-[10px] text-primary">
                  Official
                </Badge>
              )}
              <Badge variant="outline" className="text-[10px]">
                {KIND_LABEL[c.kind] ?? c.kind}
              </Badge>
            </div>
          </div>
          <h3 className="font-serif font-semibold leading-snug text-foreground">
            {c.title}
          </h3>
          {c.description && (
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
              {c.description}
            </p>
          )}
          {c.progressPercent > 0 && (
            <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary"
                style={{ width: `${c.progressPercent}%` }}
              />
            </div>
          )}
          <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-xs text-muted-foreground tabular-nums">
            <span>
              {c.itemCount} {c.itemCount === 1 ? "document" : "documents"}
            </span>
            <span
              className="inline-flex items-center gap-1 text-primary/80"
              title="Popularity score (followers × 3 + materials)"
            >
              <TrendingUp className="h-3 w-3" />
              {c.popularityScore}
            </span>
            {c.followerCount > 0 && (
              <span className="inline-flex items-center gap-1" title="Followers">
                <Users className="h-3 w-3" />
                {c.followerCount}
              </span>
            )}
            {c.progressPercent > 0 && <span>{c.progressPercent}% done</span>}
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}

export function CollectionGrid({
  collections,
  basePath,
  testid,
}: {
  collections: StudyCollectionSummary[];
  basePath: string;
  testid?: string;
}) {
  return (
    <div
      className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
      data-testid={testid}
    >
      {collections.map((c) => (
        <CollectionCard key={c.id} c={c} basePath={basePath} />
      ))}
    </div>
  );
}
