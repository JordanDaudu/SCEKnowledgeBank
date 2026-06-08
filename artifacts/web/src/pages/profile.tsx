import { useEffect, useRef, useState } from "react";
import {
  useGetCurrentUser,
  getGetCurrentUserQueryKey,
  useUpdateMyProfile,
  useRemoveMyAvatar,
  useCheckUsernameAvailability,
  getCheckUsernameAvailabilityQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useDebounce } from "@/hooks/use-debounce";
import { useTranslation } from "react-i18next";
import { apiUrl } from "@/lib/api-url";
import { UserCircle, Upload, Trash2, Loader2 } from "lucide-react";
import CourseMembership from "@/components/profile/CourseMembership";
import DeleteAccount from "@/components/profile/DeleteAccount";

export default function Profile() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: me, isLoading } = useGetCurrentUser();

  const [username, setUsername] = useState("");
  const [avatarBust, setAvatarBust] = useState(0); // cache-bust the <img> after change
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (me?.username) setUsername(me.username);
  }, [me?.username]);

  const debounced = useDebounce(username, 300);
  const isAdmin = me?.roles?.includes("admin") ?? false;
  const dirty = !!me && debounced.trim().toLowerCase() !== (me.username ?? "");

  const availParams = { username: debounced.trim() };
  const { data: avail } = useCheckUsernameAvailability(availParams, {
    query: {
      queryKey: getCheckUsernameAvailabilityQueryKey(availParams),
      enabled: dirty && debounced.trim().length > 0,
      staleTime: 5_000,
    },
  });

  const updateMut = useUpdateMyProfile();
  const removeAvatarMut = useRemoveMyAvatar();

  const refreshMe = () => queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });

  const saveUsername = () => {
    updateMut.mutate(
      { data: { username: debounced.trim() } },
      {
        onSuccess: () => { refreshMe(); toast({ title: t("profile.usernameUpdated") }); },
        onError: (err: unknown) => {
          const message =
            (err as { data?: { error?: { message?: string } } })?.data?.error?.message ??
            t("profile.couldNotUpdateUsername");
          toast({ variant: "destructive", title: t("profile.updateFailed"), description: message });
        },
      },
    );
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast({ variant: "destructive", title: t("profile.unsupportedFile"), description: t("profile.unsupportedFileDesc") });
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast({ variant: "destructive", title: t("profile.fileTooLarge"), description: t("profile.fileTooLargeDesc") });
      return;
    }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(apiUrl("/api/me/avatar"), { method: "PUT", body: form, credentials: "include" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? t("profile.uploadFailed"));
      }
      await refreshMe();
      setAvatarBust(Date.now());
      toast({ title: t("profile.avatarUpdated") });
    } catch (err) {
      toast({ variant: "destructive", title: t("profile.uploadFailed"), description: (err as Error).message });
    } finally {
      setUploading(false);
    }
  };

  const removeAvatar = () => {
    removeAvatarMut.mutate(undefined, {
      onSuccess: () => { refreshMe(); setAvatarBust(Date.now()); toast({ title: t("profile.avatarRemoved") }); },
      onError: () => toast({ variant: "destructive", title: t("profile.couldNotRemoveAvatar") }),
    });
  };

  if (isLoading || !me) {
    return (
      <div className="mx-auto max-w-2xl space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  const avatarSrc = me.avatarUrl ? `${apiUrl(me.avatarUrl)}?b=${avatarBust}` : null;
  const initial = me.displayName?.charAt(0)?.toUpperCase() ?? "?";
  const availabilityHint = dirty && avail
    ? avail.available
      ? t("profile.available")
      : avail.reason === "reserved" ? t("profile.reserved")
      : avail.reason === "invalid" ? t("profile.invalidName")
      : t("profile.taken")
    : "";
  const canSave = dirty && (avail?.available ?? false) && !updateMut.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div className="flex items-center gap-2.5">
        <div className="rounded-lg bg-primary/10 p-1.5"><UserCircle className="h-5 w-5 text-primary" /></div>
        <h1 className="font-serif text-3xl font-bold text-foreground">{t("profile.title")}</h1>
      </div>

      <Card>
        <CardContent className="space-y-6 p-6">
          {/* Avatar */}
          <div className="flex items-center gap-4">
            {avatarSrc ? (
              <img src={avatarSrc} alt={t("profile.avatarAlt")} className="h-20 w-20 rounded-full object-cover" />
            ) : (
              <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
                {initial}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={onPickFile} />
              <Button variant="outline" size="sm" className="gap-1.5" disabled={uploading} onClick={() => fileRef.current?.click()} data-testid="avatar-upload">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {me.avatarUrl ? t("profile.replace") : t("profile.upload")}
              </Button>
              {me.avatarUrl && (
                <Button variant="ghost" size="sm" className="gap-1.5" disabled={removeAvatarMut.isPending} onClick={removeAvatar} data-testid="avatar-remove">
                  <Trash2 className="h-4 w-4" /> {t("profile.remove")}
                </Button>
              )}
            </div>
          </div>

          {/* Username */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("profile.username")}</label>
            <div className="flex gap-2">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} placeholder={t("profile.usernamePlaceholder")} data-testid="profile-username" />
              <Button onClick={saveUsername} disabled={!canSave} data-testid="profile-save">
                {updateMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : t("profile.save")}
              </Button>
            </div>
            {availabilityHint && (
              <p className={"text-xs " + (avail?.available ? "text-emerald-600" : "text-destructive")}>{availabilityHint}</p>
            )}
          </div>

          {/* Read-only fields */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("profile.email")}</label>
              <p className="text-sm text-foreground">{me.email}</p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("profile.role")}</label>
              <p><Badge variant="outline" className="capitalize">{t(`roles.${me.primaryRole}`, { defaultValue: me.primaryRole })}</Badge></p>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">{t("profile.joined")}</label>
              <p className="text-sm text-foreground">{new Date(me.createdAt).toLocaleDateString()}</p>
            </div>
          </div>

          {/* Course membership (SP2) + account deletion (SP3), students/lecturers. */}
          {!isAdmin && (
            <>
              <CourseMembership me={me} />
              <DeleteAccount />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
