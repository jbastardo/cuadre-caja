import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, formatUSD, getStatusLabel, formatDateTime } from "@/lib/utils";
import type { CuadreDetail, FiscalSummary, RetentionRow, CreditSaleRow, SaldoFavorRow } from "@shared/schema";
import { ArrowLeft, Printer } from "lucide-react";

// Method name display overrides (CASHEA companion methods have wrong names in Odoo)
const METHOD_NAME_OVERRIDES: Record<number, string> = {
  38: "P.Movil BNC",
  42: "PXC Cashea",
};

// Same IDs used in CuadreForm for filtering
const RETENCION_IVA_METHOD_ID = 26;
const CREDITO_METHOD_IDS = [14, 33];
const SALDO_FAVOR_METHOD_ID = 25;
const SECTION3_EXCLUDED_IDS = new Set([RETENCION_IVA_METHOD_ID, ...CREDITO_METHOD_IDS, SALDO_FAVOR_METHOD_ID]);

function isDeliveryOrDiferencia(name: string): boolean {
  const lower = name.toLowerCase();
  return lower.includes("delivery") || lower.includes("diferencia");
}

function getMethodDisplayName(methodId: number, methodName: string): string {
  return METHOD_NAME_OVERRIDES[methodId] || methodName;
}

function getPaymentStateLabel(state: string): string {
  if (state === "paid") return "Pagada";
  if (state === "partial") return "Parcial";
  return "Pendiente";
}

function getPaymentStateBadgeClass(state: string): string {
  if (state === "paid") return "bg-green-100 text-green-700";
  if (state === "partial") return "bg-yellow-100 text-yellow-700";
  return "bg-gray-100 text-gray-500";
}

