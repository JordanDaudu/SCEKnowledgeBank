import {
  useListUsers,
  useListPendingLecturers,
  useApproveUser,
  useDisableUser,
  getListUsersQueryKey,
  getListPendingLecturersQueryKey,
  useListDeletedAccounts,
  getListDeletedAccountsQueryKey,
  useRestoreAccount,
  usePurgeAccount,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "react-i18next";
import {
  Shield,
  ShieldAlert,
  BookA,
  User,
  CheckCircle2,
  XCircle,
  Clock,
  Loader2,
} from "lucide-react";

function StatusBadge({ status }: { status?: string }) {
  const { t } = useTranslation();
  if (status === "PENDING_APPROVAL") {
    return (
      <Badge
        variant="secondary"
        className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400"
      >
        {t("admin.users.statusPending")}
      </Badge>
    );
  }
  if (status === "DISABLED") {
    return (
      <Badge
        variant="secondary"
        className="bg-gray-100 text-gray-800 dark:bg-gray-800/40 dark:text-gray-300"
      >
        {t("admin.users.statusDisabled")}
      </Badge>
    );
  }
  return (
    <Badge
      variant="secondary"
      className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400"
    >
      {t("admin.users.statusActive")}
    </Badge>
  );
}

const RoleIcon = ({ roles }: { roles: string[] }) => {
  if (roles.includes("admin"))
    return <ShieldAlert className="h-4 w-4 text-destructive" />;
  if (roles.includes("lecturer"))
    return <BookA className="h-4 w-4 text-primary" />;
  return <User className="h-4 w-4 text-muted-foreground" />;
};

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();
  const { data: pending, isLoading: pendingLoading } = useListPendingLecturers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { t } = useTranslation();
  const approveMutation = useApproveUser();
  const disableMutation = useDisableUser();
  const { data: deleted } = useListDeletedAccounts({
    query: { queryKey: getListDeletedAccountsQueryKey() },
  });
  const restoreMut = useRestoreAccount();
  const purgeMut = usePurgeAccount();
  const refreshDeleted = () =>
    queryClient.invalidateQueries({ queryKey: getListDeletedAccountsQueryKey() });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
    queryClient.invalidateQueries({
      queryKey: getListPendingLecturersQueryKey(),
    });
  };

  const handleApprove = (id: string, name: string) => {
    approveMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({
            title: t("admin.users.lecturerApproved"),
            description: t("admin.users.canSignIn", { name }),
          });
          invalidate();
        },
        onError: (e: any) =>
          toast({
            variant: "destructive",
            title: t("admin.users.approveFailed"),
            description: e?.data?.error?.message ?? t("admin.users.tryAgain"),
          }),
      },
    );
  };

  const handleDisable = (id: string, name: string) => {
    disableMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({
            title: t("admin.users.accountDisabled"),
            description: t("admin.users.canNoLongerSignIn", { name }),
          });
          invalidate();
        },
        onError: (e: any) =>
          toast({
            variant: "destructive",
            title: t("admin.users.disableFailed"),
            description: e?.data?.error?.message ?? t("admin.users.tryAgain"),
          }),
      },
    );
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8" data-testid="page-admin-users">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">
          {t("admin.users.title")}
        </h1>
        <p className="text-muted-foreground mt-1">
          {t("admin.users.subtitle")}
        </p>
      </div>

      <Card data-testid="card-pending-lecturers">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5 text-amber-600" />
            {t("admin.users.pendingLecturers")}
          </CardTitle>
          <CardDescription>
            {t("admin.users.pendingLecturersDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.users.colUser")}</TableHead>
                  <TableHead>{t("admin.users.colEmail")}</TableHead>
                  <TableHead>{t("admin.users.colRequested")}</TableHead>
                  <TableHead className="text-right">{t("admin.users.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pendingLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-6 text-muted-foreground"
                    >
                      {t("admin.users.loading")}
                    </TableCell>
                  </TableRow>
                ) : pending && pending.length > 0 ? (
                  pending.map((u) => {
                    const busy =
                      (approveMutation.isPending &&
                        approveMutation.variables?.id === u.id) ||
                      (disableMutation.isPending &&
                        disableMutation.variables?.id === u.id);
                    return (
                      <TableRow key={u.id} data-testid={`pending-row-${u.id}`}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <BookA className="h-4 w-4 text-primary" />
                            {u.displayName}
                          </div>
                        </TableCell>
                        <TableCell>{u.email}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(u.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleApprove(u.id, u.displayName)}
                              disabled={busy}
                              data-testid={`approve-${u.id}`}
                            >
                              {busy && approveMutation.isPending ? (
                                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="me-1 h-3 w-3 text-green-600" />
                              )}
                              {t("admin.users.approve")}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleDisable(u.id, u.displayName)}
                              disabled={busy}
                              data-testid={`disable-${u.id}`}
                            >
                              <XCircle className="me-1 h-3 w-3 text-destructive" />
                              {t("admin.users.disable")}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={4}
                      className="text-center py-6 text-muted-foreground"
                    >
                      {t("admin.users.noPending")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            {t("admin.users.registeredUsers")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t("admin.users.colUser")}</TableHead>
                  <TableHead>{t("admin.users.colEmail")}</TableHead>
                  <TableHead>{t("admin.users.colRoles")}</TableHead>
                  <TableHead>{t("admin.users.colStatus")}</TableHead>
                  <TableHead>{t("admin.users.colJoined")}</TableHead>
                  <TableHead className="text-right">{t("admin.users.colActions")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="text-center py-8 text-muted-foreground"
                    >
                      {t("admin.users.loadingUsers")}
                    </TableCell>
                  </TableRow>
                ) : (
                  users?.map((user) => {
                    const disabled = user.status === "DISABLED";
                    const busy =
                      (approveMutation.isPending &&
                        approveMutation.variables?.id === user.id) ||
                      (disableMutation.isPending &&
                        disableMutation.variables?.id === user.id);
                    return (
                      <TableRow key={user.id}>
                        <TableCell className="font-medium">
                          <div className="flex items-center gap-2">
                            <RoleIcon roles={user.roles} />
                            {user.displayName}
                          </div>
                        </TableCell>
                        <TableCell>{user.email}</TableCell>
                        <TableCell>
                          <div className="flex gap-1 flex-wrap">
                            {user.roles.map((role) => (
                              <Badge
                                key={role}
                                variant="outline"
                                className="capitalize text-[10px]"
                              >
                                {t(`roles.${role}`, { defaultValue: role })}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={user.status} />
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {formatDateTime(user.createdAt)}
                        </TableCell>
                        <TableCell className="text-right">
                          {user.roles.includes("admin") ? (
                            <span className="text-xs text-muted-foreground">
                              —
                            </span>
                          ) : disabled ? (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleApprove(user.id, user.displayName)
                              }
                              disabled={busy}
                              data-testid={`reenable-${user.id}`}
                            >
                              <CheckCircle2 className="me-1 h-3 w-3 text-green-600" />
                              {t("admin.users.reEnable")}
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() =>
                                handleDisable(user.id, user.displayName)
                              }
                              disabled={busy}
                              data-testid={`disable-${user.id}`}
                            >
                              <XCircle className="me-1 h-3 w-3 text-destructive" />
                              {t("admin.users.disable")}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-deleted-accounts">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <XCircle className="h-5 w-5 text-destructive" />
            {t("admin.users.deletedAccounts")}
          </CardTitle>
          <CardDescription>
            {t("admin.users.deletedAccountsDesc")}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {deleted && deleted.length > 0 ? (
            <div className="space-y-2" data-testid="deleted-accounts">
              {deleted.map((u) => {
                const busy = restoreMut.isPending || purgeMut.isPending;
                return (
                  <div
                    key={u.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-card px-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {u.displayName}{" "}
                        <span className="text-muted-foreground">· {u.email}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {u.roles.join(", ") || "—"} · {t("admin.users.fileCount", { count: u.fileCount })} ·{" "}
                        {u.anonymizedAt
                          ? t("admin.users.permanentlyRemoved")
                          : t("admin.users.deletedAt", { date: u.deletedAt ? formatDateTime(u.deletedAt) : "" })}
                      </p>
                    </div>
                    {!u.anonymizedAt && (
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            restoreMut.mutate(
                              { userId: u.id },
                              {
                                onSuccess: () => {
                                  toast({ title: t("admin.users.accountRestored") });
                                  refreshDeleted();
                                },
                                onError: () =>
                                  toast({ variant: "destructive", title: t("admin.users.restoreFailed") }),
                              },
                            )
                          }
                          data-testid={`account-restore-${u.id}`}
                        >
                          {t("admin.users.restore")}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          disabled={!u.eligibleForPurge || busy}
                          title={
                            u.eligibleForPurge
                              ? t("admin.users.purgeEligibleTitle")
                              : t("admin.users.purgeNotEligibleTitle")
                          }
                          onClick={() =>
                            purgeMut.mutate(
                              { userId: u.id },
                              {
                                onSuccess: () => {
                                  toast({ title: t("admin.users.accountPurged") });
                                  refreshDeleted();
                                },
                                onError: () =>
                                  toast({ variant: "destructive", title: t("admin.users.purgeFailed") }),
                              },
                            )
                          }
                          data-testid={`account-purge-${u.id}`}
                        >
                          {t("admin.users.purge")}
                        </Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t("admin.users.noDeleted")}</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
