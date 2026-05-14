import { Link } from "wouter";
import type { Document } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FileText } from "lucide-react";
import { formatDateTime } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";

interface Props {
  items: Document[];
}

export default function DocumentCards({ items }: Props) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
      {items.map((doc) => (
        <Link key={doc.id} href={`/documents/${doc.id}`}>
          <Card className="hover:border-primary/50 transition-colors cursor-pointer h-full hover-elevate flex flex-col">
            <CardContent className="p-5 flex flex-col flex-1">
              <div className="flex justify-between items-start mb-3">
                <div className="bg-secondary p-2 rounded-md text-primary">
                  <FileText className="h-5 w-5" />
                </div>
                {doc.course && (
                  <Badge variant="outline" className="font-mono font-normal">
                    {doc.course.code}
                  </Badge>
                )}
              </div>
              <h3 className="font-serif font-semibold text-lg line-clamp-2 mb-2">{doc.title}</h3>
              <p className="text-sm text-muted-foreground line-clamp-2 mb-4">{doc.description}</p>

              <div className="mt-auto flex justify-between items-center pt-2">
                <Badge variant="secondary" className="capitalize text-xs font-normal">
                  {formatMaterialType(doc.materialType)}
                </Badge>
                <span className="text-xs text-muted-foreground">{formatDateTime(doc.createdAt)}</span>
              </div>
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}
