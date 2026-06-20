import { useState } from "react";
import { Link, useLocation } from "wouter";
import {
  useGetCurrentUser,
  useLogout,
  getGetCurrentUserQueryKey,
} from "@workspace/api-client-react";
import {
  BookOpen,
  Search,
  Upload,
  MessageSquare,
  Users,
  LogOut,
  Loader2,
  ShieldCheck,
  BarChart3,
  History,
  DownloadCloud,
  GraduationCap,
  Trophy,
  FolderOpen,
  Menu,
  X,
  ChevronDown,
  Shield,
  UserCircle,
  FileWarning,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Logo } from "./logo";
import { ThemeToggle } from "./theme-toggle";
import { LanguageSwitcher } from "./language-switcher";
import { Button } from "./ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { useQueryClient } from "@tanstack/react-query";
import { NotificationBell } from "./notification-bell";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetClose,
} from "./ui/sheet";
import { apiUrl } from "@/lib/api-url";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { data: user, dataUpdatedAt } = useGetCurrentUser();
  const logout = useLogout();
  const queryClient = useQueryClient();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { t } = useTranslation();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSuccess: () => {
        queryClient.setQueryData(getGetCurrentUserQueryKey(), null);
        window.location.href = "/login";
      },
    });
  };

  const isLecturerOrAdmin =
    user?.roles?.includes("lecturer") || user?.roles?.includes("admin");
  const isAdmin = user?.roles?.includes("admin");

  interface NavItem {
    href: string;
    icon: LucideIcon;
    label: string;
  }

  // Primary items stay inline on desktop; the rest live behind a "More"
  // dropdown to keep the bar uncluttered. The mobile sheet shows everything.
  // Admins moderate rather than contribute: Collections, Prep Hub, Upload
  // and My Uploads are all hidden for them (they manage via "Prep Hub
  // Moderation" / "Admin Approvals"). Activity logs live inside the admin
  // Analytics page rather than a top-level item.
  const primaryNav: NavItem[] = user
    ? [
        { href: "/", icon: BookOpen, label: t("nav.home") },
        { href: "/browse", icon: Search, label: t("nav.browse") },
        ...(!isAdmin
          ? [
              { href: "/collections", icon: FolderOpen, label: t("nav.collections") },
              { href: "/prep-hub", icon: GraduationCap, label: t("nav.prepHub") },
            ]
          : []),
        { href: "/requests", icon: MessageSquare, label: t("nav.requests") },
        ...(!isAdmin
          ? [{ href: "/upload", icon: Upload, label: t("nav.upload") }]
          : []),
      ]
    : [];

  const moreNav: NavItem[] = user
    ? [
        { href: "/profile", icon: UserCircle, label: t("nav.profile") },
        { href: "/leaderboard", icon: Trophy, label: t("nav.leaderboard") },
        ...(!isAdmin
          ? [
              { href: "/uploads", icon: History, label: t("nav.myUploads") },
              { href: "/saved", icon: DownloadCloud, label: t("nav.savedOffline") },
            ]
          : []),
        // Lecturers get a standalone Review item; for admins the review
        // queue is folded into "Admin Approvals", so it's hidden here.
        ...(isLecturerOrAdmin && !isAdmin
          ? [{ href: "/review-queue", icon: ShieldCheck, label: t("nav.review") }]
          : []),
        ...(isAdmin
          ? [
              { href: "/admin/users", icon: Users, label: t("nav.admin") },
              { href: "/admin/analytics", icon: BarChart3, label: t("nav.analytics") },
              { href: "/admin/approvals", icon: ShieldCheck, label: t("nav.adminApprovals") },
              { href: "/admin/prep-hub-moderation", icon: Shield, label: t("nav.prepHubModeration") },
              { href: "/admin/orphaned-files", icon: FileWarning, label: t("nav.orphanedFiles") },
            ]
          : []),
      ]
    : [];

  const allNav: NavItem[] = [...primaryNav, ...moreNav];

  const NavLink = ({
    href,
    icon: Icon,
    label,
    onClick,
  }: NavItem & { onClick?: () => void }) => {
    const isActive = location === href;
    return (
      <Link
        href={href}
        onClick={onClick}
        className={`flex items-center gap-2.5 px-3 py-2 rounded-md transition-colors text-sm font-medium ${
          isActive
            ? "bg-primary text-primary-foreground"
            : "text-foreground hover:bg-secondary"
        }`}
        aria-current={isActive ? "page" : undefined}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span>{label}</span>
      </Link>
    );
  };

  // Header avatar shown next to the notification bell and logout button.
  // `avatarUrl` is a stable path, so we cache-bust with the current-user
  // query's last-updated timestamp: it changes when the profile page
  // invalidates that query after an avatar upload/remove, so the new image
  // appears here without a full page reload. Falls back to the initial.
  const avatarSrc = user?.avatarUrl
    ? `${apiUrl(user.avatarUrl)}?b=${dataUpdatedAt}`
    : null;

  const UserAvatar = ({ className }: { className: string }) =>
    avatarSrc ? (
      <img
        src={avatarSrc}
        alt=""
        className={`rounded-full object-cover shrink-0 ${className}`}
      />
    ) : (
      <div
        className={`rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold shrink-0 ${className}`}
      >
        {user?.displayName?.charAt(0)?.toUpperCase() ?? "?"}
      </div>
    );

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <header className="sticky top-0 z-50 w-full border-b bg-card">
        <div className="container mx-auto px-4 h-16 flex items-center justify-between gap-4">
          {/* Brand */}
          <div className="flex items-center gap-4 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2 text-primary font-serif font-bold text-lg sm:text-xl shrink-0"
            >
              <Logo className="h-7 w-7" />
              <span className="hidden sm:inline">{t("common.appName")}</span>
              <span className="sm:hidden">KB</span>
            </Link>

            {/* Desktop nav: primary items inline + a "More" dropdown. */}
            {user && (
              <nav className="hidden md:flex items-center gap-1" aria-label={t("nav.mainNav")}>
                {primaryNav.map((item) => (
                  <NavLink key={item.href} {...item} />
                ))}
                {moreNav.length > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium text-foreground transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        data-testid="nav-more"
                      >
                        {t("nav.more")}
                        <ChevronDown className="h-4 w-4" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      {moreNav.map((item) => (
                        <DropdownMenuItem key={item.href} asChild>
                          <Link
                            href={item.href}
                            className="flex items-center gap-2.5 cursor-pointer"
                          >
                            <item.icon className="h-4 w-4 shrink-0" />
                            {item.label}
                          </Link>
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </nav>
            )}
          </div>

          {/* Right side controls */}
          {user && (
            <div className="flex items-center gap-2">
              <ThemeToggle />
              <LanguageSwitcher />
              <NotificationBell />

              {/* User info — hidden on very small screens; links to Profile */}
              <Link
                href="/profile"
                className="hidden sm:flex items-center gap-3 hover:opacity-80"
                aria-label={t("nav.openProfile")}
              >
                <div className="flex flex-col items-end">
                  <span className="text-sm font-medium leading-none">
                    {user.displayName}
                  </span>
                  <span className="text-xs text-muted-foreground mt-1 capitalize">
                    {t(`roles.${user.primaryRole}`, { defaultValue: user.primaryRole })}
                  </span>
                </div>
                <UserAvatar className="h-8 w-8 text-sm" />
              </Link>

              {/* Avatar only on very small screens */}
              <UserAvatar className="sm:hidden h-8 w-8 text-sm" />

              <div className="hidden sm:block w-px h-8 bg-border" />
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                disabled={logout.isPending}
                title={t("common.logout")}
                aria-label={t("common.logout")}
                className="hidden sm:flex"
              >
                {logout.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <LogOut className="h-4 w-4 text-muted-foreground" />
                )}
              </Button>

              {/* Mobile hamburger */}
              <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                <SheetTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="md:hidden"
                    aria-label={t("nav.openMenu")}
                  >
                    {mobileOpen ? (
                      <X className="h-5 w-5" />
                    ) : (
                      <Menu className="h-5 w-5" />
                    )}
                  </Button>
                </SheetTrigger>
                <SheetContent side="right" className="w-72 p-0 flex flex-col">
                  {/* Sheet header */}
                  <div className="flex items-center gap-3 p-4 border-b">
                    <UserAvatar className="h-9 w-9" />
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">
                        {user.displayName}
                      </p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {user.primaryRole}
                      </p>
                    </div>
                  </div>

                  {/* Nav links — the sheet shows everything (no "More"). */}
                  <nav className="flex flex-col gap-1 p-3 flex-1" aria-label={t("nav.mobileNav")}>
                    {allNav.map((item) => (
                      <SheetClose asChild key={item.href}>
                        <NavLink
                          {...item}
                          onClick={() => setMobileOpen(false)}
                        />
                      </SheetClose>
                    ))}
                  </nav>

                  {/* Logout at bottom */}
                  <div className="p-3 border-t">
                    <Button
                      variant="ghost"
                      className="w-full justify-start gap-2.5 text-muted-foreground"
                      onClick={() => {
                        setMobileOpen(false);
                        handleLogout();
                      }}
                      disabled={logout.isPending}
                    >
                      {logout.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <LogOut className="h-4 w-4" />
                      )}
                      {t("common.logout")}
                    </Button>
                  </div>
                </SheetContent>
              </Sheet>
            </div>
          )}
        </div>
      </header>

      <main id="main" tabIndex={-1} className="flex-1 container mx-auto px-4 py-6 sm:py-8 outline-none">
        {children}
      </main>
    </div>
  );
}
