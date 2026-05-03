import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, formatUSD, getStatusLabel, formatDateTime } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";

export default function CuadreReport() {
  const [, params] = useRoute("/cuadre/:id/report");
  const [, setLocation] = useLocation();
  const id = params?.id;

  const { data: cuadre, isLoading } = useQuery({
    queryKey: [`/api/cuadres/${id}`],
    enabled: !!id,
    staleTime: 0,
    queryFn: async () => {
      const response = await fetch(`/api/cuadres/${id}`);
      if (!response.ok) throw new Error("Error al cargar cuadre");
      return response.json();
    },
  });

  if (isLoading) return <div className="p-8 text-center">Cargando...</div>;
  if (!cuadre) return <div className="p-8 text-center">Cuadre no encontrado</div>;

  // Compute totals from saved metodos/deducciones/ajustes for reliability
  // This ensures old cuadres display correctly even if special total fields are missing
  const SECTION3_EXCLUDED = new Set([26, 35, 37, 38]); // retenciones, Bs methods
  const isDeliveryOrDif = (name: string) => /delivery|diferencia/i.test(name || "");
  const directMetodos = (cuadre.metodos || []).filter((m: any) => !SECTION3_EXCLUDED.has(m.metodoId) && !isDeliveryOrDif(m.metodoNombre));
  const deliveryDifMetodos = (cuadre.metodos || []).filter((m: any) => isDeliveryOrDif(m.metodoNombre));

  const computedDirectoPOS = Math.round(directMetodos.reduce((s: number, m: any) => s + (m.montoPOS_Bs || 0), 0) * 100) / 100;
  const computedAllMetodosPOS = Math.round((cuadre.metodos || []).reduce((s: number, m: any) => s + (m.montoPOS_Bs || 0), 0) * 100) / 100;
  const computedAllMetodosReal = Math.round((cuadre.metodos || []).reduce((s: number, m: any) => s + (m.montoReal || 0), 0) * 100) / 100;
  const computedDeliveryDifPOS = Math.round(deliveryDifMetodos.reduce((s: number, m: any) => s + (m.montoPOS_Bs || 0), 0) * 100) / 100;
  const computedDeducciones = Math.round((cuadre.deducciones || []).reduce((s: number, d: any) => s + (d.monto || 0), 0) * 100) / 100;
  const computedAjustes = Math.round((cuadre.ajustesManuales || []).reduce((s: number, a: any) => s + (a.monto || 0), 0) * 100) / 100;

  // Use saved totals if available, else compute from saved arrays
  const rDirectoPOS = cuadre.totalDirectoPOS ?? cuadre.totalMetodosReal ?? computedDirectoPOS;
  const rRetencionesPOS = cuadre.totalRetencionesPOS ?? 0;
  const rCreditoPOS = cuadre.totalCreditoPOS ?? 0;
  const rSaldoFavorPOS = cuadre.totalSaldoFavorPOS ?? 0;
  const rDeducciones = cuadre.totalDeducciones ?? computedDeducciones;
  const rTotalPOS = cuadre.totalMetodosPOS ?? computedAllMetodosPOS;

  const rMetodosReal = cuadre.totalMetodosReal ?? computedAllMetodosReal;
  const rRetencionesReal = cuadre.totalRetencionesReal ?? 0;
  const rRetencionesPorCobrar = cuadre.retencionesPorCobrar ?? 0;
  const rAbonosReal = cuadre.totalAbonosReal ?? 0;
  const rCxCPendiente = cuadre.totalCxCPendiente ?? 0;
  const rSaldoFavorReal = cuadre.totalSaldoFavorReal ?? 0;
  const rAjustesManuales = cuadre.totalAjustesManuales ?? computedAjustes;
  const rTotalVerificado = cuadre.totalJustificadoReal ??
    Math.round((rMetodosReal + rRetencionesReal + rRetencionesPorCobrar + rAbonosReal + rCxCPendiente + rSaldoFavorReal + rDeducciones + rAjustesManuales) * 100) / 100;
  const rDiferencia = cuadre.diferencia ?? 0;

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
        <div className="text-center mb-4 border-b-2 pb-2">
          <h1 className="text-2xl font-bold">CUADRE DE CAJA</h1>
          <p className="text-sm">{cuadre.caja} | Fecha: {cuadre.fecha} | Estado: {getStatusLabel(cuadre.estado)}</p>
          <p className="text-sm">Cajero: {cuadre.cajero}</p>
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">1. Resumen de Ventas (Fiscal)</h2>
          <div className="grid grid-cols-2 gap-2 text-xs mb-2">
            <div>Serial: {cuadre.serialMachine || cuadre.maquinaFiscal}</div>
            <div>Z: {cuadre.zNumero}</div>
            <div>Facturas: {cuadre.primeraFacturaZ} - {cuadre.ultimaFacturaZ}</div>
            <div>NC: {cuadre.primeraNCZ || '-'} - {cuadre.ultimaNCZ || '-'}</div>
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

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">2. IGTF Percibido</h2>
          <div className="text-xs">Total IGTF: {formatBs(cuadre.igtfZ)}</div>
        </div>

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
                  <td className="py-1">{m.metodoNombre}</td>
                  <td className="text-right py-1">{formatUSD(m.montoPOS_USD)}</td>
                  <td className="text-right py-1">{formatBs(m.montoPOS_Bs)}</td>
                  <td className="text-right py-1">{formatBs(m.montoReal_Bs || m.montoReal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">4. Retenciones IVA</h2>
          <div className="text-xs">Total POS: {formatBs(cuadre.totalRetencionesPOS)} | Total Real: {formatBs(cuadre.totalRetencionesReal)}</div>
          {cuadre.retencionesPorCobrar > 0 && <div className="text-xs text-amber-600">Por cobrar: {formatBs(cuadre.retencionesPorCobrar)}</div>}
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">5. Ventas a Crédito (CxC)</h2>
          <div className="text-xs mb-2">
            <div>Total Crédito: {formatBs(cuadre.totalCreditoPOS)} | Abonos: {formatBs(cuadre.totalAbonosReal)} | CxC Pendiente: {formatBs(cuadre.totalCxCPendiente)}</div>
            <div>Saldo a Favor: {formatBs(cuadre.totalSaldoFavorReal)}</div>
          </div>
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">6. Saldos a Favor Generados</h2>
          <div className="text-xs">Total POS: {formatBs(cuadre.totalSaldoFavorPOS)} | Total Real: {formatBs(cuadre.totalSaldoFavorReal)}</div>
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">7. Deducciones</h2>
          <div className="text-xs">Total: {formatBs(cuadre.totalDeducciones)}</div>
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">8. Resumen del Cuadre</h2>
          
          {/* SEGÚN ODOO POS - Lo que registró el sistema */}
          <div className="border p-2 mb-2 text-xs">
            <div className="font-bold border-b mb-1">SEGÚN ODOO POS (Lo que registró el sistema)</div>
            <div className="grid grid-cols-2 gap-1">
              <div>Pagos en efectivo/tarjetas:</div><div className="text-right">{formatBs(rDirectoPOS)}</div>
              <div>Retenciones IVA:</div><div className="text-right">{formatBs(rRetencionesPOS)}</div>
              <div>Ventas a crédito:</div><div className="text-right">{formatBs(rCreditoPOS)}</div>
              <div>Saldos a favor generados:</div><div className="text-right">{formatBs(rSaldoFavorPOS)}</div>
              {rDeducciones !== 0 && <><div>Delivery/Diferencias:</div><div className="text-right">{formatBs(rDeducciones)}</div></>}
            </div>
            <div className="font-bold border-t mt-1 pt-1 flex justify-between">
              <span>TOTAL VENTAS POS:</span>
              <span>{formatBs(rTotalPOS)}</span>
            </div>
          </div>

          {/* VERIFICADO REAL - Lo que realmente hubo */}
          <div className="border p-2 mb-2 text-xs">
            <div className="font-bold border-b mb-1">VERIFICADO REAL (Lo que realmente hubo)</div>
            <div className="grid grid-cols-2 gap-1">
              <div>Pagos directos recibidos:</div><div className="text-right">{formatBs(rMetodosReal)}</div>
              <div>Retenciones canceladas:</div><div className="text-right">{formatBs(rRetencionesReal)}</div>
              {rRetencionesPorCobrar > 0 && <><div>Retenciones por cobrar:</div><div className="text-right text-amber-600">{formatBs(rRetencionesPorCobrar)}</div></>}
              <div>Abonos a crédito recibidos:</div><div className="text-right">{formatBs(rAbonosReal)}</div>
              <div>CxC pendientes:</div><div className="text-right">{formatBs(rCxCPendiente)}</div>
              <div>Saldos a favor:</div><div className="text-right">{formatBs(rSaldoFavorReal)}</div>
              {rDeducciones !== 0 && <><div>Delivery/Diferencias:</div><div className="text-right">{formatBs(rDeducciones)}</div></>}
              {rAjustesManuales !== 0 && <><div>Ajustes manuales:</div><div className="text-right">{formatBs(rAjustesManuales)}</div></>}
            </div>
            <div className="font-bold border-t mt-1 pt-1 flex justify-between">
              <span>TOTAL VERIFICADO:</span>
              <span>{formatBs(rTotalVerificado)}</span>
            </div>
          </div>
        </div>

        <div className="mb-4 p-3 border rounded">
          <div className="text-sm font-bold mb-1">Venta Neta Z (Bs) — referencia fiscal:</div>
          <div className="text-lg font-bold">{formatBs(cuadre.ventaNetaZ)}</div>
          <div className="text-center mt-2">
            <div className="text-sm font-bold">Diferencia:</div>
            <div className={`text-lg font-bold ${rDiferencia === 0 ? 'text-green-600' : rDiferencia > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatBs(rDiferencia)}
            </div>
            <div className={`text-xs font-bold mt-1 ${Math.abs(rDiferencia) < 0.01 ? 'bg-green-100' : 'bg-red-100'} inline-block px-2 py-1 rounded`}>
              {Math.abs(rDiferencia) < 0.01 ? 'CUADRADO' : 'DESCUADRADO'}
            </div>
          </div>
          {cuadre.difCambiaria > 0 && <div className="text-xs mt-2">Dif. Cambiaria: {formatBs(cuadre.difCambiaria)}</div>}
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">9. Ajustes Manuales</h2>
          {(cuadre.ajustesManuales || []).length > 0 ? (
            <div className="text-xs">
              {(cuadre.ajustesManuales || []).map((a: any, i: number) => (
                <div key={i} className="flex justify-between"><span>{a.descripcion || 'Ajuste'}</span><span>{formatBs(a.monto)}</span></div>
              ))}
              <div className="font-bold mt-1">Total: {formatBs(rAjustesManuales)}</div>
            </div>
          ) : <div className="text-xs text-gray-500">Sin ajustes manuales</div>}
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">10. Observaciones</h2>
          <div className="text-xs">{cuadre.observaciones || 'Sin observaciones'}</div>
        </div>

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