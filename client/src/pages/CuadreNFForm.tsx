import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { toast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatUSD, formatDateTime, formatBs } from "@/lib/utils";
import type { NonFiscalSummary } from "@shared/schema";
import { ArrowLeft, Loader2, Save } from "lucide-react";

// Method name display overrides (same as fiscal page)
const METHOD_NAME_OVERRIDES: Record<number, string> = {
  38: "P.Movil BNC",
  42: "PXC Cashea",
};

function getMethodDisplayName(methodId: number, methodName: string): string {
  return METHOD_NAME_OVERRIDES[methodId] || methodName;
}

// Credit method IDs (pay_later)
const CREDIT_METHOD_IDS = new Set([14, 33]);

// Payment method currency mapping (true = Bs, false = USD)
const METHOD_CURRENCY_BS: Record<number, boolean> = {
  3: true,   // P. MOVIL / VUELTO
  4: true,   // P. Movil BNC BS
  5: true,   // PXC Cashea
  6: true,   // Efectivo BS
  8: true,   // TRF Banesco Cte Bs
  9: true,   // TRF Bancamiga Bs
  11: true,  // PDV Banesco Bs
  12: true,  // PDV MEGASOFT
  14: true,  // Delivery (usually Bs for NF)
  15: false, // Venta crédito (credit, not direct)
  16: true,  // CXC Retenciones
  17: true,  // Delivery Bs
  19: false, // Venta a crédito IGTF (credit)
  20: false, // Efectivo $
  22: false, // TRF Banesco Verde $
  23: false, // TRF Banesco Panama $
  33: false, // Venta a crédito IGTF
  35: false, // Zelle Chase $
  38: false, // P.Movil BNC
  42: true,  // PXC Cashea
  21: false, // Binance CM
};

function isMethodBs(methodId: number): boolean {
  return METHOD_CURRENCY_BS[methodId] ?? false;
}

