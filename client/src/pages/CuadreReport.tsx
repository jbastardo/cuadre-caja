import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, getStatusLabel, formatDateTime } from "@/lib/utils";
import type { CuadreDetail } from "@shared/schema";
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

  const section3Methods = useMemo(() => {
    if (!cuadre?.metodos) return [];
    return cuadre.metodos.filter((m: any) => !SECTION3_EXCLUDED_IDS.has(m.methodId));
  }, [cuadre?.metodos]);

  // Calculate totals from metodos array directly
  const totalPOS_Pagos = useMemo(() => {
    if (!cuadre?.metodos) return 0;
    return cuadre.metodos
      .filter((m: any) => !SECTION3_EXCLUDED_IDS.has(m.methodId))
      .reduce((sum: number, m: any) => sum + (m.montoPOS_Bs || 0), 0);
  }, [cuadre?.metodos]);

  const totalReal_Pagos = useMemo(() => {
    if (!cuadre?.metodos) return 0;
    return cuadre.metodos
      .filter((m: any) => !SECTION3_EXCLUDED_IDS.has(m.methodId))
      .reduce((sum: number, m: any) => sum + (m.montoReal_Bs || m.montoReal || 0), 0);
  }, [cuadre?.metodos]);

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

      <div className="max-w-[210mm] mx-auto bg-white p-6 print:p-0" id="report-content" style={{ fontSize: '9px', lineHeight: '1.3' }}>
        {/* Encabezado */}
        <div className="flex justify-between items-center mb-4 border-b-2 pb-2">
          <div>
            <h1 className="text-xl font-bold uppercase">Cuadre de Caja</h1>
            <p className="text-sm">{cuadre.caja} | {cuadre.fecha} | Estado: {getStatusLabel(cuadre.estado)}</p>
          </div>
          <div className="text-right text-sm">
            <p className="font-bold">Tasa: {formatBs(rate)}</p>
            <p>Cajero: {cuadre.cajero}</p>
          </div>
        </div>

        {/* 1. DATOS REPORTE Z - Completo */}
        <div className="mb-4 border-b pb-2">
          <h2 className="font-bold text-sm border-b mb-2">1. DATOS DEL REPORTE Z</h2>
          <div className="grid grid-cols-4 gap-2 text-xs mb-2">
            <div><span className="text-muted-foreground">Serial:</span> {cuadre.serialMachine || cuadre.maquinaFiscal}</div>
            <div><span className="text-muted-foreground">Z:</span> {cuadre.zNumero}</div>
            <div><span className="text-muted-foreground">Facturas:</span> {cuadre.primeraFacturaZ} - {cuadre.ultimaFacturaZ}</div>
            <div><span className="text-muted-foreground">NC:</span> {cuadre.primeraNCZ || '-'} - {cuadre.ultimaNCZ || '-'}</div>
          </div>
          <div className="grid grid-cols-6 gap-2 text-xs font-medium">
            <div>V.Bruta: {formatBs(cuadre.ventaBrutaZ)}</div>
            <div>N.Crédito: {formatBs(cuadre.notasCreditoZ)}</div>
            <div>V.Neta: {formatBs(cuadre.ventaNetaZ)}</div>
            <div>Base Imp: {formatBs(cuadre.baseImponibleZ)}</div>
            <div>IVA: {formatBs(cuadre.ivaZ)}</div>
            <div>IGTF: {formatBs(cuadre.igtfZ)}</div>
          </div>
        </div>

        {/* 3. MÉTODOS DE PAGO - Completo */}
        <div className="mb-4 border-b pb-2">
          <h2 className="font-bold text-sm border-b mb-2">3. MÉTODOS DE PAGO (Bs)</h2>
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-gray-50">
                <th className="text-left py-1">Método</th>
                <th className="text-right py-1">POS</th>
                <th className="text-right py-1">Real</th>
              </tr>
            </thead>
            <tbody>
              {section3Methods.map((m: any, i: number) => (
                <tr key={i} className="border-b">
                  <td className="py-1">{getMethodDisplayName(m.metodoId, m.metodoNombre)}</td>
                  <td className="text-right py-1">{formatBs(m.montoPOS_Bs)}</td>
                  <td className="text-right py-1">{formatBs(m.montoReal_Bs || m.montoReal || m.montoPOS_Bs)}</td>
                </tr>
              ))}
              <tr className="font-bold bg-gray-50">
                <td className="py-1">TOTAL</td>
                <td className="text-right py-1">{formatBs(totalPOS_Pagos)}</td>
                <td className="text-right py-1">{formatBs(totalReal_Pagos)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* 4. RETENCIONES IVA - Total */}
        <div className="mb-4 border-b pb-2">
          <h2 className="font-bold text-sm border-b mb-2">4. RETENCIONES IVA</h2>
          <div className="text-xs flex justify-between">
            <span>Total Retenciones:</span>
            <span className="font-bold">{formatBs(cuadre.totalRetencionesReal)}</span>
            {cuadre.retencionesPorCobrar > 0 && (
              <span className="text-amber-600">| Por cobrar: {formatBs(cuadre.retencionesPorCobrar)}</span>
            )}
          </div>
        </div>

        {/* 5. VENTAS A CRÉDITO - Resumen + Detalle */}
        <div className="mb-4 border-b pb-2">
          <h2 className="font-bold text-sm border-b mb-2">5. VENTAS A CRÉDITO (CxC)</h2>
          <div className="grid grid-cols-4 gap-2 text-xs mb-2">
            <div><span className="text-muted-foreground">Total Crédito:</span> {formatBs(cuadre.totalCreditoPOS)}</div>
            <div><span className="text-muted-foreground">Abonos:</span> <span className="text-green-700">{formatBs(cuadre.totalAbonosReal)}</span></div>
            <div><span className="text-muted-foreground">CxC Pendiente:</span> <span className="text-amber-700">{formatBs(cuadre.totalCxCPendiente)}</span></div>
            <div><span className="text-muted-foreground">Saldo a Favor:</span> {formatBs(cuadre.totalSaldoFavorReal)}</div>
          </div>
          {/* Detalle CxC Pendientes */}
          {cuadre.creditSales && cuadre.creditSales.filter((c: any) => c.residual > 0).length > 0 && (
            <div className="mt-2 text-xs">
              <span className="font-medium">Detalle CxC Pendientes:</span>
              <div className="grid grid-cols-1 gap-1 mt-1">
                {cuadre.creditSales.filter((c: any) => c.residual > 0).map((c: any, i: number) => (
                  <div key={i} className="flex justify-between">
                    <span>{c.invoiceNumber} — {c.partner}</span>
                    <span className="text-amber-700">{formatBs(c.residual * rate)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 8. RESUMEN DEL CUADRE - EXACTO como formulario sin recalcular */}
        <div className="mb-4 border-b pb-2">
          <h2 className="font-bold text-sm border-b mb-2">8. RESUMEN DEL CUADRE</h2>
          <div className="grid grid-cols-2 gap-4 text-xs">
            <div className="border p-2">
              <div className="font-bold border-b mb-2">SEGÚN ODOO POS</div>
              <div className="flex justify-between"><span>Pagos directos:</span><span>{formatBs(totalPOS_Pagos)}</span></div>
              <div className="flex justify-between"><span>Retenciones IVA:</span><span>{formatBs(cuadre.totalRetencionesPOS)}</span></div>
              <div className="flex justify-between"><span>Ventas a crédito:</span><span>{formatBs(cuadre.totalCreditoPOS)}</span></div>
              <div className="flex justify-between"><span>Saldos a favor:</span><span>{formatBs(cuadre.totalSaldoFavorPOS)}</span></div>
              {cuadre.totalDeducciones !== 0 && (
                <div className="flex justify-between"><span>Deducciones (Delivery/Dif.):</span><span>{formatBs(cuadre.totalDeducciones)}</span></div>
              )}
              <div className="flex justify-between font-bold border-t mt-1 pt-1">
                <span>TOTAL POS:</span>
                <span>{formatBs(cuadre.totalMetodosReal)}</span>
              </div>
            </div>
            <div className="border p-2">
              <div className="font-bold border-b mb-2">VERIFICADO REAL</div>
              <div className="flex justify-between"><span>Pagos directos:</span><span>{formatBs(totalReal_Pagos)}</span></div>
              <div className="flex justify-between"><span>Retenciones registradas:</span><span>{formatBs(cuadre.totalRetencionesReal)}</span></div>
              {cuadre.retencionesPorCobrar > 0 && (
                <div className="flex justify-between text-amber-600"><span>Retenciones por cobrar:</span><span>{formatBs(cuadre.retencionesPorCobrar)}</span></div>
              )}
              <div className="flex justify-between text-green-700"><span>Abonos crédito recibidos:</span><span>{formatBs(cuadre.totalAbonosReal)}</span></div>
              <div className="flex justify-between text-amber-700"><span>CxC pendientes:</span><span>{formatBs(cuadre.totalCxCPendiente)}</span></div>
              <div className="flex justify-between"><span>Saldos a favor:</span><span>{formatBs(cuadre.totalSaldoFavorReal)}</span></div>
              {cuadre.totalDeducciones !== 0 && (
                <div className="flex justify-between"><span>Deducciones (Delivery/Dif.):</span><span>{formatBs(cuadre.totalDeducciones)}</span></div>
              )}
              <div className="flex justify-between"><span>Ajustes manuales:</span><span>{formatBs(cuadre.totalAjustesManuales)}</span></div>
              <div className="flex justify-between font-bold border-t mt-1 pt-1">
                <span>TOTAL VERIFICADO:</span>
                <span>{formatBs(cuadre.totalJustificado)}</span>
              </div>
            </div>
          </div>
          
          {/* Total Métodos + Deducciones */}
          <div className="mt-3 text-xs border-t pt-2">
            <div className="flex justify-between font-bold">
              <span>Total Métodos + Deducciones (Bs):</span>
              <span>{formatBs(cuadre.totalJustificado)}</span>
            </div>
          </div>
        </div>

        {/* Diferencia - Exacta como formulario */}
        <div className="mb-4 border-b pb-2">
          <div className="bg-blue-50 p-3 rounded">
            <div className="text-sm font-bold mb-1">Venta Neta Z (Bs) — referencia fiscal:</div>
            <div className="text-lg font-bold">{formatBs(cuadre.ventaNetaZ)}</div>
          </div>
          <div className="mt-2 text-center">
            <div className="text-sm font-bold">Diferencia:</div>
            <div className={`text-lg font-bold ${Math.abs(cuadre.diferencia) < 0.01 ? 'text-green-600' : cuadre.diferencia > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatBs(cuadre.diferencia)}
            </div>
            <div className={`text-xs font-bold mt-1 ${Math.abs(cuadre.diferencia) < 0.01 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'} inline-block px-2 py-1 rounded`}>
              {Math.abs(cuadre.diferencia) < 0.01 ? 'CUADRADO' : 'DESCUADRADO'}
            </div>
          </div>
          {cuadre.diferencia !== 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              {cuadre.diferencia > 0 ? (
                <p><strong>¿Qué significa esta diferencia?</strong></p>
              ) : (
                <p><strong>¿Qué significa esta diferencia?</strong></p>
              )}
              {cuadre.diferencia > 0 ? (
                <p>Sobra dinero (Bs {formatBs(cuadre.diferencia)}): Se justificó más de lo reportado en Z.</p>
              ) : (
                <p>Falta dinero (Bs {formatBs(Math.abs(cuadre.diferencia))}): Se justificó menos de lo reportado en Z.</p>
              )}
              <p className="mt-1">Posibles causas: pago duplicado, cobro no facturado, monto de método verificado mayor al real, o abono registrado que no corresponde al día.</p>
              <p className="mt-1">Use la sección "Ajustes y Excepciones" para registrar diferencias que no se pueden conciliar automáticamente.</p>
            </div>
          )}
          {cuadre.difCambiaria > 0 && (
            <div className="mt-2 text-xs text-muted-foreground">
              <span>Dif. Cambiaria (info contabilidad): {formatBs(cuadre.difCambiaria)}</span>
            </div>
          )}
        </div>

        {/* Observaciones */}
        {cuadre.observaciones && (
          <div className="mb-4">
            <h2 className="font-bold text-sm border-b mb-2">OBSERVACIONES</h2>
            <p className="text-xs">{cuadre.observaciones}</p>
          </div>
        )}

        {/* Footer */}
        <div className="mt-6 pt-4 border-t flex justify-between">
          <div className="text-center">
            <div className="border-b w-40 mb-2 h-8"></div>
            <span className="text-xs font-bold">Cajero: {cuadre.cajero}</span>
          </div>
          <div className="text-center">
            <div className="border-b w-40 mb-2 h-8"></div>
            <span className="text-xs font-bold">Supervisor</span>
          </div>
        </div>
        
        {cuadre.cerradoPor && (
          <p className="text-[8px] text-center mt-4 text-muted-foreground">
            Cerrado por: {cuadre.cerradoPor} el {formatDateTime(cuadre.cerradoEn || "")}
          </p>
        )}
      </div>
    </div>
  );
}