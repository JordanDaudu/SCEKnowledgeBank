import { useListUsers, getListUsersQueryKey } from "@workspace/api-client-react";
import { formatDateTime } from "@/lib/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Shield, ShieldAlert, BookA, User } from "lucide-react";

export default function AdminUsers() {
  const { data: users, isLoading } = useListUsers();

  const RoleIcon = ({ roles }: { roles: string[] }) => {
    if (roles.includes("admin")) return <ShieldAlert className="h-4 w-4 text-destructive" />;
    if (roles.includes("lecturer")) return <BookA className="h-4 w-4 text-primary" />;
    return <User className="h-4 w-4 text-muted-foreground" />;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-serif font-bold text-foreground">User Management</h1>
        <p className="text-muted-foreground mt-1">Admin oversight of platform users.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" />
            Registered Users
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Roles</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Joined</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">Loading users...</TableCell>
                  </TableRow>
                ) : (
                  users?.map(user => (
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
                          {user.roles.map(role => (
                            <Badge key={role} variant="outline" className="capitalize text-[10px]">
                              {role}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        {user.isActive ? (
                          <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Active</Badge>
                        ) : (
                          <Badge variant="secondary" className="bg-gray-100 text-gray-800">Inactive</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">{formatDateTime(user.createdAt)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
