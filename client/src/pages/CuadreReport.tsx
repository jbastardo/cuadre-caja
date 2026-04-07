import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, formatUSD, getStatusLabel, formatDateTime } from "@/lib/utils";
import type { CuadreDetail, FiscalSummary, RetentionRow, CreditSaleRow } from "@shared/schema";
import { ArrowLeft, Printer } from "lucide-react";

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

      <div className="max-w-[210mm] mx-auto bg-white p-4 print:p-0" id="report-content" style={{ fontSize: '10px' }}>
        {/* Encabezado */}
        <div className="flex justify-between items-center mb-3 border-b pb-2">
          <div>
            <h1 className="text-lg font-bold uppercase">Cuadre de Caja</h1>
            <p className="text-xs">{cuadre.caja} - {cuadre.fecha}</p>
          </div>
          <div className="text-right text-xs">
            <p className="font-bold">Z: {cuadre.zNumero}</p>
            <p>{getStatusLabel(cuadre.estado)}</p>
            <p>Tasa: {formatBs(rate)}</p>
          </div>
        </div>

        {/* Sección 1: Datos del Reporte Z */}
        <div className="mb-3">
          <h2 className="font-bold text-xs border-b mb-1">1. DATOS REPORTE Z</h2>
          <div className="grid grid-cols-5 gap-1 text-xs">
            <div><span className="text-muted-foreground">Cajero:</span> {cuadre.cajero}</div>
            <div><span className="text-muted-foreground">Serial:</span> {cuadre.serialMachine || cuadre.maquinaFiscal}</div>
            <div><span className="text-muted-foreground">Facturas:</span> {cuadre.primeraFacturaZ} - {cuadre.ultimaFacturaZ}</div>
            <div><span className="text-muted-foreground">NC:</span> {cuadre.primeraNCZ || '-'} - {cuadre.ultimaNCZ || '-'}</div>
            <div><span className="text-muted-foreground">Venta Neta:</span> {formatBs(cuadre.ventaNetaZ)}</div>
          </div>
          <div className="grid grid-cols-4 gap-1 text-xs mt-1">
            <div><span className="text-muted-foreground">Venta Bruta:</span> {formatBs(cuadre.ventaBrutaZ)}</div>
            <div><span className="text-muted-foreground">Notas Crédito:</span> {formatBs(cuadre.notasCreditoZ)}</div>
            <div><span className="text-muted-foreground">Base Imponible:</span> {formatBs(cuadre.baseImponibleZ)}</div>
            <div><span className="text-muted-foreground">IVA:</span> {formatBs(cuadre.ivaZ)}</div>
            <div><span className="text-muted-foreground">IGTF:</span> {formatBs(cuadre.igtfZ)}</div>
            <div><span className="text-muted-foreground">Exento:</span> {formatBs(cuadre.exentoZ)}</div>
          </div>
        </div>

        {/* Sección 3: Métodos de Pago - Solo totales */}
        <div className="mb-3">
          <h2 className="font-bold text-xs border-b mb-1">3. MÉTODOS DE PAGO</h2>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div><span className="text-muted-foreground">Total POS:</span> {formatBs(cuadre.totalMetodosReal)}</div>
            <div><span className="text-muted-foreground">Retenciones:</span> {formatBs(cuadre.totalRetencionesReal * rate)}</div>
            <div><span className="text-muted-foreground">Ventas Crédito:</span> {formatBs(cuadre.totalCreditoPOS * rate)}</div>
          </div>
        </div>

        {/* Sección 5: CxC - Resumen */}
        <div className="mb-3">
          <h2 className="font-bold text-xs border-b mb-1">5. VENTAS A CRÉDITO (CxC)</h2>
          <div className="grid grid-cols-4 gap-2 text-xs">
            <div><span className="text-muted-foreground">Total:</span> {formatBs(cuadre.totalCreditoPOS * rate)}</div>
            <div><span className="text-muted-foreground">Abonos:</span> {formatBs(cuadre.totalAbonosReal * rate)}</div>
            <div><span className="text-muted-foreground">CxC Pendiente:</span> {formatBs(cuadre.totalCxCPendiente * rate)}</div>
            <div><span className="text-muted-foreground">Saldo Fav:</span> {formatBs(cuadre.totalSaldoFavorReal * rate)}</div>
          </div>
        </div>

        {/* Sección 8: Resumen del Cuadre */}
        <div className="mb-3">
          <h2 className="font-bold text-xs border-b mb-1">8. RESUMEN DEL CUADRE</h2>
          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="border p-1">
              <div className="font-bold border-b mb-1">SEGÚN ODOO POS</div>
              <div className="flex justify-between"><span>Pagos:</span><span>{formatBs(cuadre.totalMetodosReal)}</span></div>
              <div className="flex justify-between"><span>Retenciones:</span><span>{formatBs(cuadre.totalRetencionesPOS * rate)}</span></div>
              <div className="flex justify-between"><span>Crédito:</span><span>{formatBs(cuadre.totalCreditoPOS * rate)}</span></div>
              <div className="flex justify-between"><span>Saldo Fav:</span><span>{formatBs(cuadre.totalSaldoFavorPOS * rate)}</span></div>
              <div className="flex justify-between"><span>Deducciones:</span><span>{formatBs(cuadre.totalDeducciones)}</span></div>
              <div className="flex justify-between font-bold border-t"><span>TOTAL:</span><span>{formatBs(cuadre.totalMetodosReal + cuadre.totalRetencionesPOS * rate + cuadre.totalCreditoPOS * rate + cuadre.totalSaldoFavorPOS * rate + cuadre.totalDeducciones)}</span></div>
            </div>
            <div className="border p-1">
              <div className="font-bold border-b mb-1">VERIFICADO REAL</div>
              <div className="flex justify-between"><span>Pagos:</span><span>{formatBs(cuadre.totalMetodosReal)}</span></div>
              <div className="flex justify-between"><span>Retenc. Reg:</span><span>{formatBs(cuadre.totalRetencionesReal * rate)}</span></div>
              <div className="flex justify-between"><span>Abonos:</span><span>{formatBs(cuadre.totalAbonosReal * rate)}</span></div>
              <div className="flex justify-between"><span>CxC Pend:</span><span>{formatBs(cuadre.totalCxCPendiente * rate)}</span></div>
              <div className="flex justify-between"><span>Saldo Fav:</span><span>{formatBs(cuadre.totalSaldoFavorReal * rate)}</span></div>
              <div className="flex justify-between"><span>Deducc:</span><span>{formatBs(cuadre.totalDeducciones)}</span></div>
              <div className="flex justify-between"><span>Ajustes:</span><span>{formatBs(cuadre.totalAjustesManuales)}</span></div>
              <div className="flex justify-between font-bold border-t"><span>TOTAL:</span><span>{formatBs(cuadre.totalMetodosReal + cuadre.totalRetencionesReal * rate + cuadre.totalAbonosReal * rate + cuadre.totalCxCPendiente * rate + cuadre.totalSaldoFavorReal * rate + cuadre.totalDeducciones + cuadre.totalAjustesManuales)}</span></div>
            </div>
          </div>
        </div>

        {/* Diferencia */}
        <div className="mb-3 text-center">
          <span className={`font-bold text-sm px-4 py-1 ${Math.abs(cuadre.diferencia) < 1 ? 'bg-green-100' : cuadre.diferencia > 0 ? 'bg-green-100' : 'bg-red-100'}`}>
            DIFERENCIA: {formatBs(cuadre.diferencia)}
          </span>
        </div>

        {/* Observaciones */}
        {cuadre.observaciones && (
          <div className="mb-3">
            <h2 className="font-bold text-xs border-b mb-1">OBSERVACIONES</h2>
            <p className="text-xs">{cuadre.observaciones}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-4 pt-2 border-t flex justify-between text-xs">
          <div className="text-center">
            <div className="border-b w-32 mb-1"></div>
            <span>Cajero: {cuadre.cajero}</span>
          </div>
          <div className="text-center">
            <div className="border-b w-32 mb-1"></div>
            <span>Supervisor</span>
          </div>
        </div>
        
        {cuadre.cerradoPor && (
          <p className="text-[8px] text-center mt-2 text-muted-foreground">
            Cerrado por: {cuadre.cerradoPor} el {formatDateTime(cuadre.cerradoEn || "")}
          </p>
        )}
      </div>
    </div>
  );
}