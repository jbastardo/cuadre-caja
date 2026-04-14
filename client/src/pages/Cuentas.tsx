import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ArrowLeft, RefreshCw, Search, X } from "lucide-react";

interface PagoCredito {
  facturaId: number;
  facturaNro: string;
  facturaFecha: string;
  facturaJournal: string;
  montoFacturaUSD: number;
  montoFacturaBs: number;
  tasaFactura: number;
  saldoFacturaUSD: number;
  saldoFacturaBs: number;
  pagoId: number;
  pagoNro: string;
  pagoFecha: string;
  pagoJournal: string;
  montoPagoUSD: number;
  montoPagoBs: number;
  tasaPago: number;
  cliente: string;
  usuario: string;
}

interface PagosCreditoResponse {
  pagos: PagoCredito[];
  totalFacturasUSD: number;
  totalFacturasBs: number;
  totalPagosUSD: number;
  totalPagosBs: number;
  totalSaldoUSD: number;
  totalSaldoBs: number;
  cantidad: number;
}

function fmtUSD(n: number) {
  return new Intl.NumberFormat("es-VE", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n || 0);
}
function fmtBs(n: number) {
  return "Bs " + new Intl.NumberFormat("es-VE", { minimumFractionDigits: 2 }).format(n || 0);
}

