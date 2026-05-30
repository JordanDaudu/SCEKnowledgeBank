import {
  useListCategories,
  useListTags,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type Visibility = "private" | "public";
export type Semester = "fall" | "spring" | "summer";

/** Shape of the editable metadata shared by the create + edit dialogs. */
export interface CollectionMetadataState {
  visibility: Visibility;
  categoryId: string; // "none" sentinel = cleared
  examName: string;
  semester: Semester | "none";
  academicYear: string;
  tagIds: string[];
}

export const EMPTY_METADATA: CollectionMetadataState = {
  visibility: "private",
  categoryId: "none",
  examName: "",
  semester: "none",
  academicYear: "",
  tagIds: [],
};

/** Build the partial payload of metadata keys, omitting empty/unset values
 *  (and sending `tagIds` only when non-empty). Use on create. */
export function buildCreateMetadata(s: CollectionMetadataState) {
  return {
    visibility: s.visibility,
    ...(s.categoryId !== "none" ? { categoryId: s.categoryId } : {}),
    ...(s.examName.trim() ? { examName: s.examName.trim() } : {}),
    ...(s.semester !== "none" ? { semester: s.semester } : {}),
    ...(s.academicYear.trim() ? { academicYear: Number(s.academicYear) } : {}),
    ...(s.tagIds.length > 0 ? { tagIds: s.tagIds } : {}),
  };
}

/** Build the metadata payload for update. Update accepts nullable fields, so
 *  cleared values are sent so they can be unset on the server. */
export function buildUpdateMetadata(s: CollectionMetadataState) {
  return {
    visibility: s.visibility,
    categoryId: s.categoryId === "none" ? null : s.categoryId,
    examName: s.examName.trim() || null,
    semester: s.semester === "none" ? null : s.semester,
    academicYear: s.academicYear.trim() ? Number(s.academicYear) : null,
    tagIds: s.tagIds,
  };
}

/** The shared Subject / Exam / Semester / Year / Tags / Visibility controls,
 *  following the EditMetadataModal pattern. */
export function CollectionMetadataFields({
  value,
  onChange,
}: {
  value: CollectionMetadataState;
  onChange: (next: CollectionMetadataState) => void;
}) {
  const { data: categories } = useListCategories();
  const { data: tags } = useListTags();

  const set = <K extends keyof CollectionMetadataState>(
    key: K,
    v: CollectionMetadataState[K],
  ) => onChange({ ...value, [key]: v });

  const toggleTag = (id: string) =>
    set(
      "tagIds",
      value.tagIds.includes(id)
        ? value.tagIds.filter((t) => t !== id)
        : [...value.tagIds, id],
    );

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Visibility</label>
        <Select
          value={value.visibility}
          onValueChange={(v) => set("visibility", v as Visibility)}
        >
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="private">Private — only you</SelectItem>
            <SelectItem value="public">Public — discoverable in Prep Hub</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Subject</label>
          <Select value={value.categoryId} onValueChange={(v) => set("categoryId", v)}>
            <SelectTrigger>
              <SelectValue placeholder="Select subject" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {categories?.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Exam name</label>
          <Input
            value={value.examName}
            onChange={(e) => set("examName", e.target.value)}
            placeholder="e.g. Midterm"
          />
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Semester</label>
          <Select
            value={value.semester}
            onValueChange={(v) => set("semester", v as Semester | "none")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select semester" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="fall">Fall</SelectItem>
              <SelectItem value="spring">Spring</SelectItem>
              <SelectItem value="summer">Summer</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground">Academic year</label>
          <Input
            type="number"
            value={value.academicYear}
            onChange={(e) => set("academicYear", e.target.value)}
            placeholder="e.g. 2024"
          />
        </div>
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-muted-foreground">Tags</label>
        <div className="flex flex-wrap gap-2">
          {tags?.length ? (
            tags.map((tag) => (
              <Badge
                key={tag.id}
                variant={value.tagIds.includes(tag.id) ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => toggleTag(tag.id)}
              >
                {tag.name}
              </Badge>
            ))
          ) : (
            <p className="text-xs text-muted-foreground">No tags available.</p>
          )}
        </div>
      </div>
    </div>
  );
}
