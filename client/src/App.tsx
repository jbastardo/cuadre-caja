import { Switch, Route } from "wouter";
import { useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import CuadreForm from "@/pages/CuadreForm";
import CuadreList from "@/pages/CuadreList";
import CuadreNFForm from "@/pages/CuadreNFForm";
import CuadreNFReport from "@/pages/CuadreNFReport";
import CuadreReport from "@/pages/CuadreReport";
import UserManagement from "@/pages/UserManagement";
import Cuentas from "@/pages/Cuentas";
import { Toaster } from "@/components/ui/toaster";

// Global fetch interceptor: add auth headers + handle 401 globally
const originalFetch = window.fetch;
window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.startsWith('/api') && !url.startsWith('/api/auth/')) {
    try {
      const userStr = localStorage.getItem('cuadre_user');
      const user = userStr ? JSON.parse(userStr) : null;
      if (user?.email) {
        const headers = new Headers(init?.headers);
        headers.set('x-user-email', user.email);
        headers.set('authorization', `Bearer ${user.email}`);
        init = { ...init, headers };
      }
    } catch {}
  }
  return originalFetch(input, init).then(res => {
    if (res.status === 401 && !url.startsWith('/api/auth/')) {
      localStorage.removeItem('cuadre_user');
      window.location.reload();
    }
    return res;
  });
};

function AppRoutes() {
  const { user, isLoading } = useAuth();

  // Clean up residual search parameters (e.g. ?sessionId=4459) from window.location.search
  // to avoid URL pollution and discrepancies across browser tabs in HashRouter.
  useEffect(() => {
    if (window.location.search) {
      const searchParams = new URLSearchParams(window.location.search);
      const sessionId = searchParams.get("sessionId");
      let currentHash = window.location.hash || "#/";

      // If we have a sessionId and are on a route that uses it, ensure it's in the hash
      if (sessionId && !currentHash.includes("sessionId=")) {
        const [hashPath, hashQuery] = currentHash.split("?");
        if (hashPath === "#/cuadre/new" || hashPath === "#/cuadre-nf" || hashPath === "#/cuadre-nf/report") {
          const hashParams = new URLSearchParams(hashQuery || "");
          hashParams.set("sessionId", sessionId);
          currentHash = `${hashPath}?${hashParams.toString()}`;
        }
      }

      // Replace URL cleanly without reloading
      window.history.replaceState(null, "", window.location.pathname + currentHash);
    }
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-muted-foreground">Cargando...</div>
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/cuadre-nf" component={CuadreNFForm} />
                      <Route path="/cuadre-nf/report" component={CuadreNFReport} />
      <Route path="/cuadre/new" component={CuadreForm} />
      <Route path="/cuadre/:id/report" component={CuadreReport} />
      <Route path="/cuadre/:id" component={CuadreForm} />
      <Route path="/cuadres" component={CuadreList} />
      <Route path="/users" component={UserManagement} />
      <Route path="/cuentas" component={Cuentas} />
      <Route>
        <div className="min-h-screen flex items-center justify-center">
          <p>Página no encontrada</p>
        </div>
      </Route>
    </Switch>
  );
}

export default function App() {
  return (
    <>
      <AppRoutes />
      <Toaster />
    </>
  );
}
