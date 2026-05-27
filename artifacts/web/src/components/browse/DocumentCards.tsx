import { Link } from "wouter";
import type { Document } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/document-detail/StatusBadge";
import { formatDateTime } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";
import { renderSnippetHtml } from "@/lib/snippet";

interface Props {
  items: (Document & { headline?: string })[];
}

export default function DocumentCards({ items }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((doc) => (
        <Link key={doc.id} href={`/documents/${doc.id}`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate flex flex-col">
            <CardContent className="p-5 flex flex-col flex-1">
              <div className="flex justify-between items-start mb-3">
                {doc.thumbnailUrl ? (
                  <img
                    src={apiUrl(doc.thumbnailUrl)}
                    alt=""
                    aria-hidden="true"
                    loading="lazy"
                    className="h-12 w-12 object-cover rounded-md border bg-secondary"
                    data-testid="doc-thumbnail"
                  />
                ) : (
                  (() => {
                    const Icon = iconForFallbackType(
                      doc.fallbackIconType as FallbackIconType | undefined,
                    );
                    return (
                      <div
                        className="bg-secondary p-2 rounded-md text-primary"
                        data-testid="doc-fallback-icon"
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                    );
                  })()
                )}
                {doc.course && (
                  <Badge variant="outline" className="font-mono font-normal">
                    {doc.course.code}
                  </Badge>
                )}
              </div>
              <h3 className="font-serif font-semibold text-lg line-clamp-2 mb-2">{doc.title}</h3>
              {doc.headline ? (
                <p
                  className="text-sm text-muted-foreground line-clamp-2 mb-4 [&_mark]:bg-yellow-200/60 [&_mark]:text-foreground [&_mark]:rounded [&_mark]:px-0.5"
                  data-testid="doc-snippet"
                  dangerouslySetInnerHTML={{ __html: renderSnippetHtml(doc.headline) }}
                />
              ) : (
                <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{doc.description}</p>
              )}

              <div className="mt-auto flex justify-between items-center pt-2 gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <Badge variant="secondary" className="capitalize text-xs font-normal">
                    {formatMaterialType(doc.materialType)}
                  </Badge>
                  {doc.status !== "published" && <StatusBadge status={doc.status} />}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">{formatDateTime(doc.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
