import { useGetCurrentUser } from "@workspace/api-client-react";
import { useLocation } from "wouter";
import { useEffect } from "react";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children, requireRole }: { children: React.ReactNode, requireRole?: "admin" | "lecturer" | "student" }) {
  const { data: user, isLoading, error } = useGetCurrentUser();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (!isLoading && (error || !user)) {
      setLocation("/login");
    }
  }, [isLoading, error, user, setLocation]);

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect
  }

  if (requireRole && user.primaryRole !== "admin") {
    if (requireRole === "lecturer" && !user.roles.includes("lecturer")) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center text-center">
          <h2 className="text-2xl font-bold text-foreground">Access Denied</h2>
          <p className="mt-2 text-muted-foreground">You do not have permission to view this page.</p>
        </div>
      );
    }
    if (requireRole === "admin" && !user.roles.includes("admin")) {
      return (
        <div className="flex h-screen w-full flex-col items-center justify-center text-center">
          <h2 className="text-2xl font-bold text-foreground">Access Denied</h2>
          <p className="mt-2 text-muted-foreground">You do not have permission to view this page.</p>
        </div>
      );
    }
  }

  return <>{children}</>;
}
