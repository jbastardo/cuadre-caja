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
import { Toaster } from "@/components/ui/toaster";

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
