import { useRef, useState } from "react";
import {
  useListRequests,
  useCreateRequest,
  useVoteRequest,
  useUpdateRequest,
  getListRequestsQueryKey,
  useListCourses,
  useGetCurrentUser,
  type UploadResult,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowUp, Plus, Clock, CheckCircle2, Link as LinkIcon, Loader2, XCircle, UploadCloud } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { formatDateTime } from "@/lib/format";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { apiEndpoints } from "@/lib/api-url";
import { VerifiedBadge } from "@/components/reputation/VerifiedBadge";

/* ── Direct-upload constraints (mirror the Upload page) ───────────────── */
const MAX_UPLOAD_MB = Number(import.meta.env.VITE_MAX_UPLOAD_MB ?? 50);
const ALLOWED_EXTENSIONS = [
  "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx",
  "txt", "md", "csv", "png", "jpg", "jpeg", "zip",
];

type Translate = (key: string, opts?: Record<string, unknown>) => string;

function validateFulfillFile(file: File, t: Translate): string | null {
  if (file.size === 0) return t("requests.fileEmpty");
  if (file.size > MAX_UPLOAD_MB * 1024 * 1024) {
    return t("requests.fileTooLarge", { max: MAX_UPLOAD_MB });
  }
  const dot = file.name.lastIndexOf(".");
  const ext = dot >= 0 ? file.name.slice(dot + 1).toLowerCase() : "";
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return t("requests.unsupportedType", { allowed: ALLOWED_EXTENSIONS.join(", ") });
  }
  return null;
}

/* ── Status visual config ────────────────────────────────────────────── */
const STATUS_CFG: Record<string, {
  label: string;
  pill: string;
  border: string;
  icon?: typeof Clock;
}> = {
  open:        { label: "Open",        pill: "bg-primary/10 text-primary border-primary/20",                                                 border: "border-l-primary",     icon: undefined     },
  in_progress: { label: "In Progress", pill: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/50",       border: "border-l-amber-400",   icon: Loader2       },
  fulfilled:   { label: "Fulfilled",   pill: "bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900/50", border: "border-l-emerald-500", icon: CheckCircle2  },
  closed:      { label: "Closed",      pill: "bg-muted text-muted-foreground border-border",                                                 border: "border-l-border",      icon: XCircle       },
};

function StatusPill({ status }: { status: string }) {
  const { t } = useTranslation();
  const cfg = STATUS_CFG[status];
  if (!cfg) return null;
  const Icon = cfg.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded border px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        cfg.pill,
      )}
      data-testid={`status-pill-${status}`}
    >
      {Icon && <Icon className="h-3 w-3 shrink-0" />}
      {t(`requests.status.${status}`)}
    </span>
  );
}