export default function Cuentas() {
  const [, setLocation] = useLocation();
  const [fechaDesde, setFechaDesde] = useState("");
  const [fechaHasta, setFechaHasta] = useState("");
  const [usuario, setUsuario] = useState("Yasibit");
  const [metodoPago, setMetodoPago] = useState("");
  const [buscar, setBuscar] = useState(false);

  const buildParams = () => {
    const p = new URLSearchParams();
    if (fechaDesde) p.append("fechaDesde", fechaDesde);
    if (fechaHasta) p.append("fechaHasta", fechaHasta);
    if (usuario) p.append("usuario", usuario);
    if (metodoPago) p.append("metodoPago", metodoPago);
    return p.toString();
  };

  const { data, isLoading, refetch, error } = useQuery<PagosCreditoResponse>({
    queryKey: ["cuentas", "pagos-credito", fechaDesde, fechaHasta, usuario, metodoPago],
    queryFn: () => fetch(`/api/cuentas/pagos-credito?${buildParams()}`).then(r => r.json()),
    enabled: buscar,
  });

  const handleBuscar = () => { setBuscar(true); refetch(); };
  const handleLimpiar = () => {
    setFechaDesde(""); setFechaHasta(""); setUsuario("Yasibit"); setMetodoPago(""); setBuscar(false);
  };

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
              <h1 className="text-xl font-bold">Pagos a Crédito POS</h1>
              <p className="text-xs text-muted-foreground">Pagos contables registrados a facturas POS con método "Ventas a Crédito"</p>
            </div>
          </div>
          {buscar && (
            <Button variant="outline" size="sm" onClick={() => refetch()}>
              <RefreshCw className="h-4 w-4 mr-1" /> Actualizar
            </Button>
          )}
        </div>

        {/* Filtros */}
        <Card>
          <CardContent className="pt-4">
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <div className="text-xs text-muted-foreground mb-1">Fecha pago desde</div>
                <Input type="date" value={fechaDesde} onChange={e => setFechaDesde(e.target.value)} className="w-40" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Fecha pago hasta</div>
                <Input type="date" value={fechaHasta} onChange={e => setFechaHasta(e.target.value)} className="w-40" />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Usuario creador</div>
                <Input
                  placeholder="ej. Yasibit"
                  value={usuario}
                  onChange={e => setUsuario(e.target.value)}
                  className="w-44"
                />
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1">Banco / Método de pago</div>
                <Input
                  placeholder="ej. Banesco, BNC..."
                  value={metodoPago}
                  onChange={e => setMetodoPago(e.target.value)}
                  className="w-44"
                />
              </div>
              <Button onClick={handleBuscar} size="sm">
                <Search className="h-4 w-4 mr-1" /> Buscar
              </Button>
              <Button variant="ghost" size="sm" onClick={handleLimpiar}>
                <X className="h-4 w-4 mr-1" /> Limpiar
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Resumen totales */}
        {data && !isLoading && (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Total Facturas</div>
                <div className="text-lg font-bold">{fmtUSD(data.totalFacturasUSD)}</div>
                <div className="text-sm text-orange-600">{fmtBs(data.totalFacturasBs)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Total Pagado</div>
                <div className="text-lg font-bold text-green-600">{fmtUSD(data.totalPagosUSD)}</div>
                <div className="text-sm text-orange-600">{fmtBs(data.totalPagosBs)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4">
                <div className="text-xs text-muted-foreground">Saldo Pendiente</div>
                <div className="text-lg font-bold text-red-600">{fmtUSD(data.totalSaldoUSD)}</div>
                <div className="text-sm text-orange-600">{fmtBs(data.totalSaldoBs)}</div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* Tabla */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              {isLoading ? "Buscando..." : buscar ? `${data?.cantidad ?? 0} registros encontrados` : "Aplica filtros y presiona Buscar"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            {!buscar ? (
              <div className="p-10 text-center text-muted-foreground">
                <Search className="h-8 w-8 mx-auto mb-2 opacity-30" />
                Selecciona un rango de fechas y presiona Buscar
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
                      {/* Factura */}
                      <th className="px-3 py-2 border-r font-semibold" colSpan={6}>FACTURA (POS)</th>
                      {/* Pago */}
                      <th className="px-3 py-2 font-semibold" colSpan={5}>PAGO CONTABLE</th>
                    </tr>
                    <tr className="border-b">
                      <th className="px-3 py-2">Número</th>
                      <th className="px-3 py-2">Cliente</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2 text-right">Monto $</th>
                      <th className="px-3 py-2 text-right">Monto Bs</th>
                      <th className="px-3 py-2 text-right border-r">Saldo $</th>
                      <th className="px-3 py-2">Número</th>
                      <th className="px-3 py-2">Fecha</th>
                      <th className="px-3 py-2">Banco/Método</th>
                      <th className="px-3 py-2 text-right">Pagado $</th>
                      <th className="px-3 py-2 text-right">Pagado Bs</th>
                      <th className="px-3 py-2">Usuario</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.pagos.map((p, i) => (
                      <tr key={`${p.facturaId}-${p.pagoId}-${i}`} className="border-b hover:bg-muted/20">
                        <td className="px-3 py-2 font-mono">{p.facturaNro}</td>
                        <td className="px-3 py-2">{p.cliente}</td>
                        <td className="px-3 py-2">{p.facturaFecha}</td>
                        <td className="px-3 py-2 text-right">{fmtUSD(p.montoFacturaUSD)}</td>
                        <td className="px-3 py-2 text-right text-orange-600">{fmtBs(p.montoFacturaBs)}</td>
                        <td className="px-3 py-2 text-right border-r text-red-600">{fmtUSD(p.saldoFacturaUSD)}</td>
                        <td className="px-3 py-2 font-mono">{p.pagoNro}</td>
                        <td className="px-3 py-2">{p.pagoFecha}</td>
                        <td className="px-3 py-2">{p.pagoJournal}</td>
                        <td className="px-3 py-2 text-right text-green-600">{fmtUSD(p.montoPagoUSD)}</td>
                        <td className="px-3 py-2 text-right text-orange-600">{fmtBs(p.montoPagoBs)}</td>
                        <td className="px-3 py-2">{p.usuario}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/40 font-semibold border-t text-xs">
                    <tr>
                      <td colSpan={3} className="px-3 py-2">TOTAL ({data.cantidad} registros)</td>
                      <td className="px-3 py-2 text-right">{fmtUSD(data.totalFacturasUSD)}</td>
                      <td className="px-3 py-2 text-right text-orange-600">{fmtBs(data.totalFacturasBs)}</td>
                      <td className="px-3 py-2 text-right border-r text-red-600">{fmtUSD(data.totalSaldoUSD)}</td>
                      <td colSpan={3} />
                      <td className="px-3 py-2 text-right text-green-600">{fmtUSD(data.totalPagosUSD)}</td>
                      <td className="px-3 py-2 text-right text-orange-600">{fmtBs(data.totalPagosBs)}</td>
                      <td />
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
