import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, RefreshCw, TrendingUp, TrendingDown, Clock } from "lucide-react";

type TipoTab = "cxc" | "cxp" | "destiempo";
type EstadoFilter = "todos" | "pendiente" | "pagado";

interface Factura {
  id: number;
  numero: string;
  cliente?: string;
  proveedor?: string;
  fecha: string;
  diario: string;
  montoUSD: number;
  saldoUSD: number;
  montoBs: number;
  saldoBs: number;
  tasa: number;
  estado: "pendiente" | "pagado";
  tipo: "cxc" | "cxp";
}

interface PagoDestiempo {
  id: number;
  numero: string;
  partner: string;
  fechaFactura: string;
  fechaPago: string;
  diasRetraso: number;
  montoUSD: number;
  montoBs: number;
  tasa: number;
  diario: string;
  usuario: string;
}

interface FacturasResponse {
  facturas: Factura[];
  totalUSD: number;
  saldoUSD: number;
  totalBs: number;
  saldoBs: number;
  cantidad: number;
}

interface PagosDestiempoResponse {
  pagos: PagoDestiempo[];
  totalUSD: number;
  totalBs: number;
  cantidad: number;
}

interface BalanceResponse {
  cxc: { cantidad: number; totalUSD: number; saldoUSD: number; totalBs: number; saldoBs: number; pendiente: number; pagado: number };
  cxp: { cantidad: number; totalUSD: number; saldoUSD: number; totalBs: number; saldoBs: number; pendiente: number; pagado: number };
}

const DIARIOS_CXC = ["FAC01", "FAC02", "FAC4"];

function fmtUSD(n: number) {
  return new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
}
function fmtBs(n: number) {
  return "Bs " + new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2 }).format(n || 0);
}