export default function CuadreReport() {
  const [, params] = useRoute("/cuadre/:id/report");
  const [, setLocation] = useLocation();
  const id = params?.id;

  // FIXED: queryKey uses /api/cuadres/:id (with 's')
  const {
  data: cuadre,
  isLoading,
  error,
} = useQuery({
  queryKey: [`/api/cuadres/${id}`],
  enabled: !!id,
  staleTime: 0,
  refetchOnWindowFocus: true,
  refetchOnReconnect: true,
  queryFn: async () => {
    const response = await fetch(`/api/cuadres/${id}`, {
      method: "GET",
      credentials: "include",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `No se pudo obtener el cuadre (${response.status}) ${text || ""}`.trim()
      );
    }

    return response.json();
  },
});

  const rate = cuadre?.tasa || cuadre?.tasaDia || 1;

  // Calculamos totales para la sección 3 (Resumen de Métodos)
  const section3Methods = useMemo(() => {
    if (!cuadre?.metodos) return [];
    return cuadre.metodos.filter(m => !SECTION3_EXCLUDED_IDS.has(m.methodId));
  }, [cuadre?.metodos]);

  if (isLoading) return <div className="p-8 text-center">Cargando reporte...</div>;
  if (!cuadre) return <div className="p-8 text-center">Cuadre no encontrado</div>;

  return (
    <div className="min-h-screen bg-gray-100 pb-12 no-print">
      <div className="max-w-4xl mx-auto p-4 flex justify-between items-center">
        <Button variant="ghost" onClick={() => setLocation(`/cuadre/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Volver
        </Button>
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-2" /> Imprimir
        </Button>
      </div>

      <div className="max-w-4xl mx-auto bg-white shadow-lg p-8 print:shadow-none print:p-0" id="report-content">
        {/* Encabezado del Reporte */}
        <div className="flex justify-between items-start mb-6">
          <div>
            <h1 className="text-2xl font-bold uppercase">Cuadre de Caja</h1>
            <p className="text-sm text-muted-foreground">ID: {cuadre.id} | Estado: {getStatusLabel(cuadre.estado)}</p>
          </div>
          <div className="text-right">
            <p className="font-bold">{cuadre.caja}</p>
            <p className="text-sm">{formatDateTime(cuadre.fecha)}</p>
            <p className="text-sm font-medium">Tasa: {formatBs(rate)}</p>
          </div>
        </div>

        {/* 1. Resumen Fiscal */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">1. Resumen de Ventas (Fiscal)</h2>
        {cuadre.fiscalSummary ? (
          <div className="space-y-3 mb-6">
            {/* Info cajero y maquina */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-sm bg-gray-50 p-3 rounded">
              <div>
                <span className="text-muted-foreground text-xs block">Cajero</span>
                <span className="font-medium">{cuadre.cajero || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Serial Impresora</span>
                <span className="font-medium">{cuadre.serialMachine || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Reporte Z</span>
                <span className="font-medium">{cuadre.zNumero || "—"}</span>
              </div>
              <div>
                <span className="text-muted-foreground text-xs block">Diario Fiscal</span>
                <span className="font-medium">{cuadre.fiscalSummary.journalCode}</span>
              </div>
            </div>
            
            {/* Rango de facturas */}
            <div className="text-sm">
              <span className="text-muted-foreground">Facturas: </span>
              <span className="font-medium">{cuadre.fiscalSummary.firstInvoice || "—"}</span>
              {cuadre.fiscalSummary.firstInvoice !== cuadre.fiscalSummary.lastInvoice && (
                <span> - {cuadre.fiscalSummary.lastInvoice}</span>
              )}
              <span className="ml-3 text-muted-foreground">({cuadre.fiscalSummary.invoiceCount || 0} facturas)</span>
            </div>
            
            {/* Notas de credito si hay */}
            {cuadre.fiscalSummary.ncCount > 0 && (
              <div className="text-sm">
                <span className="text-muted-foreground">Notas de Crédito: </span>
                <span className="font-medium text-red-600">{cuadre.fiscalSummary.firstNC || "—"}</span>
                {cuadre.fiscalSummary.firstNC !== cuadre.fiscalSummary.lastNC && (
                  <span> - {cuadre.fiscalSummary.lastNC}</span>
                )}
                <span className="ml-3 text-muted-foreground">({cuadre.fiscalSummary.ncCount} NC)</span>
              </div>
            )}

            {/* Montos */}
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 mt-2 pt-2 border-t">
              <div className="flex justify-between text-sm">
                <span>Base Imponible (USD):</span>
                <span className="font-medium">{formatUSD(cuadre.fiscalSummary.totalUSD - cuadre.fiscalSummary.totalTaxUSD)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>IVA (USD):</span>
                <span className="font-medium">{formatUSD(cuadre.fiscalSummary.totalTaxUSD)}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-1 font-bold">
                <span>Total Ventas (USD):</span>
                <span>{formatUSD(cuadre.fiscalSummary.totalUSD)}</span>
              </div>
              <div className="flex justify-between text-sm border-t pt-1 font-bold">
                <span>Total Ventas (Bs):</span>
                <span>{formatBs(cuadre.fiscalSummary.totalVES)}</span>
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic mb-6">Sin resumen fiscal disponible</p>
        )}

        {/* 2. IGTF */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">2. IGTF Percibido</h2>
        <div className="flex justify-between text-sm mb-6">
          <span>Total IGTF (Bs):</span>
          <span className="font-medium">{formatBs(cuadre.igtfZ * rate)}</span>
        </div>

        {/* 3. Métodos de Pago */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">3. Resumen por Métodos de Pago</h2>
        <table className="w-full mb-6 border-collapse">
          <thead>
            <tr className="border-b bg-gray-50">
              <th className="text-left py-1 px-2 text-sm font-medium text-gray-500">Método</th>
              <th className="text-right py-1 px-2 text-sm font-medium text-gray-500">Monto (USD)</th>
              <th className="text-right py-1 px-2 text-sm font-medium text-gray-500">Monto (Bs)</th>
            </tr>
          </thead>
          <tbody>
            {section3Methods.map((m, i) => (
              <tr key={i} className="border-b">
                <td className="py-1 px-2 text-sm">{getMethodDisplayName(m.metodoId, m.metodoNombre)}</td>
                <td className="py-1 px-2 text-right text-sm">{formatUSD(m.montoPOS_USD)}</td>
                <td className="py-1 px-2 text-right text-sm">{formatBs(m.montoPOS_Bs)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* 4. Retenciones IVA */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">4. Retenciones IVA</h2>
        <div className="flex justify-between text-sm mb-6">
          <span>Total Retenciones (Bs):</span>
          <span className="font-medium">
            {formatBs((cuadre.retenciones?.reduce((sum, r) => sum + r.retentionAmount, 0) || 0) * rate)}
          </span>
        </div>

        {/* 5. Ventas a Crédito - Solo resumen de abonos y CXC pendientes */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">5. Ventas a Crédito (CxC)</h2>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="bg-gray-50 p-3 rounded">
            <p className="text-xs text-muted-foreground uppercase">Total Abonado</p>
            <p className="text-lg font-bold text-green-600">
              {formatBs((cuadre.creditSales?.reduce((sum, c) => sum + (c.abonoAmountBs > 0 ? c.abonoAmountBs : c.abonoAmount * rate), 0) || 0))}
            </p>
          </div>
          <div className="bg-gray-50 p-3 rounded">
            <p className="text-xs text-muted-foreground uppercase">CxC Pendiente</p>
            <p className="text-lg font-bold text-red-600">
              {formatBs((cuadre.creditSales?.filter(c => c.residual > 0).reduce((sum, c) => sum + c.residual * rate, 0) || 0))}
            </p>
          </div>
        </div>
        {/* Detalle solo de CXC pendientes */}
        {(cuadre.creditSales?.filter(c => c.residual > 0).length ?? 0) > 0 && (
          <div className="overflow-x-auto mb-6">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-gray-50">
                  <th className="text-left py-1 px-2 text-xs font-medium text-gray-500">Factura</th>
                  <th className="text-left py-1 px-2 text-xs font-medium text-gray-500">Cliente</th>
                  <th className="text-right py-1 px-2 text-xs font-medium text-gray-500">Total (Bs)</th>
                  <th className="text-right py-1 px-2 text-xs font-medium text-gray-500">Abono (Bs)</th>
                  <th className="text-right py-1 px-2 text-xs font-medium text-gray-500">Pendiente (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {cuadre.creditSales!.filter(c => c.residual > 0).map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="py-1 px-2 text-xs">{c.invoiceNumber}</td>
                    <td className="py-1 px-2 text-xs truncate max-w-[100px]">{c.partner}</td>
                    <td className="py-1 px-2 text-xs text-right">{formatBs(c.invoiceTotal * rate)}</td>
                    <td className="py-1 px-2 text-xs text-right">
                      {formatBs(c.abonoAmountBs > 0 ? c.abonoAmountBs : c.abonoAmount * rate)}
                    </td>
                    <td className="py-1 px-2 text-xs text-right font-medium text-red-600">
                      {formatBs(c.residual * rate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* 6. Saldos a Favor - Solo totales */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">6. Saldos a Favor</h2>
        <div className="flex justify-between text-sm mb-6">
          <span>Total Saldos a Favor (Bs):</span>
          <span className="font-medium text-amber-600">
            {formatBs((cuadre.saldosFavor?.reduce((sum, s) => sum + s.amountBs, 0) || 0))}
          </span>
        </div>

        {/* 7. Cuadre Final */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">7. Cuadre Final (Diferencia)</h2>
        <div className="grid grid-cols-2 gap-x-8 gap-y-1 mb-6">
          <div className="flex justify-between text-sm">
            <span>Total Recaudado Métodos (Bs):</span>
            <span className="font-medium">{formatBs(cuadre.totalMetodosReal)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Total Odoo (Bs):</span>
            <span className="font-medium">{formatBs(cuadre.totalOdooBs)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Total Deducciones (Bs):</span>
            <span className="font-medium">{formatBs(cuadre.totalDeducciones)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span>Saldos a Favor (Bs):</span>
            <span className="font-medium text-amber-600">{formatBs(cuadre.totalSaldoFavorPOS * rate)}</span>
          </div>
          <div className={`flex justify-between text-sm border-t pt-1 font-bold ${cuadre.diferencia < -1 ? "text-red-600" : cuadre.diferencia > 1 ? "text-green-600" : ""}`}>
            <span>Diferencia de Cuadre (Bs):</span>
            <span>{formatBs(cuadre.diferencia)}</span>
          </div>
        </div>

        {/* 9. Ajustes Manuales */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 mt-4 uppercase">9. Ajustes Manuales</h2>
        {cuadre.ajustesManuales && cuadre.ajustesManuales.length > 0 ? (
          <>
            <div className="grid gap-1 mb-2">
              {cuadre.ajustesManuales.map((a, i) => (
                <div key={i} className="flex justify-between text-sm border-b py-1 border-dotted">
                  <span>{a.descripcion || "Ajuste manual"}</span>
                  <span className="font-medium">{formatBs(a.monto)}</span>
                </div>
              ))}
            </div>
            <div className="text-right text-sm font-bold mt-2 mb-4">
              Total ajustes: {formatBs(cuadre.totalAjustesManuales)}
            </div>
          </>
        ) : (
          <p className="text-xs text-muted-foreground mb-4 italic">Sin ajustes manuales</p>
        )}

        {/* 10. Observaciones */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 mt-4 uppercase">10. Observaciones</h2>
        {cuadre.observaciones ? (
          <p className="mb-6 text-sm">{cuadre.observaciones}</p>
        ) : (
          <p className="text-xs text-muted-foreground mb-6 italic">Sin observaciones</p>
        )}

        {/* Footer para Firmas */}
        <div className="mt-12 grid grid-cols-2 gap-12 pt-4">
          <div className="text-center">
            <div className="border-b border-black mb-1 h-12"></div>
            <p className="text-xs font-bold uppercase">Cajero: {cuadre.cajero}</p>
          </div>
          <div className="text-center">
            <div className="border-b border-black mb-1 h-12"></div>
            <p className="text-xs font-bold uppercase">Supervisor</p>
          </div>
        </div>

        {cuadre.cerradoPor && (
          <p className="text-[10px] text-muted-foreground mt-8 text-center italic border-t pt-2">
            Cerrado por: {cuadre.cerradoPor} el {formatDateTime(cuadre.cerradoEn || "")}
          </p>
        )}
      </div>
    </div>
  );
}
