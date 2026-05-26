import { useGetCurrentUser } from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { Loader2 } from "lucide-react";

export function AuthGuard({ children, requireRole }: { children: React.ReactNode, requireRole?: "admin" | "lecturer" | "student" }) {
  const { data: user, isLoading, error } = useGetCurrentUser();

  if (isLoading) {
    return (
      <div className="flex h-screen w-full items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Declarative redirect: wouter's `setLocation` is NOT a stable
  // reference, so the previous `useEffect(..., [setLocation])` pattern
  // re-fired on every render and produced "Maximum update depth
  // exceeded" loops (especially when paired with the Login page also
  // navigating). <Redirect> avoids the loop entirely.
  if (error || !user) {
    return <Redirect to="/login" />;
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
