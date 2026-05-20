export interface MaterialTypeOption {
  value: string;
  label: string;
}

export const MATERIAL_TYPES: MaterialTypeOption[] = [
  { value: "lecture-notes", label: "Lecture Notes" },
  { value: "problem-set", label: "Problem Set" },
  { value: "exam", label: "Exam" },
  { value: "syllabus", label: "Syllabus" },
  { value: "slides", label: "Slides" },
  { value: "project-report", label: "Project Report" },
  { value: "textbook", label: "Textbook" },
  { value: "review-notes", label: "Review Notes" },
  { value: "cheat-sheet", label: "Cheat Sheet" },
];

export const MATERIAL_TYPE_VALUES = MATERIAL_TYPES.map((m) => m.value);

const LABEL_BY_VALUE: Record<string, string> = Object.fromEntries(
  MATERIAL_TYPES.map((m) => [m.value, m.label]),
);

export function formatMaterialType(value: string): string {
  return LABEL_BY_VALUE[value] ?? value.replace(/-/g, " ");
}
