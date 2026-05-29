import { cn } from "@/lib/utils";
import {
  Clock,
  CheckCircle2,
  XCircle,
  FileEdit,
  Archive,
  BookOpen,
  type LucideIcon,
} from "lucide-react";

interface StatusConfig {
  label: string;
  classes: string;
  icon: LucideIcon;
}

const STATUS: Record<string, StatusConfig> = {
  draft: {
    label: "Draft",
    classes: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    icon: FileEdit,
  },
  published: {
    label: "Published",
    classes: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    icon: BookOpen,
  },
  archived: {
    label: "Archived",
    classes: "bg-slate-50 text-slate-500 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700",
    icon: Archive,
  },
  pending_review: {
    label: "Pending review",
    classes: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800",
    icon: Clock,
  },
  approved: {
    label: "Approved",
    classes: "bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800",
    icon: CheckCircle2,
  },
  rejected: {
    label: "Rejected",
    classes: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-400 dark:border-rose-800",
    icon: XCircle,
  },
};

export function StatusBadge({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const cfg = STATUS[status] ?? {
    label: status,
    classes: "bg-muted text-muted-foreground border-border",
    icon: FileEdit,
  };
  const Icon = cfg.icon;
  return (
    <span
      data-testid={`status-badge-${status}`}
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cfg.classes,
        className,
      )}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {cfg.label}
    </span>
  );
}
