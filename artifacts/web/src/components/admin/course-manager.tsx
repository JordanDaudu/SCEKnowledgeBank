import { useState } from "react";
import {
  useListCourses,
  useUpdateCourse,
  useDeleteCourse,
  getListCoursesQueryKey,
  type Course,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Library, Loader2, Pencil, Trash2 } from "lucide-react";
import { CourseForm } from "./course-form";

export function CourseManager() {
  const { t } = useTranslation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: courses, isLoading } = useListCourses();
  const updateCourse = useUpdateCourse();
  const deleteCourse = useDeleteCourse();

  const [editTarget, setEditTarget] = useState<Course | null>(null);
  const [editForm, setEditForm] = useState({ code: "", title: "", lecturerName: "" });
  const [deleteTarget, setDeleteTarget] = useState<Course | null>(null);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: getListCoursesQueryKey() });

  const openEdit = (c: Course) => {
    setEditForm({ code: c.code, title: c.title, lecturerName: c.lecturerName });
    setEditTarget(c);
  };

  const editValid =
    editForm.code.trim() && editForm.title.trim() && editForm.lecturerName.trim();

  const handleSaveEdit = () => {
    if (!editTarget || !editValid) return;
    updateCourse.mutate(
      {
        id: editTarget.id,
        data: {
          code: editForm.code.trim(),
          title: editForm.title.trim(),
          lecturerName: editForm.lecturerName.trim(),
        },
      },
      {
        onSuccess: (course) => {
          toast({
            title: t("admin.courses.updated"),
            description: t("admin.courses.updatedDesc", { code: course.code }),
          });
          setEditTarget(null);
          refresh();
        },
        onError: (err: any) =>
          toast({
            variant: "destructive",
            title: t("admin.courses.updateFailed"),
            description: err?.data?.error?.message ?? t("admin.courses.tryAgain"),
          }),
      },
    );
  };

  const handleConfirmDelete = () => {
    if (!deleteTarget) return;
    deleteCourse.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          toast({
            title: t("admin.courses.deleted"),
            description: t("admin.courses.deletedDesc", { code: deleteTarget.code }),
          });
          setDeleteTarget(null);
          refresh();
        },
        onError: (err: any) => {
          toast({
            variant: "destructive",
            title: t("admin.courses.deleteFailed"),
            description: err?.data?.error?.message ?? t("admin.courses.tryAgain"),
          });
          setDeleteTarget(null);
        },
      },
    );
  };

  return (
    <div className="space-y-6">
      <CourseForm />

      <Card data-testid="card-course-list">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Library className="h-5 w-5 text-primary" />
            {t("admin.courses.manageTitle")}
            {courses ? (
              <span className="text-sm font-normal text-muted-foreground">
                ({courses.length})
              </span>
            ) : null}
          </CardTitle>
          <CardDescription>{t("admin.courses.manageDesc")}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.courses.code")}</TableHead>
                  <TableHead>{t("admin.courses.courseTitle")}</TableHead>
                  <TableHead>{t("admin.courses.lecturer")}</TableHead>
                  <TableHead className="text-right">
                    {t("admin.courses.colActions")}
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      {t("admin.courses.loading")}
                    </TableCell>
                  </TableRow>
                ) : courses && courses.length > 0 ? (
                  courses.map((c) => {
                    const busy =
                      (deleteCourse.isPending && deleteCourse.variables?.id === c.id) ||
                      (updateCourse.isPending && updateCourse.variables?.id === c.id);
                    return (
                      <TableRow key={c.id} data-testid={`course-row-${c.id}`}>
                        <TableCell className="font-medium font-mono">{c.code}</TableCell>
                        <TableCell>{c.title}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {c.lecturerName}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2 whitespace-nowrap">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => openEdit(c)}
                              disabled={busy}
                              data-testid={`edit-course-${c.id}`}
                            >
                              <Pencil className="me-1 h-3 w-3" />
                              {t("admin.courses.edit")}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setDeleteTarget(c)}
                              disabled={busy}
                              data-testid={`delete-course-${c.id}`}
                            >
                              {busy && deleteCourse.variables?.id === c.id ? (
                                <Loader2 className="me-1 h-3 w-3 animate-spin" />
                              ) : (
                                <Trash2 className="me-1 h-3 w-3 text-destructive" />
                              )}
                              {t("admin.courses.delete")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                      {t("admin.courses.noCourses")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={editTarget !== null} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent data-testid="edit-course-dialog">
          <DialogHeader>
            <DialogTitle>{t("admin.courses.editTitle")}</DialogTitle>
            <DialogDescription>{t("admin.courses.editDesc")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="edit-course-code">{t("admin.courses.code")}</Label>
              <Input
                id="edit-course-code"
                value={editForm.code}
                onChange={(e) => setEditForm((p) => ({ ...p, code: e.target.value }))}
                maxLength={32}
                data-testid="edit-input-code"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-course-title">{t("admin.courses.courseTitle")}</Label>
              <Input
                id="edit-course-title"
                value={editForm.title}
                onChange={(e) => setEditForm((p) => ({ ...p, title: e.target.value }))}
                maxLength={200}
                data-testid="edit-input-title"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-course-lecturer">{t("admin.courses.lecturer")}</Label>
              <Input
                id="edit-course-lecturer"
                value={editForm.lecturerName}
                onChange={(e) =>
                  setEditForm((p) => ({ ...p, lecturerName: e.target.value }))
                }
                maxLength={120}
                data-testid="edit-input-lecturer"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)} disabled={updateCourse.isPending}>
              {t("admin.courses.cancel")}
            </Button>
            <Button onClick={handleSaveEdit} disabled={!editValid || updateCourse.isPending} data-testid="save-course">
              {updateCourse.isPending && <Loader2 className="me-1 h-4 w-4 animate-spin" />}
              {t("admin.courses.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteTarget !== null} onOpenChange={(o) => !o && setDeleteTarget(null)}>
        <AlertDialogContent data-testid="delete-course-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("admin.courses.deleteConfirmTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("admin.courses.deleteConfirmDesc", { code: deleteTarget?.code ?? "" })}
              <br />
              <span className="text-amber-600 dark:text-amber-500">
                {t("admin.courses.deleteWarning")}
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteCourse.isPending}>
              {t("admin.courses.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                handleConfirmDelete();
              }}
              disabled={deleteCourse.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="confirm-delete-course"
            >
              {deleteCourse.isPending && <Loader2 className="me-1 h-3 w-3 animate-spin" />}
              {t("admin.courses.delete")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
