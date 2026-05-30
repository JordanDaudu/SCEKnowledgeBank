import { Skeleton } from "@/components/ui/skeleton";
import { CollectionGrid } from "@/components/collections/CollectionCard";
import type { StudyCollectionSummary } from "@workspace/api-client-react";

interface DiscoverySectionProps {
  title: string;
  icon?: React.ReactNode;
  collections: StudyCollectionSummary[] | undefined;
  isLoading?: boolean;
  testid?: string;
}

/**
 * A labeled section for the Prep Hub discovery homepage.
 * Renders nothing when not loading and the list is empty.
 */
export function DiscoverySection({
  title,
  icon,
  collections,
  isLoading = false,
  testid,
}: DiscoverySectionProps) {
  if (!isLoading && (!collections || collections.length === 0)) return null;

  return (
    <section aria-label={title}>
      <h2 className="mb-3 flex items-center gap-2 font-serif text-xl font-bold text-foreground">
        {icon}
        {title}
      </h2>
      {isLoading || !collections ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full" />
          ))}
        </div>
      ) : (
        <CollectionGrid collections={collections} basePath="/prep-hub" testid={testid} />
      )}
    </section>
  );
}
