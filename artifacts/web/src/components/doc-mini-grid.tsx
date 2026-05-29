import { Link } from "wouter";
import type { Document } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { formatMaterialType } from "@/lib/material-types";

/**
 * Compact responsive grid of document mini-cards. Shared by the Prep Hub
 * Quick Access lanes and the dashboard widgets so they render consistently.
 */
export function DocMiniGrid({
  docs,
  max = 6,
}: {
  docs: Document[];
  max?: number;
}) {
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {docs.slice(0, max).map((d) => (
        <Link key={d.id} href={`/documents/${d.id}`}>
          <Card className="hover-elevate h-full transition-colors">
            <CardContent className="p-3">
              <p className="truncate text-sm font-medium">{d.title}</p>
              <p className="truncate text-xs text-muted-foreground">
                {formatMaterialType(d.materialType)}
                {d.course ? ` · ${d.course.code}` : ""}
              </p>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
