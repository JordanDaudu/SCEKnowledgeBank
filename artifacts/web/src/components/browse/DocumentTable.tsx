import { Link } from "wouter";
import type { Document } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { formatMaterialType } from "@/lib/material-types";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";

interface Props {
  items: Document[];
}

export default function DocumentTable({ items }: Props) {
  return (
    <div className="bg-card border rounded-xl overflow-hidden shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            <TableHead>Course</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Uploaded</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((doc) => (
            <TableRow key={doc.id} className="cursor-pointer">
              <TableCell className="font-medium">
                <Link href={`/documents/${doc.id}`}>
                  <span className="inline-flex items-center gap-2 hover:underline">
                    {doc.thumbnailUrl ? (
                      <img
                        src={apiUrl(doc.thumbnailUrl)}
                        alt=""
                        aria-hidden="true"
                        loading="lazy"
                        className="h-6 w-6 object-cover rounded border"
                      />
                    ) : (
                      (() => {
                        const Icon = iconForFallbackType(
                          doc.fallbackIconType as
                            | FallbackIconType
                            | undefined,
                        );
                        return (
                          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                        );
                      })()
                    )}
                    {doc.title}
                  </span>
                </Link>
              </TableCell>
              <TableCell>
                {doc.course ? (
                  <Badge variant="outline" className="font-mono font-normal">
                    {doc.course.code}
                  </Badge>
                ) : (
                  <span className="text-muted-foreground text-xs">—</span>
                )}
              </TableCell>
              <TableCell>
                <Badge variant="secondary" className="capitalize text-xs font-normal">
                  {formatMaterialType(doc.materialType)}
                </Badge>
              </TableCell>
              <TableCell className="text-muted-foreground text-xs">
                {formatDateTime(doc.createdAt)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
