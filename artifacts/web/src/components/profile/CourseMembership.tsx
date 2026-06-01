import { useState } from "react";
import {
  useListMyCourses,
  getListMyCoursesQueryKey,
  useAddMyCourse,
  useRemoveMyCourse,
  useListCourses,
  getListCoursesQueryKey,
  getGetCurrentUserQueryKey,
  type CurrentUser,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { BookOpen, Plus, X } from "lucide-react";

export default function CourseMembership({ me }: { me: CurrentUser }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const isLecturer = me.primaryRole === "lecturer";
  const heading = isLecturer ? "Taught courses" : "Enrolled courses";

  const { data: mine, isLoading } = useListMyCourses({
    query: { queryKey: getListMyCoursesQueryKey(), staleTime: 15_000 },
  });

  const [search, setSearch] = useState("");
  const debounced = useDebounce(search, 300);
  const searchParams = { q: debounced.trim() };
  const { data: results } = useListCourses(searchParams, {
    query: {
      queryKey: getListCoursesQueryKey(searchParams),
      enabled: debounced.trim().length > 0,
      staleTime: 10_000,
    },
  });

  const addMut = useAddMyCourse();
  const removeMut = useRemoveMyCourse();

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getListMyCoursesQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
  };

  const mineIds = new Set((mine ?? []).map((c) => c.id));
  const candidates = (results ?? []).filter((c) => !mineIds.has(c.id)).slice(0, 8);

  const add = (courseId: string) =>
    addMut.mutate(
      { data: { courseId } },
      {
        onSuccess: () => { refresh(); setSearch(""); toast({ title: "Course added" }); },
        onError: () => toast({ variant: "destructive", title: "Could not add course" }),
      },
    );

  const remove = (courseId: string) =>
    removeMut.mutate(
      { courseId },
      {
        onSuccess: () => { refresh(); toast({ title: "Course removed" }); },
        onError: () => toast({ variant: "destructive", title: "Could not remove course" }),
      },
    );

  return (
    <div className="space-y-3 border-t pt-6" data-testid="course-membership">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground">
        <BookOpen className="h-4 w-4 text-primary" />
        {heading}
      </h2>

      {isLoading ? (
        <Skeleton className="h-16 w-full" />
      ) : mine && mine.length > 0 ? (
        <ul className="space-y-1.5" data-testid="my-courses">
          {mine.map((c) => (
            <li key={c.id} className="flex items-center justify-between rounded-md border bg-card px-3 py-2">
              <span className="min-w-0 truncate text-sm">
                <span className="font-medium">{c.code}</span>
                <span className="text-muted-foreground"> — {c.title}</span>
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                disabled={removeMut.isPending}
                onClick={() => remove(c.id)}
                aria-label={`Remove ${c.code}`}
                data-testid="course-remove"
              >
                <X className="h-4 w-4" />
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground" data-testid="my-courses-empty">
          No courses yet. Search below to add one.
        </p>
      )}

      {/* Add course */}
      <div className="space-y-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses by code or title…"
          data-testid="course-search"
        />
        {debounced.trim().length > 0 && (
          <ul className="rounded-md border bg-popover" data-testid="course-results">
            {candidates.length > 0 ? (
              candidates.map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    disabled={addMut.isPending}
                    onClick={() => add(c.id)}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                  >
                    <Plus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 truncate">
                      <span className="font-medium">{c.code}</span>
                      <span className="text-muted-foreground"> — {c.title}</span>
                    </span>
                  </button>
                </li>
              ))
            ) : (
              <li className="px-3 py-2 text-sm text-muted-foreground">No matching courses.</li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
