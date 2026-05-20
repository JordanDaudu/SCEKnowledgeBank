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
import AdminUsers from "@/pages/admin-users";

import { Layout } from "@/components/layout";
import { AuthGuard } from "@/components/auth-guard";

const queryClient = new QueryClient();

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

      <Route path="/admin/users">
        <AuthGuard requireRole="admin">
          <Layout>
            <AdminUsers />
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
