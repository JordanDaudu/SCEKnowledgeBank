import { Link, useLocation } from "wouter";
import { useGetCurrentUser, useLogout, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { BookOpen, Search, Upload, MessageSquare, Users, LogOut, Loader2, ShieldCheck, BarChart3, type LucideIcon } from "lucide-react";
import { Logo } from "./logo";
import { Button } from "./ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "./ui/badge";
import { NotificationBell } from "./notification-bell";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user } = useGetCurrentUser();
  const logout = useLogout();
  const queryClient = useQueryClient();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
        window.location.href = "/login";
      }
    });
  };

  const isLecturerOrAdmin = user?.roles?.includes("lecturer") || user?.roles?.includes("admin");
  const isAdmin = user?.roles?.includes("admin");

  const NavLink = ({ href, icon: Icon, children }: { href: string; icon: LucideIcon; children: React.ReactNode }) => {
    const isActive = location === href;
    return (
      <Link href={href} className={`flex items-center gap-2 px-3 py-2 rounded-md transition-colors ${isActive ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-secondary'}`}>
        <Icon className="h-4 w-4" />
        <span className="font-medium text-sm">{children}</span>
      </Link>
    );
  };

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-8">
            <Link href="/" className="flex items-center gap-2 text-primary font-serif font-bold text-xl">
              <Logo className="h-7 w-7" />
              <span>Knowledge Bank</span>
            </Link>
            
            {user && (
              <nav className="hidden md:flex items-center gap-2">
                <NavLink href="/" icon={BookOpen}>Home</NavLink>
                <NavLink href="/browse" icon={Search}>Browse</NavLink>
                <NavLink href="/requests" icon={MessageSquare}>Requests</NavLink>
                {isLecturerOrAdmin && <NavLink href="/upload" icon={Upload}>Upload</NavLink>}
                {isLecturerOrAdmin && (
                  <NavLink href="/review-queue" icon={ShieldCheck}>Review</NavLink>
                )}
                {isAdmin && <NavLink href="/admin/users" icon={Users}>Admin</NavLink>}
                {isAdmin && <NavLink href="/admin/analytics" icon={BarChart3}>Analytics</NavLink>}
              </nav>
            )}
          </div>

          {user && (
            <div className="flex items-center gap-4">
              <NotificationBell />
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-sm font-medium leading-none">{user.displayName}</span>
                  <span className="text-xs text-muted-foreground mt-1 capitalize">{user.primaryRole}</span>
                </div>
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
                  {user.displayName.charAt(0)}
                </div>
              </div>
              <div className="w-px h-8 bg-border"></div>
              <Button variant="ghost" size="icon" onClick={handleLogout} disabled={logout.isPending} title="Log out">
                {logout.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4 text-muted-foreground" />}
              </Button>
            </div>
          )}
        </div>
      </header>
      
      <main className="flex-1 container mx-auto px-4 py-8">
        {children}
      </main>
    </div>
  );
}
