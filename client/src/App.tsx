import { Switch, Route } from "wouter";
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

// Global fetch interceptor: add auth headers to all /api requests
const originalFetch = window.fetch;
window.fetch = function(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : (input as Request).url;
  if (url.startsWith('/api')) {
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
  return originalFetch(input, init);
};

function AppRoutes() {
  const { user, isLoading } = useAuth();

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
