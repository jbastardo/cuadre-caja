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
              <div>Pagos en efectivo/tarjetas:</div><div className="text-right">{formatBs(cuadre.totalDirectoPOS || cuadre.totalMetodosReal)}</div>
              <div>Retenciones IVA:</div><div className="text-right">{formatBs(cuadre.totalRetencionesPOS)}</div>
              <div>Ventas a crédito:</div><div className="text-right">{formatBs(cuadre.totalCreditoPOS)}</div>
              <div>Saldos a favor generados:</div><div className="text-right">{formatBs(cuadre.totalSaldoFavorPOS)}</div>
              {cuadre.totalDeducciones !== 0 && <><div>Delivery/Diferencias:</div><div className="text-right">{formatBs(cuadre.totalDeducciones)}</div></>}
            </div>
            <div className="font-bold border-t mt-1 pt-1 flex justify-between">
              <span>TOTAL VENTAS POS:</span>
              <span>{formatBs(cuadre.totalMetodosPOS || 
                (cuadre.totalDirectoPOS || cuadre.totalMetodosReal) + cuadre.totalRetencionesPOS + cuadre.totalCreditoPOS + cuadre.totalSaldoFavorPOS + cuadre.totalDeducciones)}</span>
            </div>
          </div>

          {/* VERIFICADO REAL - Lo que realmente hubo */}
          <div className="border p-2 mb-2 text-xs">
            <div className="font-bold border-b mb-1">VERIFICADO REAL (Lo que realmente hubo)</div>
            <div className="grid grid-cols-2 gap-1">
              <div>Pagos directos recibidos:</div><div className="text-right">{formatBs(cuadre.totalMetodosReal)}</div>
              <div>Retenciones canceladas:</div><div className="text-right">{formatBs(cuadre.totalRetencionesReal)}</div>
              {cuadre.retencionesPorCobrar > 0 && <><div>Retenciones por cobrar:</div><div className="text-right text-amber-600">{formatBs(cuadre.retencionesPorCobrar)}</div></>}
              <div>Abonos a crédito recibidos:</div><div className="text-right">{formatBs(cuadre.totalAbonosReal)}</div>
              <div>CxC pendientes:</div><div className="text-right">{formatBs(cuadre.totalCxCPendiente)}</div>
              <div>Saldos a favor:</div><div className="text-right">{formatBs(cuadre.totalSaldoFavorReal)}</div>
              {cuadre.totalDeducciones !== 0 && <><div>Delivery/Diferencias:</div><div className="text-right">{formatBs(cuadre.totalDeducciones)}</div></>}
              {cuadre.totalAjustesManuales !== 0 && <><div>Ajustes manuales:</div><div className="text-right">{formatBs(cuadre.totalAjustesManuales)}</div></>}
            </div>
            <div className="font-bold border-t mt-1 pt-1 flex justify-between">
              <span>TOTAL VERIFICADO:</span>
              <span>{formatBs(cuadre.totalJustificadoReal || 
                cuadre.totalMetodosReal + cuadre.totalRetencionesReal + cuadre.retencionesPorCobrar + 
                cuadre.totalAbonosReal + cuadre.totalCxCPendiente + cuadre.totalSaldoFavorReal + 
                cuadre.totalDeducciones + cuadre.totalAjustesManuales)}</span>
            </div>
          </div>
        </div>

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
          {cuadre.difCambiaria > 0 && <div className="text-xs mt-2">Dif. Cambiaria: {formatBs(cuadre.difCambiaria)}</div>}
        </div>

        <div className="mb-4">
          <h2 className="font-bold text-sm border-b mb-2">9. Ajustes Manuales</h2>
          {(cuadre.ajustesManuales || []).length > 0 ? (
            <div className="text-xs">
              {(cuadre.ajustesManuales || []).map((a: any, i: number) => (
                <div key={i} className="flex justify-between"><span>{a.descripcion || 'Ajuste'}</span><span>{formatBs(a.monto)}</span></div>
              ))}
              <div className="font-bold mt-1">Total: {formatBs(cuadre.totalAjustesManuales)}</div>
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