export default function Requests() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [statusTab, setStatusTab] = useState<
    "open" | "in_progress" | "fulfilled" | "closed"
  >("open");
  const [isCreating, setIsCreating] = useState(false);
  const [fulfillingId, setFulfillingId] = useState<string | null>(null);
  const [docUrl, setDocUrl] = useState("");
  const [isUploadingFulfill, setIsUploadingFulfill] = useState(false);
  const fulfillFileRef = useRef<HTMLInputElement>(null);
  
  const { data: user } = useGetCurrentUser();
  const { data: courses } = useListCourses();
  const { data: requests, isLoading } = useListRequests({ status: statusTab }, {
    query: { queryKey: getListRequestsQueryKey({ status: statusTab }) }
  });

  const isLecturerOrAdmin = user?.roles?.includes("lecturer") || user?.roles?.includes("admin");

  // A request can only be raised for a course you can see: admins → any
  // course; everyone else → courses they're enrolled in (mirrors the
  // server's canCreateRequestForCourse). Hide the rest so the user can't
  // pick a course whose submit would silently 404.
  const isAdmin = user?.roles?.includes("admin") ?? false;
  const enrolledCourseIds = new Set((user?.enrollments ?? []).map((e) => e.courseId));
  const requestableCourses = isAdmin
    ? courses
    : courses?.filter((c) => enrolledCourseIds.has(c.id));

  const createMutation = useCreateRequest();
  const voteMutation = useVoteRequest();
  const updateMutation = useUpdateRequest();

  const [newTitle, setNewTitle] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [newCourse, setNewCourse] = useState("");

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle) return;
    createMutation.mutate({
      data: {
        title: newTitle,
        description: newDesc,
        courseId: newCourse && newCourse !== "none" ? newCourse : undefined,
      },
    }, {
      onSuccess: () => {
        toast({ title: t("requests.created") });
        setIsCreating(false);
        setNewTitle("");
        setNewDesc("");
        setNewCourse("");
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey({ status: "open" }) });
      },
      onError: (err) => {
        const data = (err as { data?: { error?: { message?: string } } })?.data;
        toast({
          variant: "destructive",
          title: t("requests.createFailed"),
          description:
            data?.error?.message ||
            t("requests.createFailedDesc"),
        });
      },
    });
  };

  const handleVote = (id: string) => {
    voteMutation.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey({ status: statusTab }) });
      },
      onError: (err) => {
        const data = (err as { data?: { error?: { message?: string } } })?.data;
        toast({ variant: "destructive", title: t("requests.voteFailed"), description: data?.error?.message || t("requests.voteFailedDesc") });
      }
    });
  };

  // Shared terminal step for both fulfill paths (paste URL/ID and direct
  // upload): point the request at a document and flip it to "fulfilled".
  const fulfillWith = (id: string, fulfillingDocumentId: string) => {
    updateMutation.mutate({
      id,
      data: { status: "fulfilled", fulfillingDocumentId }
    }, {
      onSuccess: () => {
        toast({ title: t("requests.markedFulfilled") });
        setFulfillingId(null);
        setDocUrl("");
        queryClient.invalidateQueries({ queryKey: getListRequestsQueryKey({ status: statusTab }) });
      },
      onError: (err) => {
        const data = (err as { data?: { error?: { message?: string } } })?.data;
        toast({
          variant: "destructive",
          title: t("requests.updateFailed"),
          description: data?.error?.message || (err as Error)?.message,
        });
      },
    });
  };

  const handleFulfill = (id: string) => {
    let fulfillingDocumentId = docUrl;
    if (docUrl.includes("/documents/")) {
      fulfillingDocumentId = docUrl.split("/documents/")[1].split("/")[0];
    }
    fulfillWith(id, fulfillingDocumentId);
  };

  // Upload a file straight from the fulfill form: create the document (reusing
  // the multipart upload endpoint), then fulfill the request with its id. The
  // request's course is passed along when present so the doc lands in context.
  const handleUploadFulfill = async (
    reqId: string,
    file: File,
    courseId?: string,
  ) => {
    const err = validateFulfillFile(file, t);
    if (err) {
      toast({ variant: "destructive", title: t("requests.uploadFailed"), description: err });
      return;
    }
    setIsUploadingFulfill(true);
    try {
      const form = new FormData();
      form.append("files", file);
      if (courseId) form.append("courseId", courseId);
      const title = file.name.replace(/\.[^./\\]+$/, "").trim();
      if (title) form.append("title", title);

      const res = await fetch(apiEndpoints.uploadDocuments(), {
        method: "POST",
        credentials: "include",
        body: form,
      });
      const data = (await res.json().catch(() => null)) as
        | (UploadResult & { error?: { message?: string } })
        | null;
      if (!res.ok) {
        throw new Error(data?.error?.message || `HTTP ${res.status}`);
      }
      const fileResult = data?.results?.[0];
      if (!fileResult?.success || !fileResult.document) {
        throw new Error(fileResult?.error || t("requests.uploadFailedDesc"));
      }
      toast({ title: t("requests.uploadedDocument") });
      fulfillWith(reqId, fileResult.document.id);
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("requests.uploadFailed"),
        description: e instanceof Error ? e.message : t("requests.uploadFailedDesc"),
      });
    } finally {
      setIsUploadingFulfill(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-serif font-bold text-foreground">{t("requests.title")}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{t("requests.subtitle")}</p>
        </div>
        <Button onClick={() => setIsCreating(!isCreating)} className="shrink-0">
          <Plus className="me-2 h-4 w-4" /> {t("requests.newRequest")}
        </Button>
      </div>

      {/* Create form */}
      {isCreating && (
        <Card className="border-primary/30 bg-primary/3">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">{t("requests.newRequestForm")}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-4">
              <div>
                <label className="text-sm font-medium">{t("requests.titleLabel")}</label>
                <Input
                  value={newTitle}
                  onChange={e => setNewTitle(e.target.value)}
                  placeholder={t("requests.titlePlaceholder")}
                  required
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium">{t("requests.course")}</label>
                <Select value={newCourse} onValueChange={setNewCourse}>
                  <SelectTrigger className="bg-background mt-1">
                    <SelectValue placeholder={t("requests.optionalCourse")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("requests.none")}</SelectItem>
                    {requestableCourses?.map(c => <SelectItem key={c.id} value={c.id}>{c.code} — {c.title}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">{t("requests.details")}</label>
                <Textarea
                  value={newDesc}
                  onChange={e => setNewDesc(e.target.value)}
                  placeholder={t("requests.detailsPlaceholder")}
                  className="mt-1"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <Button type="button" variant="ghost" onClick={() => setIsCreating(false)}>{t("requests.cancel")}</Button>
                <Button type="submit" disabled={!newTitle || createMutation.isPending}>
                  {createMutation.isPending && <Loader2 className="me-2 h-4 w-4 animate-spin" />}
                  {t("requests.submit")}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Tabs */}
      <Tabs value={statusTab} onValueChange={(val) => setStatusTab(val as typeof statusTab)} className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-5 h-auto">
          <TabsTrigger value="open" data-testid="requests-tab-open" className="text-xs sm:text-sm py-2">
            {t("requests.status.open")}
          </TabsTrigger>
          <TabsTrigger value="in_progress" data-testid="requests-tab-in-progress" className="text-xs sm:text-sm py-2">
            <span className="hidden sm:inline">{t("requests.status.in_progress")}</span>
            <span className="sm:hidden">{t("requests.inProgShort")}</span>
          </TabsTrigger>
          <TabsTrigger value="fulfilled" data-testid="requests-tab-fulfilled" className="text-xs sm:text-sm py-2">
            {t("requests.status.fulfilled")}
          </TabsTrigger>
          <TabsTrigger value="closed" data-testid="requests-tab-closed" className="text-xs sm:text-sm py-2">
            {t("requests.status.closed")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value={statusTab} className="space-y-3 mt-0">
          {isLoading ? (
            <div className="text-center py-10">
              <Clock className="animate-spin h-6 w-6 mx-auto text-muted-foreground" />
            </div>
          ) : requests?.length === 0 ? (
            <div className="text-center py-16 bg-card rounded-xl border border-dashed">
              <p className="text-muted-foreground text-sm">{t("requests.empty", { status: t(`requests.status.${statusTab}`) })}</p>
            </div>
          ) : (
            requests?.map(req => {
              const statusCfg = STATUS_CFG[req.status] ?? STATUS_CFG.open;
              return (
                <Card
                  key={req.id}
                  className={cn(
                    "overflow-hidden border-l-4 hover-elevate transition-all",
                    statusCfg.border,
                  )}
                >
                  <div className="flex flex-col sm:flex-row">
                    {/* Vote column */}
                    <div className="bg-secondary/30 px-4 py-3 flex sm:flex-col items-center justify-start sm:justify-center gap-3 border-b sm:border-b-0 sm:border-r border-border/50 min-w-[72px]">
                      <button
                        className={cn(
                          "rounded-full h-8 w-8 flex items-center justify-center transition-colors",
                          req.hasVoted
                            ? "bg-primary/20 text-primary cursor-default"
                            : req.status !== "open"
                            ? "text-muted-foreground/40 cursor-not-allowed"
                            : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                        )}
                        onClick={() => handleVote(req.id)}
                        disabled={req.status !== "open" || req.hasVoted || voteMutation.isPending}
                        aria-label={req.hasVoted ? t("requests.alreadyVoted") : t("requests.upvote")}
                        title={req.hasVoted ? t("requests.alreadyVoted") : t("requests.upvote")}
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <span className="font-bold text-base tabular-nums leading-none">{req.voteCount}</span>
                    </div>

                    {/* Content column */}
                    <CardContent className="p-4 sm:p-5 flex-1 min-w-0">
                      <div className="flex flex-wrap justify-between items-start gap-2 mb-1.5">
                        <h3 className="font-serif font-semibold text-[1rem] leading-snug">{req.title}</h3>
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {/* Editors get the status dropdown; everyone else
                              sees a read-only pill — never both at once. */}
                          {(isLecturerOrAdmin || req.requestedBy.id === user?.id) &&
                          (req.status === "open" || req.status === "in_progress") ? (
                              <Select
                                value={req.status}
                                onValueChange={(next) => {
                                  if (next === req.status) return;
                                  if (next === "fulfilled") {
                                    setFulfillingId(req.id);
                                    return;
                                  }
                                  updateMutation.mutate(
                                    { id: req.id, data: { status: next as "open" | "in_progress" | "closed" } },
                                    {
                                      onSuccess: () => {
                                        toast({ title: t("requests.markedAs", { status: t(`requests.status.${next}`) }) });
                                        queryClient.invalidateQueries({
                                          queryKey: getListRequestsQueryKey({ status: statusTab }),
                                        });
                                      },
                                      onError: (err) => {
                                        const data = (err as { data?: { error?: { message?: string } } })?.data;
                                        toast({
                                          variant: "destructive",
                                          title: t("requests.updateFailed"),
                                          description: data?.error?.message || (err as Error)?.message,
                                        });
                                      },
                                    },
                                  );
                                }}
                              >
                                <SelectTrigger
                                  className="h-7 w-[130px] text-xs bg-background"
                                  data-testid={`status-select-${req.id}`}
                                >
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="open">{t("requests.status.open")}</SelectItem>
                                  <SelectItem value="in_progress">{t("requests.status.in_progress")}</SelectItem>
                                  <SelectItem value="fulfilled">{t("requests.fulfilledEllipsis")}</SelectItem>
                                  <SelectItem value="closed">{t("requests.status.closed")}</SelectItem>
                                </SelectContent>
                              </Select>
                            ) : (
                              <StatusPill status={req.status} />
                            )}
                        </div>
                      </div>

                      {req.description && (
                        <p className="text-sm text-muted-foreground mb-3 leading-relaxed">{req.description}</p>
                      )}

                      {/* Fulfill form */}
                      {fulfillingId === req.id && (
                        <div className="bg-secondary/50 p-3 rounded-md mb-3 border border-border/60 space-y-2.5">
                          <div className="flex gap-2 items-center">
                            <Input
                              placeholder={t("requests.fulfillPlaceholder")}
                              value={docUrl}
                              onChange={e => setDocUrl(e.target.value)}
                              className="bg-background text-sm h-8"
                              disabled={isUploadingFulfill}
                            />
                            <Button size="sm" onClick={() => handleFulfill(req.id)} disabled={!docUrl || updateMutation.isPending || isUploadingFulfill}>
                              {t("requests.confirm")}
                            </Button>
                            <Button variant="ghost" size="sm" onClick={() => setFulfillingId(null)} disabled={isUploadingFulfill}>{t("requests.cancel")}</Button>
                          </div>

                          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                            <span className="h-px flex-1 bg-border/70" />
                            {t("requests.or")}
                            <span className="h-px flex-1 bg-border/70" />
                          </div>

                          <input
                            ref={fulfillFileRef}
                            type="file"
                            className="hidden"
                            onChange={(e) => {
                              const f = e.target.files?.[0];
                              if (f) handleUploadFulfill(req.id, f, req.course?.id);
                              e.target.value = "";
                            }}
                          />
                          <Button
                            variant="outline"
                            size="sm"
                            className="w-full bg-background"
                            disabled={isUploadingFulfill || updateMutation.isPending}
                            onClick={() => fulfillFileRef.current?.click()}
                            data-testid={`fulfill-upload-${req.id}`}
                          >
                            {isUploadingFulfill ? (
                              <Loader2 className="me-2 h-4 w-4 animate-spin" />
                            ) : (
                              <UploadCloud className="me-2 h-4 w-4" />
                            )}
                            {isUploadingFulfill ? t("requests.uploading") : t("requests.uploadDocument")}
                          </Button>
                          <p className="text-[11px] text-muted-foreground">
                            {t("requests.uploadDocumentHint", { max: MAX_UPLOAD_MB })}
                          </p>
                        </div>
                      )}

                      {req.fulfillingDocumentId && (
                        <Link href={`/documents/${req.fulfillingDocumentId}`}>
                          <div className="mb-3 inline-flex items-center gap-1.5 text-sm text-primary bg-primary/6 px-3 py-1.5 rounded-md hover:bg-primary/10 transition-colors border border-primary/15">
                            <LinkIcon className="h-3.5 w-3.5" /> {t("requests.viewFulfilled")}
                          </div>
                        </Link>
                      )}

                      {/* Metadata footer */}
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground pt-2 border-t border-border/40">
                        {req.course && (
                          <span className="course-tag inline-flex items-center rounded border px-2 py-0.5 text-xs">
                            {req.course.code}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1">
                          {t("requests.by", { name: req.requestedBy.displayName })}
                          {req.requestedBy.verified ? <VerifiedBadge /> : null}
                        </span>
                        <span className="tabular-nums">{formatDateTime(req.createdAt)}</span>
                      </div>
                    </CardContent>
                  </div>
                </Card>
              );
            })
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
