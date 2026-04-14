import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { formatUSD, formatDate } from "@/lib/utils";
import { 
  ArrowLeftRight, 
  DollarSign, 
  CreditCard, 
  FileText, 
  RefreshCw,
  TrendingUp,
  CheckCircle,
  AlertCircle,
  Building2,
  Save
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";

type TabType = "balance" | "movimientos" | "conciliacion";

interface BalanceData {
  cxc: { totalPendiente: number; totalAbonos: number; cantidadCuentas: number };
  cxp: { totalPendiente: number; totalAbonos: number; cantidadCuentas: number };
  banco: { total: number; ingresos: number; egresos: number };
}

interface Movimiento {
  id: string;
  documento: string;
  documentoAfectado: string;
  partnerName: string;
  fecha: string;
  monto: number;
  saldo: number;
  estado: string;
}

export default function Cuentas() {
  const [activeTab, setActiveTab] = useState<TabType>("balance");
  const [showAbonoDialog, setShowAbonoDialog] = useState(false);
  const [selectedCuenta, setSelectedCuenta] = useState<string | null>(null);
  const [abonoForm, setAbonoForm] = useState({ monto: "", fecha: "", notas: "" });
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [, setLocation] = useLocation();

  const buildMovimientosUrl = () => {
    const tipo = activeTab === "balance" ? "cxc" : activeTab;
    let url = `/api/cuentas/movimientos?tipo=${tipo}`;
    if (fechaDesde) url += `&fechaDesde=${fechaDesde}`;
    if (fechaHasta) url += `&fechaHasta=${fechaHasta}`;
    return url;
  };

  const { data: balance, isLoading: loadingBalance, refetch: refetchBalance } = useQuery<BalanceData>({
    queryKey: ["cuentas", "balance"],
    queryFn: () => fetch("/api/cuentas/balance").then(r => r.json())
  });

  const { data: movimientos, isLoading: loadingMovimientos, refetch: refetchMovimientos } = useQuery<Movimiento[]>({
    queryKey: ["cuentas", "movimientos", activeTab, fechaDesde, fechaHasta],
    queryFn: () => fetch(buildMovimientosUrl()).then(r => r.json())
  });

  const { data: conciliacion, isLoading: loadingConciliacion } = useQuery({
    queryKey: ["cuentas", "conciliacion"],
    queryFn: () => fetch("/api/cuentas/conciliacion").then(r => r.json())
  });

  const queryClient = useQueryClient();

  const abonoMutation = useMutation({
    mutationFn: (data: { cuentaId: string; monto: number; fecha: string; notas: string }) =>
      fetch("/api/cuentas/abonos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
      }).then(r => r.json()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cuentas"] });
      setShowAbonoDialog(false);
      setAbonoForm({ monto: "", fecha: "", notas: "" });
    }
  });

  const handleAbono = () => {
    if (!selectedCuenta || !abonoForm.monto || !abonoForm.fecha) return;
    abonoMutation.mutate({
      cuentaId: selectedCuenta,
      monto: parseFloat(abonoForm.monto),
      fecha: abonoForm.fecha,
      notas: abonoForm.notas
    });
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => setLocation("/")}>
              <ArrowLeftRight className="h-5 w-5" />
            </Button>
            <h1 className="text-2xl font-bold">Cuentas por Cobrar/Pagar</h1>
          </div>
          <Button variant="outline" size="icon" onClick={() => {
            refetchBalance();
            refetchMovimientos();
          }}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex gap-2 mb-6">
          {(["balance", "movimientos", "conciliacion"] as TabType[]).map(tab => (
            <Button
              key={tab}
              variant={activeTab === tab ? "default" : "outline"}
              onClick={() => setActiveTab(tab)}
            >
              {tab === "balance" && <TrendingUp className="h-4 w-4 mr-2" />}
              {tab === "movimientos" && <FileText className="h-4 w-4 mr-2" />}
              {tab === "conciliacion" && <CheckCircle className="h-4 w-4 mr-2" />}
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </Button>
          ))}
        </div>

        {(activeTab === "movimientos" || activeTab === "conciliacion") && (
          <div className="flex gap-2 mb-4 items-center">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Desde:</span>
              <Input
                type="date"
                value={fechaDesde}
                onChange={e => setFechaDesde(e.target.value)}
                className="w-36"
              />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Hasta:</span>
              <Input
                type="date"
                value={fechaHasta}
                onChange={e => setFechaHasta(e.target.value)}
                className="w-36"
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => {
              refetchMovimientos();
              refetchBalance();
            }}>
              <RefreshCw className="h-4 w-4 mr-1" /> Aplicar
            </Button>
          </div>
        )}

        {activeTab === "balance" && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <DollarSign className="h-4 w-4 text-green-600" />
                  Cuentas por Cobrar
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingBalance ? (
                  <div className="h-8 bg-muted animate-pulse rounded" />
                ) : balance ? (
                  <>
                    <div className="text-2xl font-bold text-green-600">
                      {formatUSD(balance.cxc.totalPendiente)}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {balance.cxc.cantidadCuentas} cuentas · {formatUSD(balance.cxc.totalAbonos)} en abonos
                    </div>
                  </>
                ) : (
                  <div className="text-2xl font-bold">{formatUSD(0)}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CreditCard className="h-4 w-4 text-red-600" />
                  Cuentas por Pagar
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingBalance ? (
                  <div className="h-8 bg-muted animate-pulse rounded" />
                ) : balance ? (
                  <>
                    <div className="text-2xl font-bold text-red-600">
                      {formatUSD(balance.cxp.totalPendiente)}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      {balance.cxp.cantidadCuentas} cuentas · {formatUSD(balance.cxp.totalAbonos)} en abonos
                    </div>
                  </>
                ) : (
                  <div className="text-2xl font-bold">{formatUSD(0)}</div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Building2 className="h-4 w-4 text-blue-600" />
                  Banco
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loadingBalance ? (
                  <div className="h-8 bg-muted animate-pulse rounded" />
                ) : balance ? (
                  <>
                    <div className="text-2xl font-bold text-blue-600">
                      {formatUSD(balance.banco.total)}
                    </div>
                    <div className="text-sm text-muted-foreground mt-1">
                      <span className="text-green-600">+{formatUSD(balance.banco.ingresos)}</span>
                      {" · "}
                      <span className="text-red-600">-{formatUSD(balance.banco.egresos)}</span>
                    </div>
                  </>
                ) : (
                  <div className="text-2xl font-bold">{formatUSD(0)}</div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {activeTab === "movimientos" && (
          <Card>
            <CardHeader>
              <CardTitle>Movimientos</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingMovimientos ? (
                <div className="space-y-2">
                  {[1,2,3,4,5].map(i => (
                    <div key={i} className="h-12 bg-muted animate-pulse rounded" />
                  ))}
                </div>
              ) : movimientos && movimientos.length > 0 ? (
                <div className="space-y-2">
                  {movimientos.map(m => (
                    <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg">
                      <div>
                        <div className="font-medium">{m.documento}</div>
                        <div className="text-sm text-muted-foreground">
                          {m.partnerName} · {formatDate(m.fecha)}
                        </div>
                      </div>
                      <div className="text-right">
                        <div className="font-bold">{formatUSD(m.monto)}</div>
                        <Badge variant={m.estado === "conciliado" ? "default" : "secondary"}>
                          {m.estado}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No hay movimientos</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {activeTab === "conciliacion" && (
          <Card>
            <CardHeader>
              <CardTitle>Conciliación Bancaria</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingConciliacion ? (
                <div className="h-20 bg-muted animate-pulse rounded" />
              ) : conciliacion ? (
                <>
                  <div className="grid grid-cols-3 gap-4 mb-4">
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <div className="text-2xl font-bold">{conciliacion.totalRegistrado}</div>
                      <div className="text-sm text-muted-foreground">Total Registrado</div>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <div className="text-2xl font-bold text-green-600">{conciliacion.totalConciliado}</div>
                      <div className="text-sm text-muted-foreground">Conciliados</div>
                    </div>
                    <div className="text-center p-4 bg-muted rounded-lg">
                      <div className="text-2xl font-bold text-orange-600">{conciliacion.totalPendiente}</div>
                      <div className="text-sm text-muted-foreground">Pendientes</div>
                    </div>
                  </div>
                  <Separator className="my-4" />
                  <div className="space-y-2">
                    {conciliacion.movimientos?.slice(0, 20).map((m: Movimiento) => (
                      <div key={m.id} className="flex items-center justify-between p-3 border rounded-lg">
                        <div>
                          <div className="font-medium">{m.documento}</div>
                          <div className="text-sm text-muted-foreground">
                            {m.partnerName} · {formatDate(m.fecha)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="font-bold">{formatUSD(m.monto)}</div>
                          <Badge variant={m.estado === "conciliado" ? "default" : "outline"}>
                            {m.estado === "conciliado" ? <CheckCircle className="h-3 w-3 mr-1" /> : <AlertCircle className="h-3 w-3 mr-1" />}
                            {m.estado}
                          </Badge>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
                  <p>No hay datos de conciliación</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Dialog open={showAbonoDialog} onOpenChange={setShowAbonoDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar Abono</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div>
                <label className="text-sm font-medium">Monto</label>
                <Input
                  type="number"
                  value={abonoForm.monto}
                  onChange={e => setAbonoForm(f => ({ ...f, monto: e.target.value }))}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="text-sm font-medium">Fecha</label>
                <Input
                  type="date"
                  value={abonoForm.fecha}
                  onChange={e => setAbonoForm(f => ({ ...f, fecha: e.target.value }))}
                />
              </div>
              <div>
                <label className="text-sm font-medium">Notas</label>
                <Input
                  value={abonoForm.notas}
                  onChange={e => setAbonoForm(f => ({ ...f, notas: e.target.value }))}
                  placeholder="Notas adicionales..."
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShowAbonoDialog(false)}>
                Cancelar
              </Button>
              <Button onClick={handleAbono} disabled={abonoMutation.isPending}>
                <Save className="h-4 w-4 mr-2" />
                Guardar
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}