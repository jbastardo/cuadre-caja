import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, RefreshCw, Search, X, AlertTriangle, CheckCircle2, Info } from "lucide-react";

interface PagoDiferido {
  facturaId: number;
  facturaNro: string;
  facturaFecha: string;
  montoFacturaUSD: number;
  montoFacturaBs: number;
  saldoFacturaUSD: number;
  saldoFacturaBs: number;
  tasaFactura: number;
  sesionId: number | null;
  sesionNombre: string;
  pagoId: number;
  pagoNro: string;
  pagoFecha: string;
  pagoJournal: string;
  montoPagoUSD: number;
  montoPagoBs: number;
  tasaPago: number;
  cliente: string;
  usuario: string;
  metodosPOS: string;
  tieneSaldoFavor: boolean;
  mismodia: boolean;
  diasDiferencia: number;
  tipoDiferimiento: "mismo_dia" | "diferido" | "saldo_favor_ok" | "saldo_favor_diferido";
}

interface TipoTotales { cantidad: number; totalUSD: number; totalBs: number; }

interface ConciliacionResponse {
  pagos: PagoDiferido[];
  cantidad: number;
  totalPagosUSD: number;
  totalPagosBs: number;
  totalSaldoUSD: number;
  totalSaldoBs: number;
  porTipo: Record<string, TipoTotales>;
}

interface FiltrosData {
  metodosPOS: { id: number; name: string }[];
  bancos: { id: number; name: string; type: string }[];
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
}
function fmtBs(n: number) {
  return "Bs " + new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2 }).format(n || 0);
}

const TIPO_CONFIG: Record<string, { label: string; badgeClass: string; rowClass: string; color: string }> = {
  saldo_favor_diferido: {
    label: "Saldo a Favor — Diferido ⚠️",
    badgeClass: "bg-red-100 text-red-700 border-red-300",
    rowClass: "bg-red-50 hover:bg-red-100",
    color: "text-red-700",
  },
  diferido: {
    label: "Diferido",
    badgeClass: "bg-amber-100 text-amber-700 border-amber-300",
    rowClass: "bg-amber-50 hover:bg-amber-100",
    color: "text-amber-700",
  },
  saldo_favor_ok: {
    label: "Saldo a Favor — Mismo día",
    badgeClass: "bg-blue-100 text-blue-700 border-blue-300",
    rowClass: "bg-blue-50 hover:bg-blue-100",
    color: "text-blue-700",
  },
  mismo_dia: {
    label: "Mismo día",
    badgeClass: "bg-green-100 text-green-700 border-green-300",
    rowClass: "hover:bg-muted/20",
    color: "text-green-700",
  },
};

