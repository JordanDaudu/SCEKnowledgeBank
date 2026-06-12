import { useState } from "react";
import {
  useCreateCourse,
  getListCoursesQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { GraduationCap, Loader2, Plus } from "lucide-react";

const EMPTY = { code: "", title: "", lecturerName: "" };

/**
 * Admin-only form for adding a course to the catalog. On success it clears
 * itself and invalidates the courses list so autocomplete, filters, and the
 * home stats band pick the new course up immediately.
 */
export function CourseForm() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createCourse = useCreateCourse();
  const [form, setForm] = useState(EMPTY);

  const trimmed = {
    code: form.code.trim(),
    title: form.title.trim(),
    lecturerName: form.lecturerName.trim(),
  };
  const isValid =
    trimmed.code.length > 0 &&
    trimmed.title.length > 0 &&
    trimmed.lecturerName.length > 0;

  const set =
    (field: keyof typeof EMPTY) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid || createCourse.isPending) return;
    createCourse.mutate(
      { data: trimmed },
      {
        onSuccess: (course) => {
          toast({
            title: t("admin.courses.created"),
            description: t("admin.courses.createdDesc", {
              code: course.code,
              title: course.title,
            }),
          });
          setForm(EMPTY);
          queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });
        },
        onError: (err: any) =>
          toast({
            variant: "destructive",
            title: t("admin.courses.createFailed"),
            description:
              err?.data?.error?.message ?? t("admin.courses.tryAgain"),
          }),
      },
    );
  };

  return (
    <Card data-testid="card-add-course">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap className="h-5 w-5 text-primary" />
          {t("admin.courses.addTitle")}
        </CardTitle>
        <CardDescription>{t("admin.courses.addDesc")}</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          onSubmit={handleSubmit}
          className="grid gap-4 sm:grid-cols-3 sm:items-end"
        >
          <div className="space-y-1.5">
            <Label htmlFor="course-code">{t("admin.courses.code")}</Label>
            <Input
              id="course-code"
              value={form.code}
              onChange={set("code")}
              placeholder={t("admin.courses.codePlaceholder")}
              maxLength={32}
              autoComplete="off"
              data-testid="input-course-code"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="course-title">{t("admin.courses.courseTitle")}</Label>
            <Input
              id="course-title"
              value={form.title}
              onChange={set("title")}
              placeholder={t("admin.courses.titlePlaceholder")}
              maxLength={200}
              autoComplete="off"
              data-testid="input-course-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="course-lecturer">
              {t("admin.courses.lecturer")}
            </Label>
            <Input
              id="course-lecturer"
              value={form.lecturerName}
              onChange={set("lecturerName")}
              placeholder={t("admin.courses.lecturerPlaceholder")}
              maxLength={120}
              autoComplete="off"
              data-testid="input-course-lecturer"
            />
          </div>
          <div className="sm:col-span-3">
            <Button
              type="submit"
              disabled={!isValid || createCourse.isPending}
              data-testid="submit-course"
            >
              {createCourse.isPending ? (
                <Loader2 className="me-1 h-4 w-4 animate-spin" />
              ) : (
                <Plus className="me-1 h-4 w-4" />
              )}
              {t("admin.courses.create")}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
