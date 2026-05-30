import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Register from "@/pages/register";
import Home from "@/pages/home";
import Browse from "@/pages/browse";
import DocumentDetail from "@/pages/document-detail";
import Upload from "@/pages/upload";
import UploadHistory from "@/pages/upload-history";
import PrepHub from "@/pages/prep-hub";
import PrepHubCollection from "@/pages/prep-hub-collection";
import Collections from "@/pages/collections";
import CollectionManage from "@/pages/collection-manage";
import Requests from "@/pages/requests";
import Notifications from "@/pages/notifications";
import AdminUsers from "@/pages/admin-users";
import AdminAnalytics from "@/pages/admin-analytics";
import AdminPrepHubModeration from "@/pages/admin-prep-hub-moderation";
import CourseAnalytics from "@/pages/course-analytics";
import ReviewQueue from "@/pages/review-queue";

import { Layout } from "@/components/layout";
import { AuthGuard } from "@/components/auth-guard";

// Sensible defaults so currently-fresh reference data (courses, tags,
// categories, current user, storage quota) isn't refetched on every mount
// or tab focus — the API logs were showing repeated bursts of identical
// GETs caused by multiple components each independently subscribing.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      refetchOnMount: false,
      retry: 1,
    },
    mutations: {
      retry: 0,
    },
  },
});

function Router() {
  return (
    <Switch>
      <Route path="/login" component={Login} />
      <Route path="/register" component={Register} />
      
      <Route path="/">
        <AuthGuard>
          <Layout>
            <Home />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/browse">
        <AuthGuard>
          <Layout>
            <Browse />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/documents/:id">
        <AuthGuard>
          <Layout>
            <DocumentDetail />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/upload">
        {/* Sprint-3 completion: Upload is reachable for every
            authenticated user. The page itself reads the current
            user's roles + enrollments to render the right form, and
            the server (`canUpload` / `canUploadToCourse` /
            `uploadDocuments`) is the authoritative gate — a student
            with zero enrollments will still get a 403 from the API. */}
        <AuthGuard>
          <Layout>
            <Upload />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/uploads">
        <AuthGuard>
          <Layout>
            <UploadHistory />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/collections">
        <AuthGuard blockAdmin>
          <Layout>
            <Collections />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/collections/:id">
        <AuthGuard blockAdmin>
          <Layout>
            <CollectionManage />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/prep-hub">
        <AuthGuard>
          <Layout>
            <PrepHub />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/prep-hub/:id">
        <AuthGuard>
          <Layout>
            <PrepHubCollection />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/requests">
        <AuthGuard>
          <Layout>
            <Requests />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/notifications">
        <AuthGuard>
          <Layout>
            <Notifications />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/review-queue">
        <AuthGuard requireRole="lecturer">
          <Layout>
            <ReviewQueue />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/admin/users">
        <AuthGuard requireRole="admin">
          <Layout>
            <AdminUsers />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/admin/analytics">
        <AuthGuard requireRole="admin">
          <Layout>
            <AdminAnalytics />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/admin/prep-hub-moderation">
        <AuthGuard requireRole="admin">
          <Layout>
            <AdminPrepHubModeration />
          </Layout>
        </AuthGuard>
      </Route>

      <Route path="/courses/:courseId/analytics">
        <AuthGuard requireRole="lecturer">
          <Layout>
            <CourseAnalytics />
          </Layout>
        </AuthGuard>
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ThemeProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      storageKey="kb-theme"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Router />
          </WouterRouter>
          <Toaster />
        </TooltipProvider>
      </QueryClientProvider>
    </ThemeProvider>
  );
}

export default App;
