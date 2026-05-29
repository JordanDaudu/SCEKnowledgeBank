import {
  NotebookPen,
  ListChecks,
  GraduationCap,
  ScrollText,
  Presentation,
  FileBarChart,
  BookMarked,
  Highlighter,
  Zap,
  BookOpen,
  LayoutTemplate,
  FileText,
  type LucideIcon,
} from "lucide-react";

export interface MaterialTypeStyle {
  /** Lucide icon representing the material type. */
  icon: LucideIcon;
  /** Classes for the icon container (tinted background + icon color). */
  tile: string;
  /** Classes for the type pill (background + text + border). */
  tag: string;
}

/**
 * A muted, dark-mode-aware colour + icon per material type, so a grid of
 * documents can be scanned by *kind* (exam vs slides vs summary). This is a
 * categorical palette, intentionally separate from the brand green used for
 * actions/navigation. Class strings are written out in full (no interpolated
 * colour names) so Tailwind's scanner keeps them in the build.
 */
const NEUTRAL: MaterialTypeStyle = {
  icon: FileText,
  tile: "bg-muted text-muted-foreground",
  tag: "bg-muted text-muted-foreground border-border dark:bg-muted dark:text-muted-foreground",
};

const LECTURE_NOTES: MaterialTypeStyle = {
  icon: NotebookPen,
  tile: "bg-indigo-100 text-indigo-700 dark:bg-indigo-950/40 dark:text-indigo-300",
  tag: "bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/40 dark:text-indigo-300 dark:border-indigo-900/50",
};
const PROBLEM_SET: MaterialTypeStyle = {
  icon: ListChecks,
  tile: "bg-violet-100 text-violet-700 dark:bg-violet-950/40 dark:text-violet-300",
  tag: "bg-violet-50 text-violet-700 border-violet-200 dark:bg-violet-950/40 dark:text-violet-300 dark:border-violet-900/50",
};
const EXAM: MaterialTypeStyle = {
  icon: GraduationCap,
  tile: "bg-rose-100 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300",
  tag: "bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-900/50",
};
const SYLLABUS: MaterialTypeStyle = {
  icon: ScrollText,
  tile: "bg-teal-100 text-teal-700 dark:bg-teal-950/40 dark:text-teal-300",
  tag: "bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/40 dark:text-teal-300 dark:border-teal-900/50",
};
const SLIDES: MaterialTypeStyle = {
  icon: Presentation,
  tile: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  tag: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",
};
const PROJECT_REPORT: MaterialTypeStyle = {
  icon: FileBarChart,
  tile: "bg-cyan-100 text-cyan-700 dark:bg-cyan-950/40 dark:text-cyan-300",
  tag: "bg-cyan-50 text-cyan-700 border-cyan-200 dark:bg-cyan-950/40 dark:text-cyan-300 dark:border-cyan-900/50",
};
const TEXTBOOK: MaterialTypeStyle = {
  icon: BookMarked,
  tile: "bg-stone-200 text-stone-700 dark:bg-stone-800/60 dark:text-stone-300",
  tag: "bg-stone-100 text-stone-700 border-stone-300 dark:bg-stone-800/60 dark:text-stone-300 dark:border-stone-700/60",
};
const REVIEW_NOTES: MaterialTypeStyle = {
  icon: Highlighter,
  tile: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/40 dark:text-fuchsia-300",
  tag: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200 dark:bg-fuchsia-950/40 dark:text-fuchsia-300 dark:border-fuchsia-900/50",
};
const CHEAT_SHEET: MaterialTypeStyle = {
  icon: Zap,
  tile: "bg-yellow-100 text-yellow-700 dark:bg-yellow-950/40 dark:text-yellow-300",
  tag: "bg-yellow-50 text-yellow-700 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-900/50",
};
const READING: MaterialTypeStyle = {
  icon: BookOpen,
  tile: "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-300",
  tag: "bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900/50",
};
const TEMPLATE: MaterialTypeStyle = {
  icon: LayoutTemplate,
  tile: "bg-slate-200 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300",
  tag: "bg-slate-100 text-slate-700 border-slate-300 dark:bg-slate-800/60 dark:text-slate-300 dark:border-slate-700/60",
};

const STYLES: Record<string, MaterialTypeStyle> = {
  // Curated upload taxonomy (lib/material-types.ts)
  "lecture-notes": LECTURE_NOTES,
  "problem-set": PROBLEM_SET,
  exam: EXAM,
  syllabus: SYLLABUS,
  slides: SLIDES,
  "project-report": PROJECT_REPORT,
  textbook: TEXTBOOK,
  "review-notes": REVIEW_NOTES,
  "cheat-sheet": CHEAT_SHEET,
  // Extra values that appear in seed/legacy data, mapped to a sensible
  // identity (synonyms reuse an existing colour; new concepts get their own).
  assignment: PROBLEM_SET,
  summary: REVIEW_NOTES,
  reading: READING,
  template: TEMPLATE,
  notes: LECTURE_NOTES,
  lecture_notes: LECTURE_NOTES,
  problem_set: PROBLEM_SET,
};

export function materialTypeStyle(value: string | undefined): MaterialTypeStyle {
  if (!value) return NEUTRAL;
  return STYLES[value] ?? NEUTRAL;
}
