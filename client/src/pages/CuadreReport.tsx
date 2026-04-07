import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, formatUSD, getStatusLabel, formatDateTime } from "@/lib/utils";
import type { CuadreDetail, FiscalSummary, RetentionRow, CreditSaleRow } from "@shared/schema";
import { ArrowLeft, Printer } from "lucide-react";

const METHOD_NAME_OVERRIDES: Record<number, string> = {
  38: "P.Movil BNC",
  42: "PXC Cashea",
};

const RETENCION_IVA_METHOD_ID = 26;
const CREDITO_METHOD_IDS = [14, 33];
const SALDO_FAVOR_METHOD_ID = 25;
const SECTION3_EXCLUDED_IDS = new Set([RETENCION_IVA_METHOD_ID, ...CREDITO_METHOD_IDS, SALDO_FAVOR_METHOD_ID]);

function getMethodDisplayName(methodId: number, methodName: string): string {
  return METHOD_NAME_OVERRIDES[methodId] || methodName;
}

export default function CuadreReport() {
  const [, params] = useRoute("/cuadre/:id/report");
  const [, setLocation] = useLocation();
  const id = params?.id;

  const {
    data: cuadre,
    isLoading,
  } = useQuery({
    queryKey: [`/api/cuadres/${id}`],
    enabled: !!id,
    staleTime: 0,
    queryFn: async () => {
      const response = await fetch(`/api/cuadres/${id}`);
      if (!response.ok) throw new Error("Error al cargar cuadre");
      return response.json();
    },
  });

  const rate = cuadre?.tasaDia || 1;

  if (isLoading) return <div className="p-8 text-center">Cargando...</div>;
  if (!cuadre) return <div className="p-8 text-center">Cuadre no encontrado</div>;

  return (
    <div className="min-h-screen bg-gray-100">
      <div className="max-w-[210mm] mx-auto p-4 flex justify-between items-center no-print">
        <Button variant="ghost" size="sm" onClick={() => setLocation(`/cuadre/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
      </div>

      <div className="max-w-[210mm] mx-auto bg-white p-8 print:p-0" id="report-content" style={{ fontSize: '11px', lineHeight: '1.4' }}>
        {/* ENCABEZADO */}
        <div className="text-center mb-4 border-b-2 pb-2">
          <h1 className="text-2xl font-bold">CUADRE DE CAJA</h1>
          <p className="text-sm">{cuadre.caja} | Fecha: {cuadre.fecha} | Estado: {getStatusLabel(cuadre.estado)}</p>
          <p className="text-sm">Cajero: {cuadre.cajero} | Tasa: {formatBs(rate)}</p>
        </div>

        {/* 1. DATOS REPORTE Z */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">1. Resumen de Ventas (Fiscal)</h2>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div>Serial Impresora: {cuadre.serialMachine || cuadre.maquinaFiscal}</div>
            <div>Reporte Z: {cuadre.zNumero}</div>
            <div>Facturas: {cuadre.primeraFacturaZ} - {cuadre.ultimaFacturaZ}</div>
            <div>Notas Crédito: {cuadre.primeraNCZ || '-'} - {cuadre.ultimaNCZ || '-'}</div>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs font-medium">
            <div>Venta Bruta: {formatBs(cuadre.ventaBrutaZ)}</div>
            <div>Notas Crédito: {formatBs(cuadre.notasCreditoZ)}</div>
            <div>Venta Neta: {formatBs(cuadre.ventaNetaZ)}</div>
            <div>Base Imponible: {formatBs(cuadre.baseImponibleZ)}</div>
            <div>IVA: {formatBs(cuadre.ivaZ)}</div>
            <div>IGTF: {formatBs(cuadre.igtfZ)}</div>
          </div>
        </div>

        {/* 2. IGTF */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">2. IGTF Percibido</h2>
          <div className="text-xs">Total IGTF: {formatBs(cuadre.igtfZ * rate)}</div>
        </div>

        {/* 3. MÉTODOS DE PAGO */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">3. Resumen por Métodos de Pago</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left py-1">Método</th>
                <th className="text-right py-1">Monto POS (USD)</th>
                <th className="text-right py-1">Monto POS (Bs)</th>
                <th className="text-right py-1">Monto Real (Bs)</th>
              </tr>
            </thead>
            <tbody>
              {(cuadre.metodos || []).map((m: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="py-1">{getMethodDisplayName(m.metodoId, m.metodoNombre)}</td>
                  <td className="text-right py-1">{formatUSD(m.montoPOS_USD)}</td>
                  <td className="text-right py-1">{formatBs(m.montoPOS_Bs)}</td>
                  <td className="text-right py-1">{formatBs(m.montoReal_Bs || m.montoReal || m.montoPOS_Bs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 4. RETENCIONES IVA */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">4. Retenciones IVA</h2>
          <div className="text-xs">Total Retenciones POS: {formatBs(cuadre.totalRetencionesPOS * rate)} | Total Real: {formatBs(cuadre.totalRetencionesReal * rate)}</div>
          {cuadre.retencionesPorCobrar > 0 && (
            <div className="text-xs text-amber-600">Retenciones por cobrar: {formatBs(cuadre.retencionesPorCobrar * rate)}</div>
          )}
        </div>

        {/* 5. VENTAS A CRÉDITO */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">5. Ventas a Crédito (CxC)</h2>
          <div className="text-xs mb-2">
            <div>Total Crédito POS: {formatBs(cuadre.totalCreditoPOS * rate)} | Total Abonos: {formatBs(cuadre.totalAbonosReal * rate)} | CxC Pendiente: {formatBs(cuadre.totalCxCPendiente * rate)}</div>
            <div>Saldo a Favor: {formatBs(cuadre.totalSaldoFavorReal * rate)}</div>
          </div>
          {(cuadre.creditSales || []).length > 0 && (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-1">Factura</th>
                  <th className="text-left py-1">Cliente</th>
                  <th className="text-right py-1">Total (Bs)</th>
                  <th className="text-right py-1">Abono (Bs)</th>
                  <th className="text-right py-1">CxC (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {(cuadre.creditSales || []).map((c: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="py-1">{c.invoiceNumber}</td>
                    <td className="py-1">{c.partner}</td>
                    <td className="text-right py-1">{formatBs(c.invoiceTotal * rate)}</td>
                    <td className="text-right py-1">{c.abonoAmount > 0 ? formatBs(c.abonoAmount * rate) : '-'}</td>
                    <td className="text-right py-1">{c.residual > 0 ? formatBs(c.residual * rate) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 6. SALDOS A FAVOR */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">6. Saldos a Favor Generados</h2>
          <div className="text-xs">Total Saldo a Favor POS: {formatBs(cuadre.totalSaldoFavorPOS * rate)} | Total Real: {formatBs(cuadre.totalSaldoFavorReal * rate)}</div>
          {(cuadre.saldosFavor || []).length > 0 && (
            <table className="w-full text-xs mt-1">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left py-1">Factura</th>
                  <th className="text-left py-1">Cliente</th>
                  <th className="text-right py-1">Monto (USD)</th>
                </tr>
              </thead>
              <tbody>
                {(cuadre.saldosFavor || []).map((s: any, i: number) => (
                  <tr key={i} className="border-b">
                    <td className="py-1">{s.invoiceNumber}</td>
                    <td className="py-1">{s.partner}</td>
                    <td className="text-right py-1">{formatUSD(s.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 7. DEDUCCIONES */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">7. Deducciones</h2>
          <div className="text-xs">Total Deducciones: {formatBs(cuadre.totalDeducciones)}</div>
        </div>

        {/* 8. RESUMEN DEL CUADRE */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">8. Resumen del Cuadre</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="border p-2">
              <div className="font-bold border-b mb-1">SEGÚN ODOO POS</div>
              <div>Pagos directos: {formatBs(cuadre.totalMetodosReal)}</div>
              <div>Retenciones IVA: {formatBs(cuadre.totalRetencionesPOS * rate)}</div>
              <div>Ventas a crédito: {formatBs(cuadre.totalCreditoPOS * rate)}</div>
              <div>Saldos a favor: {formatBs(cuadre.totalSaldoFavorPOS * rate)}</div>
              {cuadre.totalDeducciones !== 0 && <div>Deducciones (Delivery/Dif.): {formatBs(cuadre.totalDeducciones)}</div>}
              <div className="font-bold border-t mt-1">TOTAL POS: {formatBs(cuadre.totalMetodosReal + cuadre.totalRetencionesPOS * rate + cuadre.totalCreditoPOS * rate + cuadre.totalSaldoFavorPOS * rate + cuadre.totalDeducciones)}</div>
            </div>
            <div className="border p-2">
              <div className="font-bold border-b mb-1">VERIFICADO REAL</div>
              <div>Pagos directos: {formatBs(cuadre.totalMetodosReal)}</div>
              <div>Retenciones registradas: {formatBs(cuadre.totalRetencionesReal * rate)}</div>
              {cuadre.retencionesPorCobrar > 0 && <div className="text-amber-600">Retenciones por cobrar: {formatBs(cuadre.retencionesPorCobrar * rate)}</div>}
              <div>Abonos crédito recibidos: {formatBs(cuadre.totalAbonosReal * rate)}</div>
              <div>CxC pendientes: {formatBs(cuadre.totalCxCPendiente * rate)}</div>
              <div>Saldos a favor: {formatBs(cuadre.totalSaldoFavorReal * rate)}</div>
              {cuadre.totalDeducciones !== 0 && <div>Deducciones (Delivery/Dif.): {formatBs(cuadre.totalDeducciones)}</div>}
              <div>Ajustes manuales: {formatBs(cuadre.totalAjustesManuales)}</div>
              <div className="font-bold border-t mt-1">TOTAL VERIFICADO: {formatBs(cuadre.totalMetodosReal + cuadre.totalRetencionesReal * rate + cuadre.totalAbonosReal * rate + cuadre.totalCxCPendiente * rate + cuadre.totalSaldoFavorReal * rate + cuadre.totalDeducciones + cuadre.totalAjustesManuales)}</div>
            </div>
          </div>
          <div className="text-xs mt-2 font-bold">Total Métodos + Deducciones (Bs): {formatBs(cuadre.totalMetodosReal + cuadre.totalDeducciones)}</div>
        </div>

        {/* DIFERENCIA */}
        <div className="mb-4 p-3 border rounded">
          <div className="text-sm font-bold mb-1">Venta Neta Z (Bs) — referencia fiscal:</div>
          <div className="text-lg font-bold">{formatBs(cuadre.ventaNetaZ)}</div>
          <div className="text-center mt-2">
            <div className="text-sm font-bold">Diferencia:</div>
            <div className={`text-lg font-bold ${Math.abs(cuadre.diferencia) < 0.01 ? 'text-green-600' : cuadre.diferencia > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatBs(cuadre.diferencia)}
            </div>
            <div className={`text-xs font-bold mt-1 ${Math.abs(cuadre.diferencia) < 0.01 ? 'bg-green-100' : 'bg-red-100'} inline-block px-2 py-1 rounded`}>
              {Math.abs(cuadre.diferencia) < 0.01 ? 'CUADRADO' : 'DESCUADRADO'}
            </div>
          </div>
          {cuadre.difCambiaria > 0 && <div className="text-xs mt-2">Dif. Cambiaria (info contabilidad): {formatBs(cuadre.difCambiaria)}</div>}
        </div>

        {/* 9. AJUSTES MANUALES */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">9. Ajustes Manuales</h2>
          {(cuadre.ajustesManuales || []).length > 0 ? (
            <div className="text-xs">
              {(cuadre.ajustesManuales || []).map((a: any, i: number) => (
                <div key={i} className="flex justify-between">
                  <span>{a.descripcion || 'Ajuste'}</span>
                  <span>{formatBs(a.monto)}</span>
                </div>
              ))}
              <div className="font-bold mt-1">Total: {formatBs(cuadre.totalAjustesManuales)}</div>
            </div>
          ) : (
            <div className="text-xs text-gray-500">Sin ajustes manuales</div>
          )}
        </div>

        {/* 10. OBSERVACIONES */}
        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">10. Observaciones</h2>
          <div className="text-xs">{cuadre.observaciones || 'Sin observaciones'}</div>
        </div>

        {/* FOOTER */}
        <div className="mt-8 pt-4 border-t flex justify-between">
          <div className="text-center">
            <div className="border-b w-48 mb-2 h-10"></div>
            <span className="text-xs font-bold">Cajero: {cuadre.cajero}</span>
          </div>
          <div className="text-center">
            <div className="border-b w-48 mb-2 h-10"></div>
            <span className="text-xs font-bold">Supervisor</span>
          </div>
        </div>

        {cuadre.cerradoPor && (
          <p className="text-[10px] text-center mt-4 text-gray-500">
            Cerrado por: {cuadre.cerradoPor} el {formatDateTime(cuadre.cerradoEn || '')}
          </p>
        )}
      </div>
    </div>
  );
}