export default function Cuentas() {
  const [, setLocation] = useLocation();
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [usuario, setUsuario]       = useState("");
  const [banco, setBanco]           = useState("todos");
  const [metodoPOS, setMetodoPOS]   = useState("todos");
  const [soloDestiempo, setSoloDestiempo] = useState(false);
  const [buscar, setBuscar]         = useState(false);

  const tieneFechas = !!(fechaDesde || fechaHasta);

  const { data: filtros } = useQuery<FiltrosData>({
    queryKey: ["filtros"],
    queryFn: () => fetch("/api/cuentas/filtros").then(r => r.json()),
    staleTime: 10 * 60 * 1000,
  });

  const buildParams = () => {
    const p = new URLSearchParams();
    if (fechaDesde) p.append("fechaDesde", fechaDesde);
    if (fechaHasta) p.append("fechaHasta", fechaHasta);
    if (usuario)    p.append("usuario", usuario);
    if (banco !== "todos")     p.append("banco", banco);
    if (metodoPOS !== "todos") p.append("metodoPOS", metodoPOS);
    if (soloDestiempo) p.append("soloDestiempo", "1");
    return p.toString();
  };

  const { data, isLoading, refetch, error } = useQuery<ConciliacionResponse>({
    queryKey: ["conciliacion", fechaDesde, fechaHasta, usuario, banco, metodoPOS, soloDestiempo],
    queryFn:  () => fetch(`/api/conciliacion/pagos-diferidos?${buildParams()}`).then(r => r.json()),
    enabled:  buscar,
  });

  const handleBuscar  = () => { setBuscar(true); setTimeout(() => refetch(), 50); };
  const handleLimpiar = () => {
    setFechaDesde(""); setFechaHasta(""); setUsuario(""); setBanco("todos");
    setMetodoPOS("todos"); setSoloDestiempo(false); setBuscar(false);
  };

  const porTipo = data?.porTipo || {};

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="sm" onClick={() => setLocation("/")}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Volver
            </Button>
            <div>
              <h1 className="text-xl font-bold">Conciliación de Pagos Diferidos</h1>
              <p className="text-xs text-muted-foreground max-w-xl">
                Pagos contables registrados contra facturas POS — identifica los que no coinciden
                con la fecha del cuadre original y pueden generar diferencias en el balance bancario.
              </p>
            </div>
          </div>
          {buscar && (
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
            </Button>
          )}
        </div>

        {/* Leyenda */}
        <div className="flex flex-wrap gap-2 text-xs">
          {Object.entries(TIPO_CONFIG).map(([tipo, cfg]) => (
            <span key={tipo} className={`px-2 py-1 rounded border ${cfg.badgeClass}`}>{cfg.label}</span>
          ))}
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Fecha pago desde</div>
                <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Fecha pago hasta</div>
                <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Banco</div>
                <Select value={banco} onValueChange={setBanco}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {(filtros?.bancos || []).map(b => (
                      <SelectItem key={b.id} value={b.name}>{b.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Método POS</div>
                <Select value={metodoPOS} onValueChange={setMetodoPOS}>
                  <SelectTrigger><SelectValue placeholder="Todos" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="todos">Todos</SelectItem>
                    {(filtros?.metodosPOS || []).map(m => (
                      <SelectItem key={m.id} value={m.name}>{m.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {tieneFechas && (
                <>
                  <div className="col-span-2">
                    <div className="text-xs text-muted-foreground mb-1">Usuario creador (opcional)</div>
                    <Input placeholder="ej. Yasibit, Juan..." value={usuario} onChange={e => setUsuario(e.target.value)} />
                  </div>
                  <div className="col-span-2 flex items-end">
                    <button
                      onClick={() => setSoloDestiempo(!soloDestiempo)}
                      className={`flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium w-full justify-center transition-colors
                        ${soloDestiempo ? "bg-amber-100 border-amber-400 text-amber-800" : "bg-background border-input text-muted-foreground hover:bg-muted"}`}
                    >
                      <AlertTriangle className="h-4 w-4" />
                      {soloDestiempo ? "Mostrando solo diferidos" : "Ver solo pagos diferidos"}
                    </button>
                  </div>
                </>
              )}

              <div className={`flex gap-2 items-end ${tieneFechas ? "col-span-4" : "col-span-2 md:col-span-4"}`}>
                <Button onClick={handleBuscar} className="flex-1">
                  <Search className="h-4 w-4 mr-1" /> Buscar
                </Button>
                <Button variant="outline" onClick={handleLimpiar}><X className="h-4 w-4" /></Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Resumen por tipo */}
        {data && !isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {(["saldo_favor_diferido", "diferido", "saldo_favor_ok", "mismo_dia"] as const).map(tipo => {
              const cfg = TIPO_CONFIG[tipo];
              const t   = porTipo[tipo] || { cantidad: 0, totalUSD: 0, totalBs: 0 };
              return (
                <Card key={tipo} className={tipo === "saldo_favor_diferido" ? "border-red-300" : tipo === "diferido" ? "border-amber-300" : ""}>
                  <CardContent className="pt-3 pb-3">
                    <div className={`text-xs font-medium mb-1 ${cfg.color}`}>{cfg.label}</div>
                    <div className={`text-2xl font-bold ${cfg.color}`}>{t.cantidad}</div>
                    <div className="text-xs mt-1">{fmtUSD(t.totalUSD)}</div>
                    <div className="text-xs text-orange-600">{fmtBs(t.totalBs)}</div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}

        {/* Tabla */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              {isLoading ? "Buscando en Odoo..." :
               buscar && data ? (
                 <>
                   {data.cantidad} registros — {fmtUSD(data.totalPagosUSD)} / {fmtBs(data.totalPagosBs)}
                   {(porTipo["saldo_favor_diferido"]?.cantidad || 0) > 0 && (
                     <Badge className="bg-red-100 text-red-700 border border-red-300 text-xs ml-1">
                       <AlertTriangle className="h-3 w-3 mr-1" />
                       {porTipo["saldo_favor_diferido"].cantidad} saldo_favor diferido
                     </Badge>
                   )}
                 </>
               ) : (
                 <span className="flex items-center gap-1 text-muted-foreground">
                   <Info className="h-4 w-4" /> Selecciona fechas y presiona Buscar
                 </span>
               )}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!buscar ? (
              <div className="p-10 text-center text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p>Selecciona un rango de fechas y presiona Buscar</p>
                <p className="text-xs mt-2 max-w-md mx-auto">
                  Los pagos en <span className="text-red-600 font-medium">rojo</span> son "Saldo a Favor" diferidos —
                  los más probables generadores de diferencias en el balance bancario.
                </p>
              </div>
            ) : isLoading ? (
              <div className="p-6 space-y-2">
                {[...Array(6)].map((_, i) => <div key={i} className="h-8 bg-muted animate-pulse rounded" />)}
              </div>
            ) : (error as any) || (data as any)?.error ? (
              <div className="p-6 text-center text-red-500">
                Error: {(data as any)?.error || "Error al cargar datos"}
              </div>
            ) : !data?.pagos?.length ? (
              <div className="p-6 text-center text-muted-foreground">
                No se encontraron pagos con los filtros seleccionados
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead className="border-b bg-muted/40 text-left">
                    <tr>
                      <th className="px-3 py-2 font-semibold" colSpan={5}>FACTURA POS</th>
                      <th className="px-3 py-2 font-semibold border-l" colSpan={2}>SESIÓN / CUADRE</th>
                      <th className="px-3 py-2 font-semibold border-l" colSpan={5}>PAGO CONTABLE</th>
                      <th className="px-3 py-2 font-semibold border-l text-center">ESTADO</th>
                    </tr>
                    <tr className="border-b text-muted-foreground">
                      <th className="px-3 py-2">Número</th>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Monto $</th>
                      <th className="px-3 py-2 text-right">Monto Bs</th>
                      <th className="px-3 py-2 border-l">Sesión POS</th>
                      <th className="px-3 py-2">Método POS</th>
                      <th className="px-3 py-2 border-l">Número</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Banco</th>
                      <th className="px-3 py-2 text-right">Pagado $</th>
                      <th className="px-3 py-2 text-right">Pagado Bs</th>
                      <th className="px-3 py-2">Usuario</th>
                      <th className="px-3 py-2 border-l text-center">Diferencia</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pagos.map((p, i) => {
                      const cfg = TIPO_CONFIG[p.tipoDiferimiento] || TIPO_CONFIG.mismo_dia;
                      return (
                        <tr key={`${p.facturaId}-${p.pagoId}-${i}`} className={`border-b ${cfg.rowClass}`}>
                          <td className="px-3 py-2 font-mono">{p.facturaNro}</td>
                          <td className="px-3 py-2">{p.cliente}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{p.facturaFecha}</td>
                          <td className="px-3 py-2 text-right">{fmtUSD(p.montoFacturaUSD)}</td>
                          <td className="px-3 py-2 text-right text-orange-700">{fmtBs(p.montoFacturaBs)}</td>
                          <td className="px-3 py-2 border-l text-muted-foreground text-xs">{p.sesionNombre || "—"}</td>
                          <td className="px-3 py-2">
                            <span className={p.tieneSaldoFavor ? "font-semibold text-blue-700" : ""}>
                              {p.metodosPOS}
                            </span>
                          </td>
                          <td className="px-3 py-2 border-l font-mono">{p.pagoNro}</td>
                          <td className="px-3 py-2 whitespace-nowrap">{p.pagoFecha}</td>
                          <td className="px-3 py-2">{p.pagoJournal}</td>
                          <td className="px-3 py-2 text-right text-green-700">{fmtUSD(p.montoPagoUSD)}</td>
                          <td className="px-3 py-2 text-right text-orange-700">{fmtBs(p.montoPagoBs)}</td>
                          <td className="px-3 py-2">{p.usuario}</td>
                          <td className="px-3 py-2 border-l text-center">
                            {p.mismodia ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                            ) : (
                              <Badge variant="outline" className={`text-xs ${cfg.badgeClass}`}>
                                <AlertTriangle className="h-3 w-3 mr-1" />+{p.diasDiferencia}d
                              </Badge>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="bg-muted/40 font-semibold border-t">
                    <tr>
                      <td colSpan={3} className="px-3 py-2">TOTAL ({data.cantidad})</td>
                      <td className="px-3 py-2 text-right">{fmtUSD(data.totalPagosUSD)}</td>
                      <td className="px-3 py-2 text-right text-orange-700">{fmtBs(data.totalPagosBs)}</td>
                      <td colSpan={5} />
                      <td className="px-3 py-2 text-right text-green-700">{fmtUSD(data.totalPagosUSD)}</td>
                      <td className="px-3 py-2 text-right text-orange-700">{fmtBs(data.totalPagosBs)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

      </div>
    </div>
  );
}
