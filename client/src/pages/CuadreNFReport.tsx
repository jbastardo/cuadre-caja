import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatUSD, formatDateTime } from "@/lib/utils";
import type { NonFiscalSummary } from "@shared/schema";
import { ArrowLeft, Printer } from "lucide-react";

const METHOD_NAME_OVERRIDES: Record<number, string> = {
  38: "P.Movil BNC",
  42: "PXC Cashea",
};

function getMethodDisplayName(methodId: number, methodName: string): string {
  return METHOD_NAME_OVERRIDES[methodId] || methodName;
}

export default function CuadreNFReport() {
  const [, navigate] = useLocation();

  function getSessionIdFromUrl(): number {
    const hashParts = window.location.hash.split("?");
    if (hashParts[1]) {
      const params = new URLSearchParams(hashParts[1]);
      const id = params.get("sessionId");
      if (id) return Number(id);
    }
    const fallbackParams = new URLSearchParams(window.location.search);
    const id = fallbackParams.get("sessionId");
    if (id) return Number(id);
    return 0;
  }

  const sessionId = getSessionIdFromUrl();

  const { data: session } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${sessionId}`);
      if (!res.ok) throw new Error("Sesion no encontrada");
      return res.json();
    },
    enabled: !!sessionId,
  });

  const { data: nonFiscalSummary, isLoading } = useQuery<NonFiscalSummary>({
    queryKey: ["non-fiscal", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${sessionId}/non-fiscal`);
      if (!res.ok) return { receiptCount: 0, totalUSD: 0, payments: [], creditSales: [], totalCreditUSD: 0 };
      return res.json();
    },
    enabled: !!sessionId,
  });

  // Get cuadre for observations
  const { data: cuadre } = useQuery<any>({
    queryKey: ["cuadre-for-nf", sessionId],
    queryFn: async () => {
      // First get session date
      const sRes = await fetch(`/api/odoo/session/${sessionId}`);
      if (!sRes.ok) return null;
      const sess = await sRes.json();
      const date = (sess.start_at || "").split(" ")[0];
      if (!date) return null;
      // Find cuadre for this session
      const cRes = await fetch(`/api/cuadres?fecha=${date}`);
      if (!cRes.ok) return null;
      const cData = await cRes.json();
      const cuadres = Array.isArray(cData) ? cData : (cData.data || []);
      return cuadres.find((c: any) => c.sessionId === sessionId) || null;
    },
    enabled: !!sessionId,
  });

  const fecha = session?.start_at?.split(" ")[0] || "";

  if (isLoading) return <div className="min-h-screen flex items-center justify-center"><p>Cargando...</p></div>;
  if (!nonFiscalSummary || nonFiscalSummary.receiptCount === 0) {
    return (
      <div className="min-h-screen bg-white p-6">
        <Button variant="outline" size="sm" onClick={() => navigate(`/cuadre-nf?sessionId=${sessionId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <p className="mt-4 text-muted-foreground">Sin operaciones no fiscales en esta sesion.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white">
      {/* Print toolbar */}
      <div className="no-print bg-gray-100 border-b p-3 flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={() => navigate(`/cuadre-nf?sessionId=${sessionId}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
      </div>

      <div className="max-w-3xl mx-auto p-6 text-sm">
        {/* Header */}
        <div className="text-center border-b pb-4 mb-4">
          <h1 className="text-xl font-bold text-[#0A4083]">REPORTE NO FISCAL (RECIBOS)</h1>
          <p className="text-xs text-muted-foreground">Global It System, C.A. — ONPROTEC</p>
        </div>

        {/* Session info */}
        <div className="grid grid-cols-2 gap-1 text-xs mb-4">
          <div><strong>Fecha:</strong> {fecha}</div>
          <div><strong>Caja:</strong> {session?.config_id?.[1] || "—"}</div>
          <div><strong>Cajero:</strong> {session?.user_id?.[1] || "—"}</div>
          <div><strong>Sesion:</strong> {session?.name || "—"}</div>
        </div>

        {/* Summary */}
        <h2 className="font-bold text-base border-b pb-1 mb-2 mt-4">Resumen</h2>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div>Recibos: <strong>{nonFiscalSummary.receiptCount}</strong></div>
          <div>Total vendido: <strong className="text-purple-800">{formatUSD(nonFiscalSummary.totalUSD)}</strong></div>
          {nonFiscalSummary.totalCreditUSD > 0 && (
            <div>Credito NF: <strong className="text-amber-700">{formatUSD(nonFiscalSummary.totalCreditUSD)}</strong></div>
          )}
        </div>

        {/* Payment methods breakdown */}
        {nonFiscalSummary.payments.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Desglose por Metodo de Pago</p>
            <table className="w-full border-collapse mb-1">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Metodo</th>
                  <th className="text-right py-1">Ops.</th>
                  <th className="text-right py-1">Total (USD)</th>
                </tr>
              </thead>
              <tbody>
                {nonFiscalSummary.payments.map((p) => (
                  <tr key={p.methodId} className="border-b">
                    <td className="py-1">{getMethodDisplayName(p.methodId, p.methodName)}</td>
                    <td className="py-1 text-right text-muted-foreground">{p.count}</td>
                    <td className="py-1 text-right">{formatUSD(p.totalUSD)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-bold">
                  <td className="py-1">TOTAL</td>
                  <td className="py-1 text-right">{nonFiscalSummary.payments.reduce((s, p) => s + p.count, 0)}</td>
                  <td className="py-1 text-right">{formatUSD(nonFiscalSummary.payments.reduce((s, p) => s + p.totalUSD, 0))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* NF Credit sales */}
        {nonFiscalSummary.creditSales.length > 0 && (
          <div className="mb-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Ventas a Credito NF</p>
            <table className="w-full border-collapse mb-1">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-1">Orden</th>
                  <th className="text-left py-1">Cliente</th>
                  <th className="text-right py-1">Monto (USD)</th>
                </tr>
              </thead>
              <tbody>
                {nonFiscalSummary.creditSales.map((c) => (
                  <tr key={c.orderName} className="border-b bg-amber-50">
                    <td className="py-1">{c.orderName}</td>
                    <td className="py-1">{c.partner || "—"}</td>
                    <td className="py-1 text-right">{formatUSD(c.amountUSD)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 font-bold">
                  <td className="py-1" colSpan={2}>TOTAL CREDITO NF</td>
                  <td className="py-1 text-right">{formatUSD(nonFiscalSummary.totalCreditUSD)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Observaciones */}
        <div className="mt-4 pt-2 border-t">
          <h2 className="font-bold text-base border-b pb-1 mb-2 uppercase">Observaciones</h2>
          {cuadre?.observaciones ? (
            <p className="text-sm whitespace-pre-wrap">{cuadre.observaciones}</p>
          ) : (
            <p className="text-xs text-muted-foreground italic">Sin observaciones</p>
          )}
        </div>

        {/* Footer */}
        <div className="mt-8 grid grid-cols-2 gap-8 pt-4">
          <div className="text-center">
            <div className="border-b border-black mb-1 h-8"></div>
            <p className="text-xs">Cajero</p>
          </div>
          <div className="text-center">
            <div className="border-b border-black mb-1 h-8"></div>
            <p className="text-xs">Supervisor</p>
          </div>
        </div>

        <p className="text-xs text-muted-foreground text-center mt-4">
          Generado: {new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })}
        </p>
      </div>
    </div>
  );
}
