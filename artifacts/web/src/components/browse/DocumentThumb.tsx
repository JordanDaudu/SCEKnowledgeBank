import type { Document } from "@workspace/api-client-react";
import { apiUrl } from "@/lib/api-url";
import {
  iconForFallbackType,
  type FallbackIconType,
} from "@/lib/fallback-icon";

interface Props {
  doc: Pick<Document, "thumbnailUrl" | "fallbackIconType" | "title">;
  /** Tailwind size class for the icon (height + width). */
  iconClassName?: string;
  /** Wrapper class — controls box size and bg. */
  className?: string;
}

/**
 * Renders a document's server-generated thumbnail if present,
 * otherwise the MIME-derived fallback icon. The thumbnail URL is
 * already a signed URL from the API — we just route it through
 * `apiUrl` so the dev proxy / base path is applied correctly.
 */
export default function DocumentThumb({
  doc,
  iconClassName = "h-5 w-5",
  className = "bg-secondary p-2 rounded-md text-primary",
}: Props) {
  if (doc.thumbnailUrl) {
    return (
      <img
        src={apiUrl(doc.thumbnailUrl)}
        alt=""
        className={className}
        loading="lazy"
        aria-hidden="true"
      />
    );
  }
  const Icon = iconForFallbackType(
    doc.fallbackIconType as FallbackIconType | undefined,
  );
  return (
    <div className={className}>
      <Icon className={iconClassName} />
    </div>
  );
}
