import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { formatUSD, formatBs, formatDateTime, getStatusColor, getStatusLabel, todayStr } from "@/lib/utils";
import { CalendarDays, LogOut, Store, Users, List, RefreshCw, Printer, Loader2, KeyRound } from "lucide-react";

const FISCAL_MACHINE_MAP: Record<number, { machine: string; isMain: boolean }> = {
  1: { machine: "Z1F0019552", isMain: true },
  7: { machine: "Z1F0019552", isMain: false },
  2: { machine: "Z7C7044514", isMain: true },
  8: { machine: "Z7C7044514", isMain: false },
};

interface FiscalPrinterGroup {
  machine: string;
  mainSession: any;
  companionSession: any | null;
  totalOrderCount: number;
  totalUSD: number;
  cajaNames: string[];
  earliestStart: string | null;
  latestEnd: string | null;
}

function groupByFiscalMachine(sessions: any[]): FiscalPrinterGroup[] {
  const groups: Record<string, { main: any | null; companion: any | null }> = {};

  for (const s of sessions) {
    const configId = s.config_id?.[0];
    const mapping = configId != null ? FISCAL_MACHINE_MAP[configId] : null;
    if (!mapping) continue;

    if (!groups[mapping.machine]) {
      groups[mapping.machine] = { main: null, companion: null };
    }
    if (mapping.isMain) {
      groups[mapping.machine].main = s;
    } else {
      groups[mapping.machine].companion = s;
    }
  }

  return Object.entries(groups)
    .filter(([, g]) => g.main != null)
    .map(([machine, g]) => {
      const main = g.main!;
      const comp = g.companion;
      const sessions = comp ? [main, comp] : [main];

      const totalOrderCount = sessions.reduce((sum, s) => sum + (s.order_count || 0), 0);
      const totalUSD = sessions.reduce((sum, s) => sum + (s.total_payments_amount || 0), 0);
      const cajaNames = sessions.map(s => s.config_id?.[1] || "Caja");

      const starts = sessions.map(s => s.start_at).filter(Boolean);
      const ends = sessions.map(s => s.stop_at).filter(Boolean);
      const earliestStart = starts.length > 0 ? starts.sort()[0] : null;
      const latestEnd = ends.length > 0 ? ends.sort().reverse()[0] : null;

      return {
        machine,
        mainSession: main,
        companionSession: comp,
        totalOrderCount,
        totalUSD,
        cajaNames,
        earliestStart,
        latestEnd,
      };
    })
    .sort((a, b) => a.machine.localeCompare(b.machine));
}

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();
  const [date, setDate] = useState(todayStr());
  const [loadingMachine, setLoadingMachine] = useState<string | null>(null);
  const [showPassModal, setShowPassModal] = useState(false);
  const [passForm, setPassForm] = useState({ actual: "", nueva: "", confirmar: "" });
  const [passStatus, setPassStatus] = useState<{ ok?: boolean; msg?: string } | null>(null);
  const [passLoading, setPassLoading] = useState(false);

  const handleChangePassword = async () => {
    setPassStatus(null);
    if (!passForm.actual || !passForm.nueva || !passForm.confirmar) {
      return setPassStatus({ ok: false, msg: "Completa todos los campos" });
    }
    if (passForm.nueva !== passForm.confirmar) {
      return setPassStatus({ ok: false, msg: "Las contraseñas nuevas no coinciden" });
    }
    setPassLoading(true);
    try {
      const res = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: user?.email, passwordActual: passForm.actual, passwordNueva: passForm.nueva }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setPassStatus({ ok: true, msg: "Contraseña cambiada exitosamente" });
      setPassForm({ actual: "", nueva: "", confirmar: "" });
    } catch (err: any) {
      setPassStatus({ ok: false, msg: err.message });
    } finally {
      setPassLoading(false);
    }
  };

  const { data: sessions, isLoading, refetch } = useQuery({
    queryKey: ["sessions", date],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/sessions?date=${date}`);
      if (!res.ok) throw new Error("Error al cargar sesiones");
      return res.json();
    },
  });

  const { data: rateData } = useQuery({
    queryKey: ["rate", date],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/rate?date=${date}`);
      if (!res.ok) throw new Error("Error al cargar tasa");
      return res.json();
    },
  });

  const rate = rateData?.rate || 0;

  const fiscalGroups = useMemo(() => {
    if (!sessions?.length) return [];
    return groupByFiscalMachine(sessions);
  }, [sessions]);

  const handleGroupClick = (group: FiscalPrinterGroup) => {
    if (loadingMachine) return; // Prevent double-click
    setLoadingMachine(group.machine);
    const main = group.mainSession;
    // Use requestAnimationFrame to ensure the spinner renders before navigating
    requestAnimationFrame(() => {
      setTimeout(() => {
        if (main.cuadre) {
          navigate(`/cuadre/${main.cuadre.id}`);
        } else {
          navigate(`/cuadre/new?sessionId=${main.id}`);
        }
      }, 100);
    });
  };

  const canManageUsers = user?.rol === "admin";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0A4083] text-white shadow-md no-print">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold">Cuadre de Caja</h1>
            <p className="text-xs opacity-80">{user?.nombre} — {user?.rol}</p>
          </div>
          <div className="flex items-center gap-2">
            {canManageUsers && (
              <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate("/users")}>
                <Users className="h-4 w-4 mr-1" /> Usuarios
              </Button>
            )}
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate("/cuentas")}>
              <List className="h-4 w-4 mr-1" /> CxC/CxP
            </Button>
            <Button variant="ghost" size="sm" className="text-white hover:bg-white/20" onClick={() => navigate("/cuadres")}>
              <List className="h-4 w-4 mr-1" /> Historial
            </Button>
            <Button variant="ghost" size="icon" title="Cambiar contraseña" className="text-white hover:bg-white/20" onClick={() => { setPassStatus(null); setPassForm({ actual: "", nueva: "", confirmar: "" }); setShowPassModal(true); }}>
              <KeyRound className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={logout}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Date & Rate */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-muted-foreground" />
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" />
          </div>
          {rate > 0 && (
            <Badge variant="outline" className="text-sm font-bold px-3 py-1 border-amber-400 bg-amber-50 text-amber-800">
              Tasa: {rate.toFixed(2)} Bs/$
            </Badge>
          )}
          <Button variant="outline" size="sm" onClick={() => refetch()}>
            <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
          </Button>
        </div>

        <Separator />

        {/* Fiscal Printers */}
        <div>
          <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
            Impresoras Fiscales — {date}
          </h2>

          {isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Cargando sesiones...</div>
          ) : fiscalGroups.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No hay sesiones POS para esta fecha
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-3">
              {fiscalGroups.map((group) => {
                const cuadreStatus = group.mainSession.cuadre?.estado;
                const totalBs = rate > 0 ? group.totalUSD * rate : 0;
                const isCardLoading = loadingMachine === group.machine;
                return (
                  <Card
                    key={group.machine}
                    className={`cursor-pointer hover:shadow-md transition-shadow relative overflow-hidden ${isCardLoading ? "pointer-events-none" : ""}`}
                    onClick={() => handleGroupClick(group)}
                  >
                    {isCardLoading && (
                      <div className="absolute inset-0 bg-white/80 z-10 flex items-center justify-center gap-3">
                        <Loader2 className="h-6 w-6 text-[#0A4083] animate-spin" />
                        <span className="text-sm font-medium text-[#0A4083]">Cargando datos de Odoo...</span>
                      </div>
                    )}
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Printer className="h-4 w-4 text-muted-foreground" />
                            <span className="font-semibold font-mono text-sm">{group.machine}</span>
                          </div>
                          <p className="text-sm text-muted-foreground">
                            {group.cajaNames.join(" + ")}
                          </p>
                          <p className="text-sm text-muted-foreground">
                            Cajero: {group.mainSession.user_id?.[1]} &middot; {group.totalOrderCount} operaciones
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {group.earliestStart && <>Apertura: {formatDateTime(group.earliestStart)}</>}
                            {group.latestEnd && <> — Cierre: {formatDateTime(group.latestEnd)}</>}
                          </p>
                        </div>
                        <div className="text-right space-y-1">
                          <p className="font-semibold text-lg">
                            {formatUSD(group.totalUSD)}
                          </p>
                          {rate > 0 && (
                            <p className="text-sm text-muted-foreground">
                              {formatBs(totalBs)}
                            </p>
                          )}
                          {cuadreStatus ? (
                            <Badge className={getStatusColor(cuadreStatus)}>
                              {getStatusLabel(cuadreStatus)}
                            </Badge>
                          ) : (
                            <Badge variant="secondary">Sin cuadre</Badge>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </main>

      {/* Modal cambio de contraseña */}
      <Dialog open={showPassModal} onOpenChange={open => { setShowPassModal(open); if (!open) setPassStatus(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4" /> Cambiar contraseña
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Contraseña actual</div>
              <Input
                type="password"
                value={passForm.actual}
                onChange={e => setPassForm(f => ({ ...f, actual: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Nueva contraseña</div>
              <Input
                type="password"
                value={passForm.nueva}
                onChange={e => setPassForm(f => ({ ...f, nueva: e.target.value }))}
                placeholder="••••••••"
              />
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Confirmar nueva contraseña</div>
              <Input
                type="password"
                value={passForm.confirmar}
                onChange={e => setPassForm(f => ({ ...f, confirmar: e.target.value }))}
                placeholder="••••••••"
                onKeyDown={e => e.key === "Enter" && handleChangePassword()}
              />
            </div>
            {passStatus && (
              <div className={`text-sm px-3 py-2 rounded ${passStatus.ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                {passStatus.msg}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPassModal(false)}>Cancelar</Button>
            <Button onClick={handleChangePassword} disabled={passLoading}>
              {passLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <KeyRound className="h-4 w-4 mr-1" />}
              Cambiar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
