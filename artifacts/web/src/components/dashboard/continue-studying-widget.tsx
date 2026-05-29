import { Link } from "wouter";
import {
  useListContinueStudying,
  getListContinueStudyingQueryKey,
} from "@workspace/api-client-react";
import { DocMiniGrid } from "@/components/doc-mini-grid";
import { PlayCircle } from "lucide-react";

/**
 * Phase 8 — "Continue studying" dashboard widget. Surfaces documents the user
 * has marked as reviewing in the Prep Hub. Renders nothing when empty so it
 * stays out of the way for users who haven't started any.
 */
export function ContinueStudyingWidget() {
  const { data } = useListContinueStudying({
    query: { queryKey: getListContinueStudyingQueryKey(), staleTime: 30_000 },
  });

  if (!data || data.length === 0) return null;

  return (
    <section aria-label="Continue studying">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-foreground">
          <PlayCircle className="h-5 w-5 text-primary" />
          Continue studying
        </h2>
        <Link
          href="/prep-hub"
          className="text-sm font-medium text-primary hover:underline"
        >
          Prep Hub
        </Link>
      </div>
      <DocMiniGrid docs={data} />
    </section>
  );
}