export default function Cuentas() {
  const [, setLocation] = useLocation();
  const [tipo, setTipo] = useState<TipoTab>("cxc");
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [diario, setDiario] = useState("todos");
  const [estado, setEstado] = useState<EstadoFilter>("todos");
  const [usuario, setUsuario] = useState("");

  const buildFacturasParams = () => {
    const p = new URLSearchParams({ tipo: tipo === "destiempo" ? "cxc" : tipo });
    if (fechaDesde) p.append("fechaDesde", fechaDesde);
    if (fechaHasta) p.append("fechaHasta", fechaHasta);
    if (diario && diario !== "todos") p.append("diario", diario);
    if (estado && estado !== "todos") p.append("estado", estado);
    return p.toString();
  };

  const buildDestiempoParams = () => {
    const p = new URLSearchParams();
    if (fechaDesde) p.append("fechaDesde", fechaDesde);
    if (fechaHasta) p.append("fechaHasta", fechaHasta);
    if (diario && diario !== "todos") p.append("diario", diario);
    if (usuario) p.append("usuario", usuario);
    return p.toString();
  };

  const { data, isLoading, refetch } = useQuery<FacturasResponse>({
    queryKey: ["cuentas", "facturas", tipo, fechaDesde, fechaHasta, diario, estado],
    queryFn: () => fetch(`/api/cuentas/facturas?${buildFacturasParams()}`).then(r => r.json()),
    enabled: tipo !== "destiempo",
  });

  const { data: pagosDestiempo, isLoading: loadingDestiempo, refetch: refetchDestiempo } = useQuery<PagosDestiempoResponse>({
    queryKey: ["cuentas", "destiempo", fechaDesde, fechaHasta, diario, usuario],
    queryFn: () => fetch(`/api/cuentas/destiempo?${buildDestiempoParams()}`).then(r => r.json()),
    enabled: tipo === "destiempo",
  });

  const { data: balance, isLoading: loadingBalance, refetch: refetchBalance } = useQuery<BalanceResponse>({
    queryKey: ["cuentas", "balance", fechaDesde, fechaHasta],
    queryFn: () => {
      const p = new URLSearchParams();
      if (fechaDesde) p.append("fechaDesde", fechaDesde);
      if (fechaHasta) p.append("fechaHasta", fechaHasta);
      return fetch(`/api/cuentas/balance?${p.toString()}`).then(r => r.json());
    },
  });

  const handleRefresh = () => { refetch(); refetchBalance(); refetchDestiempo(); };
  const balData = tipo !== "destiempo" ? balance?.[tipo as "cxc" | "cxp"] : null;

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Volver
            </Button>
            <h1 className="text-xl font-bold">Cuentas por Cobrar / Pagar</h1>
          </div>
          <Button variant="outline" size="sm" onClick={handleRefresh}>
            <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
          </Button>
        </div>

        {/* Tabs */}
        <div className="flex gap-2 flex-wrap">
          <Button variant={tipo === "cxc" ? "default" : "outline"} onClick={() => { setTipo("cxc"); setDiario("todos"); }}>
            <TrendingUp className="h-4 w-4 mr-1" /> Cuentas por Cobrar
          </Button>
          <Button variant={tipo === "cxp" ? "default" : "outline"} onClick={() => { setTipo("cxp"); setDiario("todos"); }}>
            <TrendingDown className="h-4 w-4 mr-1" /> Cuentas por Pagar
          </Button>
          <Button variant={tipo === "destiempo" ? "default" : "outline"} onClick={() => setTipo("destiempo")}>
            <Clock className="h-4 w-4 mr-1" /> Pagos a Destiempo
          </Button>
        </div>

        {/* Resumen (solo CxC/CxP) */}
        {tipo !== "destiempo" && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Total Facturas</div>
                {loadingBalance ? <div className="h-6 bg-muted animate-pulse rounded mt-1" /> : (
                  <>
                    <div className="text-lg font-bold">{fmtUSD(balData?.totalUSD || 0)}</div>
                    <div className="text-sm text-orange-600">{fmtBs(balData?.totalBs || 0)}</div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Saldo Pendiente</div>
                {loadingBalance ? <div className="h-6 bg-muted animate-pulse rounded mt-1" /> : (
                  <>
                    <div className="text-lg font-bold text-red-600">{fmtUSD(balData?.saldoUSD || 0)}</div>
                    <div className="text-sm text-orange-600">{fmtBs(balData?.saldoBs || 0)}</div>
                  </>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Pendientes</div>
                {loadingBalance ? <div className="h-6 bg-muted animate-pulse rounded mt-1" /> : (
                  <div className="text-lg font-bold text-amber-600">{balData?.pendiente ?? 0} facturas</div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Pagadas</div>
                {loadingBalance ? <div className="h-6 bg-muted animate-pulse rounded mt-1" /> : (
                  <div className="text-lg font-bold text-green-600">{balData?.pagado ?? 0} facturas</div>
                )}
              </CardContent>
            </Card>
          </div>
        )}

        {/* Filtros */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Desde</div>
                <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="w-36" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Hasta</div>
                <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="w-36" />
              </div>
              {(tipo === "cxc" || tipo === "destiempo") && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Diario</div>
                  <Select value={diario} onValueChange={setDiario}>
                    <SelectTrigger className="w-32">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      {DIARIOS_CXC.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tipo !== "destiempo" && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Estado</div>
                  <Select value={estado} onValueChange={v => setEstado(v as EstadoFilter)}>
                    <SelectTrigger className="w-36">
                      <SelectValue placeholder="Todos" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos</SelectItem>
                      <SelectItem value="pendiente">Pendiente</SelectItem>
                      <SelectItem value="pagado">Pagado</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {tipo === "destiempo" && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">Usuario</div>
                  <Input
                    placeholder="Filtrar por usuario..."
                    value={usuario}
                    onChange={e => setUsuario(e.target.value)}
                    className="w-44"
                  />
                </div>
              )}
              <Button onClick={handleRefresh} size="sm">Buscar</Button>
              <Button variant="ghost" size="sm" onClick={() => {
                setFechaDesde(""); setFechaHasta(""); setDiario("todos"); setEstado("todos"); setUsuario("");
              }}>Limpiar</Button>
            </div>
          </CardContent>
        </Card>

        {/* Tabla Facturas (CxC / CxP) */}
        {tipo !== "destiempo" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {isLoading ? "Cargando..." : `${data?.cantidad ?? 0} registros · Total: ${fmtUSD(data?.totalUSD || 0)} · Saldo: ${fmtUSD(data?.saldoUSD || 0)}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {isLoading ? (
                <div className="p-6 space-y-2">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}
                </div>
              ) : !data?.facturas?.length ? (
                <div className="p-6 text-center text-muted-foreground">No hay registros con los filtros seleccionados</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left">Número</th>
                        <th className="px-3 py-2 text-left">{tipo === "cxc" ? "Cliente" : "Proveedor"}</th>
                        <th className="px-3 py-2 text-left">Fecha</th>
                        <th className="px-3 py-2 text-left">Diario</th>
                        <th className="px-3 py-2 text-right">Monto USD</th>
                        <th className="px-3 py-2 text-right">Monto Bs</th>
                        <th className="px-3 py-2 text-right">Saldo USD</th>
                        <th className="px-3 py-2 text-right">Saldo Bs</th>
                        <th className="px-3 py-2 text-right">Tasa</th>
                        <th className="px-3 py-2 text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.facturas.map(f => (
                        <tr key={f.id} className="border-b hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs">{f.numero}</td>
                          <td className="px-3 py-2">{f.cliente || f.proveedor || "-"}</td>
                          <td className="px-3 py-2">{f.fecha}</td>
                          <td className="px-3 py-2 text-xs">{f.diario}</td>
                          <td className="px-3 py-2 text-right">{fmtUSD(f.montoUSD)}</td>
                          <td className="px-3 py-2 text-right text-orange-600">{fmtBs(f.montoBs)}</td>
                          <td className="px-3 py-2 text-right">{fmtUSD(f.saldoUSD)}</td>
                          <td className="px-3 py-2 text-right text-orange-600">{fmtBs(f.saldoBs)}</td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">{f.tasa?.toFixed(2)}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant={f.estado === "pagado" ? "default" : "destructive"} className="text-xs">
                              {f.estado}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40 font-semibold border-t">
                      <tr>
                        <td colSpan={4} className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right">{fmtUSD(data.totalUSD)}</td>
                        <td className="px-3 py-2 text-right text-orange-600">{fmtBs(data.totalBs)}</td>
                        <td className="px-3 py-2 text-right">{fmtUSD(data.saldoUSD)}</td>
                        <td className="px-3 py-2 text-right text-orange-600">{fmtBs(data.saldoBs)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Tabla Pagos a Destiempo */}
        {tipo === "destiempo" && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">
                {loadingDestiempo ? "Cargando..." : `${pagosDestiempo?.cantidad ?? 0} pagos a destiempo · Total: ${fmtUSD(pagosDestiempo?.totalUSD || 0)}`}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {loadingDestiempo ? (
                <div className="p-6 space-y-2">
                  {[...Array(5)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}
                </div>
              ) : !pagosDestiempo?.pagos?.length ? (
                <div className="p-6 text-center text-muted-foreground">No hay pagos a destiempo con los filtros seleccionados</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left">Número</th>
                        <th className="px-3 py-2 text-left">Cliente</th>
                        <th className="px-3 py-2 text-left">Fecha Factura</th>
                        <th className="px-3 py-2 text-left">Fecha Pago</th>
                        <th className="px-3 py-2 text-center">Días</th>
                        <th className="px-3 py-2 text-right">Monto USD</th>
                        <th className="px-3 py-2 text-right">Monto Bs</th>
                        <th className="px-3 py-2 text-right">Tasa</th>
                        <th className="px-3 py-2 text-left">Diario Pago</th>
                        <th className="px-3 py-2 text-left">Usuario</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pagosDestiempo.pagos.map(p => (
                        <tr key={p.id} className="border-b hover:bg-muted/20">
                          <td className="px-3 py-2 font-mono text-xs">{p.numero}</td>
                          <td className="px-3 py-2">{p.partner}</td>
                          <td className="px-3 py-2">{p.fechaFactura}</td>
                          <td className="px-3 py-2">{p.fechaPago}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant={p.diasRetraso > 3 ? "destructive" : "outline"} className="text-xs">
                              {p.diasRetraso}d
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right">{fmtUSD(p.montoUSD)}</td>
                          <td className="px-3 py-2 text-right text-orange-600">{fmtBs(p.montoBs)}</td>
                          <td className="px-3 py-2 text-right text-xs text-muted-foreground">{p.tasa?.toFixed(2)}</td>
                          <td className="px-3 py-2 text-xs">{p.diario}</td>
                          <td className="px-3 py-2 text-xs">{p.usuario}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-muted/40 font-semibold border-t">
                      <tr>
                        <td colSpan={5} className="px-3 py-2">Total</td>
                        <td className="px-3 py-2 text-right">{fmtUSD(pagosDestiempo.totalUSD)}</td>
                        <td className="px-3 py-2 text-right text-orange-600">{fmtBs(pagosDestiempo.totalBs)}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}

      </div>
    </div>
  );
}