export default function CuadreNFForm() {
  const [, navigate] = useLocation();

  // Real amounts entered by the cashier per payment method (keyed by methodId) - in Bs
  const [realAmounts, setRealAmounts] = useState<Record<number, number>>({});
  const [observaciones, setObservaciones] = useState("");
  const [ajustesManuales, setAjustesManuales] = useState<{ tipo: string; descripcion: string; monto: number }[]>([]);

  // New adjustment form state
  const [newAjusteTipo, setNewAjusteTipo] = useState("");
  const [newAjusteDescripcion, setNewAjusteDescripcion] = useState("");
  const [newAjusteMonto, setNewAjusteMonto] = useState(0);

  const addAjuste = () => {
    if (!newAjusteTipo || !newAjusteDescripcion || newAjusteMonto === 0) return;
    setAjustesManuales(prev => [...prev, {
      tipo: newAjusteTipo,
      descripcion: newAjusteDescripcion,
      monto: newAjusteMonto
    }]);
    setNewAjusteTipo("");
    setNewAjusteDescripcion("");
    setNewAjusteMonto(0);
  };

  const updateRealAmount = useCallback((methodId: number, value: number) => {
    setRealAmounts(prev => ({ ...prev, [methodId]: value }));
  }, []);

  // Read sessionId from URL query params (hash routing)
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

  // Check if a cuadre already exists for this session (for navigation back to fiscal page)
  const { data: cuadresForDate } = useQuery<any[]>({
    queryKey: ["cuadres-lookup", sessionId],
    queryFn: async () => {
      // Get session first to know date, then query cuadres for that date
      const sRes = await fetch(`/api/odoo/session/${sessionId}`);
      if (!sRes.ok) return [];
      const sess = await sRes.json();
      const date = (sess.start_at || "").split(" ")[0];
      if (!date) return [];
      const cRes = await fetch(`/api/cuadres?fecha=${date}`);
      if (!cRes.ok) return [];
      return cRes.json();
    },
    enabled: !!sessionId,
  });

  const existingCuadreId = useMemo(() => {
    if (!cuadresForDate) return null;
    const match = cuadresForDate.find((c: any) => c.sessionId === sessionId);
    return match?.id || null;
  }, [cuadresForDate, sessionId]);

  // Get cuadre for observations
  const { data: existingCuadre } = useQuery<any>({
    queryKey: ["cuadre", existingCuadreId],
    queryFn: async () => {
      if (!existingCuadreId) return null;
      const res = await fetch(`/api/cuadres/${existingCuadreId}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!existingCuadreId,
  });

  // Load observaciones when existingCuadre changes
  useEffect(() => {
    if (existingCuadre?.observaciones) {
      setObservaciones(existingCuadre.observaciones);
    }
  }, [existingCuadre]);

  // Session data
  const { data: session, isLoading: isLoadingSession } = useQuery({
    queryKey: ["session", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${sessionId}`);
      if (!res.ok) throw new Error("Sesión no encontrada");
      return res.json();
    },
    enabled: !!sessionId,
  });

  // Non-fiscal data
  const { data: nfSummary, isLoading: isLoadingNF } = useQuery<NonFiscalSummary>({
    queryKey: ["non-fiscal", sessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${sessionId}/non-fiscal`);
      if (!res.ok) return { receiptCount: 0, totalUSD: 0, payments: [], creditSales: [], totalCreditUSD: 0 };
      return res.json();
    },
    enabled: !!sessionId,
  });

  // Save cuadre mutation
  const saveMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest(`/api/cuadres/nf/${existingCuadreId || sessionId}`, {
        method: existingCuadreId ? "PUT" : "POST",
        body: JSON.stringify(data),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["cuadre", existingCuadreId] });
      queryClient.invalidateQueries({ queryKey: ["cuadres-lookup", sessionId] });
      toast({ title: "Guardado", description: "Cuadre NF guardado exitosamente." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Error al guardar.", variant: "destructive" });
    },
  });

  const handleSave = () => {
    const metodosData = directPayments.map((p) => {
      const amountBs = realAmounts[p.methodId] || 0;
      const isBs = isMethodBs(p.methodId);
      // Convert to USD for storage
      const amountUSD = isBs && tasa ? amountBs / tasa : amountBs;
      return {
        metodoId: p.methodId,
        metodoNombre: p.methodName,
        montoPOS_USD: p.totalUSD,
        montoReal_Bs: isBs ? amountBs : 0,
        montoReal: amountUSD,
        observacion: "",
      };
    });
    saveMutation.mutate({
      sessionId,
      fecha,
      metodos: metodosData,
      observaciones,
      ajustesManuales,
    });
  };

  const fecha = session?.start_at?.split(" ")[0] || new Date().toISOString().split("T")[0];

  // Separate payment methods: direct payments vs credit
  const directPayments = useMemo(
    () => (nfSummary?.payments || []).filter(p => !CREDIT_METHOD_IDS.has(p.methodId)),
    [nfSummary]
  );
  const totalDirectUSD = useMemo(
    () => Math.round(directPayments.reduce((s, p) => s + p.totalUSD, 0) * 100) / 100,
    [directPayments]
  );
  const totalCreditUSD = nfSummary?.totalCreditUSD || 0;
  const totalNFUSD = nfSummary?.totalUSD || 0;

  // Tasa del dia (exchange rate)
  const tasa = session?.tasa_del_dia || session?.rate || 0;

  // Totals for real amounts (convert Bs methods to USD using tasa)
  const totalRealUSD = useMemo(() => {
    return directPayments.reduce((s, p) => {
      const amount = realAmounts[p.methodId] || 0;
      if (!amount) return s;
      // If method uses Bs, convert to USD using tasa
      if (isMethodBs(p.methodId) && tasa) {
        return s + amount / tasa;
      }
      // Otherwise, amount is already in USD
      return s + amount;
    }, 0);
  }, [directPayments, realAmounts, tasa]);

  // Total adjustments in USD
  const totalAjustesUSD = useMemo(() => {
    return ajustesManuales.reduce((s, a) => s + a.monto, 0);
  }, [ajustesManuales]);

  // Loading state
  if (!sessionId) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <p className="text-muted-foreground">No se especificó una sesión.</p>
        <Button onClick={() => navigate("/")}>Ir al Dashboard</Button>
      </div>
    );
  }

  if (isLoadingSession || isLoadingNF) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 text-purple-700 animate-spin" />
        <p className="text-sm font-medium text-muted-foreground">Cargando datos no fiscales...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-purple-800 text-white shadow-md no-print">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold">
                Cuadre No Fiscal — {session?.name || ""}
              </h1>
              <p className="text-xs opacity-80">Operaciones en divisas (USD) — Recibos</p>
            </div>
          </div>
        </div>
      </header>

      {/* Navigation tabs: Fiscal / No Fiscal */}
      <div className="bg-white border-b no-print">
        <div className="max-w-5xl mx-auto px-4 flex">
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-[#0A4083] hover:border-[#0A4083]/30"
            onClick={() => {
              if (existingCuadreId) {
                navigate(`/cuadre/${existingCuadreId}`);
              } else {
                navigate(`/cuadre/new?sessionId=${sessionId}`);
              }
            }}
          >
            Fiscal
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-purple-700 text-purple-700"
          >
            <span className="bg-purple-100 text-purple-800 text-xs font-bold px-1.5 py-0.5 rounded mr-1">NF</span>
            No Fiscal
          </button>
                      <button
              className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-[#0A4083] hover:border-[#0A4083] ml-auto"
              onClick={() => navigate("/cuadre-nf/report")}
            >
              Reporte NF
            </button>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
                              {/* Section 1: Session Info */}
        <Card className="border-purple-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <span className="bg-purple-100 text-purple-800 text-xs font-bold px-2 py-0.5 rounded">NF</span>
              Información de Sesión
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Sesión:</span>
                <p className="font-medium">{session?.name || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Caja:</span>
                <p className="font-medium">{session?.config_id?.[1] || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Cajero:</span>
                <p className="font-medium">{session?.user_id?.[1] || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fecha:</span>
                <p className="font-medium">{fecha}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Apertura:</span>
                <p className="font-medium text-xs">{session?.start_at ? formatDateTime(session.start_at) : "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Cierre:</span>
                <p className="font-medium text-xs">{session?.stop_at ? formatDateTime(session.stop_at) : "—"}</p>
              </div>
            </div>
            <div className="mt-3 bg-purple-50 border border-purple-200 rounded-md p-2 text-sm text-purple-800">
              Operaciones no fiscales (recibos). Todos los montos en divisas (USD). No aplica IVA, IGTF, ni retenciones.
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Summary */}
        <Card className="border-purple-200">
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1. Resumen No Fiscal</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Total Recibos:</span>
                <p className="font-bold text-2xl">{nfSummary?.receiptCount || 0}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Total Vendido (USD):</span>
                <p className="font-bold text-2xl text-purple-800">{formatUSD(totalNFUSD)}</p>
              </div>
              {totalCreditUSD > 0 && (
                <div>
                  <span className="text-muted-foreground">Crédito NF (USD):</span>
                  <p className="font-bold text-2xl text-amber-700">{formatUSD(totalCreditUSD)}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Section 3: Payment Methods with Reconciliation */}
        {directPayments.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">2. Métodos de Pago NF</CardTitle>
              <p className="text-xs text-muted-foreground">
                Desglose de pagos directos. Ingrese el monto real recibido por cada método para conciliar.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Método</th>
                      <th className="pb-2 font-medium text-right">Ops</th>
                      <th className="pb-2 font-medium text-right">POS (USD)</th>
                      <th className="pb-2 font-medium text-right">Real</th>
                      <th className="pb-2 font-medium text-right">Eq. USD</th>
                      <th className="pb-2 font-medium">Obs</th>
                    </tr>
                  </thead>
                  <tbody>
                    {directPayments.map((p) => {
                      const real = realAmounts[p.methodId] || 0;
                      const isBs = isMethodBs(p.methodId);
                      const realUSD = isBs && tasa && real ? Math.round(real / tasa * 100) / 100 : 0;
                      return (
                        <tr key={p.methodId} className="border-b">
                          <td className="py-2 font-medium">{getMethodDisplayName(p.methodId, p.methodName)}</td>
                          <td className="py-2 text-right text-muted-foreground">{p.count}</td>
                          <td className="py-2 text-right">{formatUSD(p.totalUSD)}</td>
                          <td className="py-2 text-right">
                            <Input
                              type="number"
                              step="0.01"
                              className="w-32 text-right ml-auto"
                              value={realAmounts[p.methodId] || ""}
                              onChange={(e) => updateRealAmount(p.methodId, Number(e.target.value) || 0)}
                              placeholder="—"
                            />
                          </td>
                          <td className="py-2 text-right text-muted-foreground">
                            {realUSD > 0 ? formatUSD(realUSD) : "—"}
                          </td>
                          <td className="py-2">
                            <Input
                              type="text"
                              className="w-full text-xs"
                              placeholder="..."
                              value={""}
                              onChange={(e) => {}}
                            />
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="border-t-2 font-bold">
                      <td className="py-2">TOTAL</td>
                      <td className="py-2 text-right">{directPayments.reduce((s, p) => s + p.count, 0)}</td>
                      <td className="py-2 text-right">{formatUSD(totalDirectUSD)}</td>
                      <td className="py-2 text-right">—</td>
                      <td className="py-2 text-right text-green-600">{formatUSD(totalRealUSD)}</td>
                      <td className="py-2"></td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 4: Credit Sales NF */}
        {nfSummary && nfSummary.creditSales.length > 0 && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">3. Ventas a Crédito NF</CardTitle>
              <p className="text-xs text-muted-foreground">
                Recibos con pago a crédito. Montos en USD.
              </p>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left">
                      <th className="pb-2 font-medium">Orden</th>
                      <th className="pb-2 font-medium">Cliente</th>
                      <th className="pb-2 font-medium text-right">Monto Crédito (USD)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nfSummary.creditSales.map((c) => (
                      <tr key={c.orderName} className="border-b bg-amber-50">
                        <td className="py-2 font-medium">{c.orderName}</td>
                        <td className="py-2">{c.partner || "—"}</td>
                        <td className="py-2 text-right">{formatUSD(c.amountUSD)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 font-bold">
                      <td className="py-2" colSpan={2}>TOTAL CRÉDITO NF</td>
                      <td className="py-2 text-right">{formatUSD(totalCreditUSD)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Section 5: Reconciliation / Summary */}
        <Card className={`border-2 ${nfSummary && nfSummary.receiptCount > 0 ? "border-purple-300" : "border-gray-300"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">4. Cuadre No Fiscal</CardTitle>
          </CardHeader>
          <CardContent>
            {!nfSummary || nfSummary.receiptCount === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Sin operaciones no fiscales en esta sesión.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="space-y-2">
                  <h3 className="font-semibold text-sm border-b pb-1">RESUMEN INGRESOS NF (USD)</h3>
                  <div className="flex justify-between text-sm">
                    <span>Pagos directos:</span>
                    <span>{formatUSD(totalDirectUSD)}</span>
                  </div>
                  {totalCreditUSD > 0 && (
                    <div className="flex justify-between text-sm">
                      <span>Ventas a crédito (pendiente):</span>
                      <span className="text-amber-700">{formatUSD(totalCreditUSD)}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-sm font-bold border-t pt-1">
                    <span>TOTAL NF:</span>
                    <span className="text-purple-800">{formatUSD(totalNFUSD)}</span>
                  </div>
                </div>

                {/* Reconciliation check */}
                <div className="border-t pt-4 space-y-3">
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                    <div>
                      <span className="text-muted-foreground">Pagos directos (POS):</span>
                      <p className="font-semibold">{formatUSD(totalDirectUSD)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Crédito (pendiente):</span>
                      <p className="font-semibold text-amber-700">{formatUSD(totalCreditUSD)}</p>
                    </div>
                    <div className="bg-purple-50 rounded p-2">
                      <span className="text-purple-700 text-xs">Total Ventas NF (referencia):</span>
                      <p className="font-bold text-purple-900">{formatUSD(totalNFUSD)}</p>
                    </div>
                  </div>

                  {/* Cuadre de Caja NF */}
                  <div className="border-t pt-4 space-y-3">
                    <h3 className="font-semibold text-sm border-b pb-1">CUADRE DE CAJA NF</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                      <div>
                        <span className="text-muted-foreground">Total Facturado NF:</span>
                        <p className="font-semibold">{formatUSD(totalNFUSD)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Total Cobrado Real:</span>
                        <p className="font-semibold text-green-700">{formatUSD(totalRealUSD)}</p>
                      </div>
                      {totalCreditUSD > 0 && (
                        <div>
                          <span className="text-muted-foreground">Crédito Pendiente:</span>
                          <p className="font-semibold text-amber-700">{formatUSD(totalCreditUSD)}</p>
                        </div>
                      )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm border-t pt-2">
                      <div>
                        <span className="text-muted-foreground">Cobrado Real + Crédito:</span>
                        <p className="font-semibold">{formatUSD(totalRealUSD + totalCreditUSD)}</p>
                      </div>
                      <div>
                        <span className="text-muted-foreground">Ajustes:</span>
                        <p className={`font-semibold ${totalAjustesUSD >= 0 ? "text-green-600" : "text-red-600"}`}>{formatUSD(totalAjustesUSD)}</p>
                      </div>
                      <div className={`rounded p-2 ${Math.abs(totalRealUSD + totalCreditUSD + totalAjustesUSD - totalNFUSD) < 0.01 ? "bg-green-50" : "bg-red-50"}`}>
                        <span className="text-muted-foreground">Diferencia Cuadre:</span>
                        <p className={`font-bold text-lg ${Math.abs(totalRealUSD + totalCreditUSD + totalAjustesUSD - totalNFUSD) < 0.01 ? "text-green-600" : "text-red-600"}`}>
                          {formatUSD(totalRealUSD + totalCreditUSD + totalAjustesUSD - totalNFUSD)}
                        </p>
                        {Math.abs(totalRealUSD + totalCreditUSD + totalAjustesUSD - totalNFUSD) < 0.01 ? (
                          <span className="text-xs text-green-700 font-semibold">CUADRADO</span>
                        ) : (
                          <span className="text-xs text-red-700 font-semibold">DESCUADRADO</span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 5: Manual Adjustments */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">5. Ajustes y Excepciones</CardTitle>
            <p className="text-xs text-muted-foreground">
              Ajustes manuales para cuadrar diferencias. Montos en USD.
            </p>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {ajustesManuales.map((ajuste, index) => (
                <div key={index} className="flex gap-2 items-center text-sm">
                  <span className="w-24 text-muted-foreground capitalize">{ajuste.tipo}</span>
                  <span className="flex-1">{ajuste.descripcion}</span>
                  <span className={`font-medium ${ajuste.monto >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {formatUSD(ajuste.monto)}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setAjustesManuales(prev => prev.filter((_, i) => i !== index))}
                  >
                    ×
                  </Button>
                </div>
              ))}
              <div className="flex gap-2 items-center pt-2 border-t">
                <select
                  className="border rounded px-2 py-1 text-sm"
                  value={newAjusteTipo}
                  onChange={(e) => setNewAjusteTipo(e.target.value)}
                >
                  <option value="">Tipo...</option>
                  <option value="otro">Otro</option>
                </select>
                <Input
                  placeholder="Descripción"
                  className="flex-1"
                  value={newAjusteDescripcion}
                  onChange={(e) => setNewAjusteDescripcion(e.target.value)}
                />
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Monto"
                  className="w-32"
                  value={newAjusteMonto || ""}
                  onChange={(e) => setNewAjusteMonto(Number(e.target.value) || 0)}
                />
                <Button size="sm" variant="outline" onClick={addAjuste}>+ Agregar</Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Observations */}
        <Card>
          <CardContent className="pt-4">
            <Label>Observaciones generales</Label>
            <textarea
              className="w-full mt-2 p-2 border rounded-md text-sm min-h-[60px] resize-y"
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              placeholder="Observaciones adicionales..."
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 no-print pb-8">
          <Button onClick={() => handleSave()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Save className="h-4 w-4 mr-1" />
            )}
            {saveMutation.isPending ? "Guardando..." : "Guardar"}
          </Button>
        </div>
      </main>
    </div>
  );
}
