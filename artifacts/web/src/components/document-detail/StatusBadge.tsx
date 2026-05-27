import { Badge } from "@/components/ui/badge";

const LABEL: Record<string, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
};

// Visual weight roughly tracks status risk: rejected = destructive,
// pending = warning-ish (secondary), approved/published = quiet.
type Variant = "default" | "secondary" | "destructive" | "outline";
const VARIANT: Record<string, Variant> = {
  draft: "outline",
  published: "secondary",
  archived: "outline",
  pending_review: "default",
  approved: "secondary",
  rejected: "destructive",
};

export function StatusBadge({ status }: { status: string }) {
  // `published` is the default state for most legacy docs; rendering
  // a badge for every doc would be noisy. Callers already hide it
  // explicitly where appropriate, but if we ever do render it, keep
  // the same label/variant table for consistency.
  const label = LABEL[status] ?? status;
  const variant = VARIANT[status] ?? "outline";
  return (
    <Badge variant={variant} data-testid={`status-badge-${status}`}>
      {label}
    </Badge>
  );
}
