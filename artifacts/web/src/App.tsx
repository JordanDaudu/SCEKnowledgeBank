import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import Login from "@/pages/login";
import Register from "@/pages/register";
import Home from "@/pages/home";
import Browse from "@/pages/browse";
import DocumentDetail from "@/pages/document-detail";
import Upload from "@/pages/upload";
import Requests from "@/pages/requests";
import Notifications from "@/pages/notifications";
import AdminUsers from "@/pages/admin-users";
import AdminAnalytics from "@/pages/admin-analytics";
import CourseAnalytics from "@/pages/course-analytics";
import ReviewQueue from "@/pages/review-queue";
import { FEATURE_REVIEW } from "@/lib/feature-flags";

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
        <AuthGuard requireRole="lecturer">
          <Layout>
            <Upload />
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

      {FEATURE_REVIEW && (
        <Route path="/review-queue">
          <AuthGuard requireRole="lecturer">
            <Layout>
              <ReviewQueue />
            </Layout>
          </AuthGuard>
        </Route>
      )}

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
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
