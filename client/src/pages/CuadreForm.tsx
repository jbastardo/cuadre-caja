import { useState, useEffect, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation, useRoute } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { formatBs, formatUSD, getStatusColor, getStatusLabel, formatDateTime, formatLocalDate, todayStr } from "@/lib/utils";
import type { CuadreDetail, FiscalSummary, RetentionRow, CreditSaleRow, SaldoFavorRow, Cuadre } from "@shared/schema";

// Tolerance for "cuadrado" status: ±5 Bs (must match server CUADRE_TOLERANCE_BS)
const CUADRE_TOLERANCE_BS = 5;
import {
  ArrowLeft, ChevronLeft, ChevronRight, Save, Printer, Trash2, Plus, RotateCcw, Lock, AlertTriangle, Loader2,
} from "lucide-react";

// Payment method IDs to exclude from Section 3 display (they have dedicated sections).
// NOTE: The backend WARNING says all methods must be included in the API response.
// This filtering is ONLY for the Section 3 table display. The `metodos` state still
// contains ALL methods for saving purposes.
const RETENCION_IVA_METHOD_ID = 26;
// WARNING: Method 38 ("Venta a crédito" in Odoo) is actually P.Movil BNC (type=bank).
// Only pay_later credit methods (14, 33) belong here. Do NOT add 38.
const CREDITO_METHOD_IDS = [14, 33];
const SALDO_FAVOR_METHOD_ID = 25;
const SECTION3_EXCLUDED_IDS = new Set([RETENCION_IVA_METHOD_ID, ...CREDITO_METHOD_IDS, SALDO_FAVOR_METHOD_ID]);

// Method name display overrides (CASHEA companion methods have wrong names in Odoo)
const METHOD_NAME_OVERRIDES: Record<number, string> = {
  38: "P.Movil BNC",
  42: "PXC Cashea",
};

/** Returns true if a payment method is a delivery or diferencia type (by name) */
function isDeliveryOrDiferencia(methodName: string): boolean {
  const lower = methodName.toLowerCase();
  return lower.includes("delivery") || lower.includes("diferencia");
}

/** Get the display name for a payment method, applying overrides */
function getMethodDisplayName(methodId: number, methodName: string): string {
  return METHOD_NAME_OVERRIDES[methodId] || methodName;
}

const DEDUCTION_TYPES = [
  { value: "retencion_iva", label: "Retención IVA" },
  { value: "retencion_islr", label: "Retención ISLR" },
  { value: "cuenta_por_cobrar", label: "Cuenta por cobrar" },
  { value: "saldo_favor", label: "Saldo a favor" },
  { value: "nota_credito", label: "Nota de crédito" },
  { value: "otro", label: "Otro" },
];

const AJUSTE_TYPES = [
  { value: "retencion_pendiente", label: "Retención pendiente" },
  { value: "abono_transito", label: "Abono en tránsito" },
  { value: "ajuste", label: "Ajuste" },
  { value: "otro", label: "Otro" },
];

interface MetodoRow {
  metodoId: number;
  metodoNombre: string;
  montoPOS_USD: number;
  montoPOS_Bs: number;
  montoReal: number;
  observacion: string;
}

interface DeduccionRow {
  tipo: string;
  descripcion: string;
  monto: number;
  comprobante: string;
}

interface AjusteRow {
  tipo: string;
  descripcion: string;
  monto: number;
  referencia: string;
}

interface ZReportData {
  zNumero: string;
  ventaBrutaZ: number;
  notasCreditoZ: number;
  baseImponibleZ: number;
  exentoZ: number;
  ivaZ: number;
  igtfZ: number;
  primeraFacturaZ: string;
  ultimaFacturaZ: string;
  primeraNCZ: string;
  ultimaNCZ: string;
}

export default function CuadreForm() {
  const { user } = useAuth();
  const [, navigate] = useLocation();
  const [matchNew] = useRoute("/cuadre/new");
  const [matchEdit, paramsEdit] = useRoute("/cuadre/:id");

  const isNew = matchNew;
  const cuadreId = paramsEdit?.id;

  // Read sessionId from hash query params OR from window.location.search
  // wouter hash routing: navigate("/cuadre/new?sessionId=3762") → hash = "#/cuadre/new?sessionId=3762"
  // But some browsers may put params in window.location.search instead
  function getSessionIdFromUrl(): number {
    // Try from hash first (expected with useHashLocation)
    const hashParts = window.location.hash.split("?");
    if (hashParts[1]) {
      const params = new URLSearchParams(hashParts[1]);
      const id = params.get("sessionId");
      if (id) return Number(id);
    }
    // Fallback: try from window.location.search
    const fallbackParams = new URLSearchParams(window.location.search);
    const id = fallbackParams.get("sessionId");
    if (id) return Number(id);
    return 0;
  }

  const sessionId = isNew ? getSessionIdFromUrl() : 0;

  const [isNavigating, setIsNavigating] = useState(false);
  const [metodos, setMetodos] = useState<MetodoRow[]>([]);
  const [deducciones, setDeducciones] = useState<DeduccionRow[]>([]);
  const [ajustes, setAjustes] = useState<AjusteRow[]>([]);
  const [observaciones, setObservaciones] = useState("");
  const [saldoFavorReal, setSaldoFavorReal] = useState(0);
  const [saldoFavorObs, setSaldoFavorObs] = useState<string>("");
  const [retencionesReal, setRetencionesReal] = useState(0);
  const [zData, setZData] = useState<ZReportData>({
    zNumero: "", ventaBrutaZ: 0, notasCreditoZ: 0,
    baseImponibleZ: 0, exentoZ: 0, ivaZ: 0, igtfZ: 0,
    primeraFacturaZ: "", ultimaFacturaZ: "",
    primeraNCZ: "", ultimaNCZ: "",
  });

  // Load existing cuadre
  const { data: existingCuadre, isLoading: isLoadingCuadre, refetch: refetchCuadre } = useQuery<CuadreDetail>({
    queryKey: ["cuadre", cuadreId],
    queryFn: async () => {
      const res = await fetch(`/api/cuadres/${cuadreId}`);
      if (!res.ok) throw new Error("Cuadre no encontrado");
      return res.json();
    },
    enabled: !!cuadreId && !isNew,
  });

  // Navigation: fetch all cuadres for prev/next
  const { data: allCuadres = [] } = useQuery<Cuadre[]>({
    queryKey: ["cuadres-all"],
    queryFn: () => fetch("/api/cuadres").then(r => r.json()),
    staleTime: 2 * 60 * 1000,
  });

  const fiscalCuadres = useMemo(
    () => (Array.isArray(allCuadres) ? allCuadres : (allCuadres as any)?.data || [])
      .filter((c: any) => c && c.tipo !== "nf")
      .sort((a, b) => {
        // Sort by date first (ascending: oldest to newest)
        const dateCompare = a.fecha.localeCompare(b.fecha);
        if (dateCompare !== 0) return dateCompare;
        // Then by caja/sessionName (to keep consistent order within same day)
        const cajaCompare = (a.caja || "").localeCompare(b.caja || "");
        if (cajaCompare !== 0) return cajaCompare;
        // Finally by id as fallback
        return a.id.localeCompare(b.id);
      }),
    [allCuadres]
  );

  const currentIndex = useMemo(
    () => fiscalCuadres.findIndex(c => c.id === cuadreId),
    [fiscalCuadres, cuadreId]
  );

  const prevCuadre = currentIndex > 0 ? fiscalCuadres[currentIndex - 1] : null;
  const nextCuadre = currentIndex >= 0 && currentIndex < fiscalCuadres.length - 1 ? fiscalCuadres[currentIndex + 1] : null;

  const effectiveSessionId = isNew ? sessionId : existingCuadre?.sessionId;

  const { data: session, isLoading: isLoadingSession } = useQuery({
    queryKey: ["session", effectiveSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${effectiveSessionId}`);
      if (!res.ok) throw new Error("Sesión no encontrada");
      return res.json();
    },
    enabled: !!effectiveSessionId,
  });

  // Fiscal summary (invoices from FAC journal + payments converted to Bs)
  const { data: fiscalSummary, refetch: refetchFiscal, isLoading: isLoadingFiscal } = useQuery<FiscalSummary>({
    queryKey: ["fiscal-summary", effectiveSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${effectiveSessionId}/fiscal-summary`);
      if (!res.ok) throw new Error("Error cargando resumen fiscal");
      return res.json();
    },
    enabled: !!effectiveSessionId,
  });

  // Retentions data
  const { data: retentions } = useQuery<RetentionRow[]>({
    queryKey: ["retentions", effectiveSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${effectiveSessionId}/retentions`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!effectiveSessionId,
  });

  // Credit sales data
  const { data: creditSales } = useQuery<CreditSaleRow[]>({
    queryKey: ["credit-sales", effectiveSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${effectiveSessionId}/credit-sales`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!effectiveSessionId,
  });

  // Saldo a favor detail
  const { data: saldoFavorDetail } = useQuery<SaldoFavorRow[]>({
    queryKey: ["saldo-favor", effectiveSessionId],
    queryFn: async () => {
      const res = await fetch(`/api/odoo/session/${effectiveSessionId}/saldo-favor`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: !!effectiveSessionId,
  });

  const fecha = existingCuadre?.fecha || formatLocalDate(session?.start_at || session?.stop_at || "") || todayStr();
  const rate = fiscalSummary?.rate || existingCuadre?.tasaDia || 0;
  const totalOdooUSD = fiscalSummary?.totalUSD || existingCuadre?.totalOdooUSD || 0;
  const totalOdooBs = fiscalSummary?.totalVES || existingCuadre?.totalOdooBs || 0;

  // Special method totals from fiscal summary
  const totalRetencionesPOS_USD = fiscalSummary?.totalRetencionesPOS || 0;
  const totalCreditoPOS_USD = fiscalSummary?.totalCreditoPOS || 0;
  const totalSaldoFavorPOS_USD = fiscalSummary?.totalSaldoFavorPOS || 0;
  const totalRetencionesPOS_Bs = Math.round(totalRetencionesPOS_USD * rate * 100) / 100;
  const totalCreditoPOS_Bs = Math.round(totalCreditoPOS_USD * rate * 100) / 100;
  const totalSaldoFavorPOS_Bs = Math.round(totalSaldoFavorPOS_USD * rate * 100) / 100;

  // Retention totals from RIVAC
  const totalRetencionesRegistradas = useMemo(
    () => Math.round((retentions || []).filter(r => r.status === "registered").reduce((sum, r) => sum + r.retentionAmount, 0) * 100) / 100,
    [retentions]
  );
  const totalRetencionesRegistradas_Bs = Math.round(totalRetencionesRegistradas * rate * 100) / 100;

  const retencionesPorCobrar_Bs = Math.round((totalRetencionesPOS_Bs - totalRetencionesRegistradas_Bs) * 100) / 100;

  // Credit/abono totals
  const totalAbonosRecibidos = useMemo(
    () => Math.round((creditSales || []).reduce((sum, c) => sum + c.abonoAmount, 0) * 100) / 100,
    [creditSales]
  );
  // Bs total: use abonoAmountBs directly for VES journals, fallback to USD * rate
  const totalAbonosRecibidos_Bs = useMemo(
    () => Math.round((creditSales || []).reduce((sum, c) => {
      if (c.abonoAmountBs > 0) return sum + c.abonoAmountBs;
      return sum + c.abonoAmount * rate;
    }, 0) * 100) / 100,
    [creditSales, rate]
  );
  // CxC Pendientes = suma de todos los saldos (positivos = debe, negativos = saldo a favor)
  const totalCxCPendiente = useMemo(
    () => Math.round((creditSales || []).reduce((sum, c) => sum + (c.residual || 0), 0) * 100) / 100,
    [creditSales]
  );
  const totalCxCPendiente_Bs = useMemo(
    () => Math.round((creditSales || []).reduce((sum, c) => sum + ((c.residual || 0) * rate), 0) * 100) / 100,
    [creditSales, rate]
  );

  // Excedentes (pagos con exceso sobre la factura — ej: delivery)
  const totalExcedenteBs = useMemo(
    () => Math.round((creditSales || []).reduce((sum, c) => sum + (c.excedenteBs || 0), 0) * 100) / 100,
    [creditSales]
  );
  const totalExcedenteUsd = useMemo(
    () => Math.round((creditSales || []).reduce((sum, c) => sum + (c.excedenteUsd || 0), 0) * 100) / 100,
    [creditSales]
  );
  const creditSalesConExcedente = useMemo(
    () => (creditSales || []).filter(c => c.generaSaldoFavor),
    [creditSales]
  );

  // Determine fiscal machine from session config
  const maquinaFiscal = useMemo(() => {
    if (existingCuadre?.maquinaFiscal) return existingCuadre.maquinaFiscal;
    const configId = session?.config_id?.[0];
    if (configId === 1 || configId === 7) return "Z1F0019552";
    if (configId === 2 || configId === 8) return "Z7C7044514";
    return String(session?.serial_machine || "");
  }, [session, existingCuadre]);

  // Effect 1: Load all state from existingCuadre when it arrives.
  // This is the source of truth for montoReal, observacion, and all other saved fields.
  // Runs only when existingCuadre changes (i.e., once on load for existing cuadres).
  useEffect(() => {
    if (!existingCuadre || isNew) return;

    setMetodos(
      (existingCuadre.metodos || []).map((m) => ({
        metodoId: m.metodoId,
        metodoNombre: m.metodoNombre,
        // Use saved POS amounts as initial values; Effect 2 will refresh from fiscalSummary
        montoPOS_USD: m.montoPOS_USD || 0,
        montoPOS_Bs: m.montoPOS_Bs || 0,
        // Always use saved montoReal and observacion — these are the user's inputs
        montoReal: m.montoReal || 0,
        observacion: m.observacion || "",
      }))
    );
    setDeducciones(
      (existingCuadre.deducciones || []).map((d) => ({
        tipo: d.tipo,
        descripcion: d.descripcion,
        monto: d.monto || 0,
        comprobante: d.comprobante || "",
      }))
    );
    setAjustes(
      (existingCuadre.ajustesManuales || []).map((a) => ({
        tipo: a.tipo,
        descripcion: a.descripcion,
        monto: a.monto,
        referencia: a.referencia,
      }))
    );
    setObservaciones(existingCuadre.observaciones);
    setSaldoFavorReal(existingCuadre.totalSaldoFavorReal || 0);
    setSaldoFavorObs(existingCuadre.saldoFavorObs || "");
    setRetencionesReal(existingCuadre.totalRetencionesReal || 0);
    setZData({
      zNumero: existingCuadre.zNumero,
      ventaBrutaZ: existingCuadre.ventaBrutaZ,
      notasCreditoZ: existingCuadre.notasCreditoZ,
      baseImponibleZ: existingCuadre.baseImponibleZ,
      exentoZ: existingCuadre.exentoZ,
      ivaZ: existingCuadre.ivaZ,
      igtfZ: existingCuadre.igtfZ,
      primeraFacturaZ: existingCuadre.primeraFacturaZ,
      ultimaFacturaZ: existingCuadre.ultimaFacturaZ,
      primeraNCZ: existingCuadre.primeraNCZ || "",
      ultimaNCZ: existingCuadre.ultimaNCZ || "",
    });
  }, [existingCuadre, isNew]);

  // Reset isNavigating when cuadreId changes
  useEffect(() => {
    setIsNavigating(false);
  }, [cuadreId]);

  // Effect 2a: For new cuadres — populate metodos from live fiscalSummary.
  // Effect 2b: For existing cuadres — refresh only POS amounts from fiscalSummary,
  // preserving the montoReal and observacion values already loaded by Effect 1.
  // Using a functional setMetodos update ensures we read the latest state (with saved
  // montoReal values) rather than a stale closure, so no montoReal values are lost
  // even when fiscalSummary arrives after existingCuadre.
  useEffect(() => {
    if (!fiscalSummary) return;

    if (isNew) {
      // For new cuadres: use live Odoo data to populate the methods list
      setMetodos(
        fiscalSummary.payments.map((p) => ({
          metodoId: p.methodId,
          metodoNombre: p.methodName,
          montoPOS_USD: p.totalUSD,
          montoPOS_Bs: p.totalBs,
          montoReal: 0,
          observacion: "",
        }))
      );
    } else {
      // For existing cuadres: update only POS amounts, never touch montoReal/observacion.
      // Functional update reads the current metodos state (already populated by Effect 1)
      // so saved montoReal values are always preserved regardless of load order.
      const livePOS = new Map(
        fiscalSummary.payments.map((p) => [p.methodId, { totalUSD: p.totalUSD, totalBs: p.totalBs }])
      );
      setMetodos((prev) =>
        prev.map((m) => {
          const live = livePOS.get(m.metodoId);
          if (!live) return m;
          return {
            ...m,
            montoPOS_USD: live.totalUSD,
            montoPOS_Bs: live.totalBs,
            // montoReal and observacion are intentionally NOT updated here
          };
        })
      );
    }
  }, [fiscalSummary, isNew]);

  // Auto-update retencionesReal when RIVAC data loads (for new cuadres ONLY).
  // For existing cuadres, retencionesReal is already loaded from DB by Effect 1
  // and must NOT be overwritten by live RIVAC data (user may have edited it manually).
  useEffect(() => {
    if (isNew && totalRetencionesRegistradas_Bs > 0) {
      setRetencionesReal(totalRetencionesRegistradas_Bs);
    }
    // Intentionally no else-branch: existing cuadres keep their saved value.
  }, [isNew, totalRetencionesRegistradas_Bs]);

  // Z Report calculated fields
  const ventaNetaZ = Math.round((zData.ventaBrutaZ - zData.notasCreditoZ) * 100) / 100;
  const difCambiaria = Math.round((ventaNetaZ - totalOdooBs) * 100) / 100;

  // Cuadre calculations (all in Bs)
  // Direct methods: exclude retenciones, crédito, saldo a favor, delivery, diferencia from Section 3 display
  const directMetodos = useMemo(
    () => metodos.filter(m => !SECTION3_EXCLUDED_IDS.has(m.metodoId) && !isDeliveryOrDiferencia(m.metodoNombre)),
    [metodos]
  );
  const totalDirectMetodosReal = useMemo(
    () => Math.round(directMetodos.reduce((sum, m) => sum + (m.montoReal || 0), 0) * 100) / 100,
    [directMetodos]
  );

  // Delivery + Diferencia methods (auto-populated in Deducciones)
  const deliveryDifMetodos = useMemo(
    () => metodos.filter(m => isDeliveryOrDiferencia(m.metodoNombre)),
    [metodos]
  );
  const totalDeliveryDifPOS_Bs = useMemo(
    () => Math.round(deliveryDifMetodos.reduce((sum, m) => sum + m.montoPOS_Bs, 0) * 100) / 100,
    [deliveryDifMetodos]
  );

  // totalMetodosReal still sums ALL metodos (for backward compat with save payload)
  const totalMetodosReal = useMemo(
    () => Math.round(metodos.reduce((sum, m) => sum + (m.montoReal || 0), 0) * 100) / 100,
    [metodos]
  );
  const totalDeducciones = useMemo(
    () => Math.round(deducciones.reduce((sum, d) => sum + (d.monto || 0), 0) * 100) / 100,
    [deducciones]
  );
  const totalAjustesManuales = useMemo(
    () => Math.round(ajustes.reduce((sum, a) => sum + (a.monto || 0), 0) * 100) / 100,
    [ajustes]
  );

  // ─── Totals: guarantee correctness for old cuadres ─────────────────────────
  // For existing cuadres: compute from saved metodos/deducciones/ajustes only.
  // Odoo data may be unavailable or changed for old sessions.
  // For new cuadres: compute from live Odoo data.
  const isExisting = !isNew && existingCuadre;

  // Direct methods POS (Bs) - from saved metodos array
  const displayDirectoPOS = directMetodos.reduce((s, m) => s + m.montoPOS_Bs, 0);
  // All methods POS (Bs) - includes retenciones, crédito, saldos, delivery, etc.
  const allMetodosPOS = metodos.reduce((s, m) => s + m.montoPOS_Bs, 0);
  // All methods Real (Bs)
  const allMetodosReal = metodos.reduce((s, m) => s + (m.montoReal || 0), 0);
  // Delivery/dif POS
  const deliveryDifPOS = deliveryDifMetodos.reduce((s, m) => s + m.montoPOS_Bs, 0);

  // Deducciones and ajustes from saved arrays
  const deduccionesTotal = deducciones.reduce((s, d) => s + (d.monto || 0), 0);
  const ajustesTotal = ajustes.reduce((s, a) => s + (a.monto || 0), 0);

  // For existing cuadres: use saved special totals if available, else compute from metodos
  const displayRetencionesPOS = isExisting
    ? (existingCuadre.totalRetencionesPOS || 0)
    : totalRetencionesPOS_Bs;
  const displayCreditoPOS = isExisting
    ? (existingCuadre.totalCreditoPOS || 0)
    : totalCreditoPOS_Bs;
  const displaySaldoFavorPOS = isExisting
    ? (existingCuadre.totalSaldoFavorPOS || 0)
    : totalSaldoFavorPOS_Bs;
  // Use live retencionesReal state (loaded from existingCuadre by Effect 1, editable by user)
  const displayRetencionesReal = retencionesReal;
  const displayRetencionesPorCobrar = isExisting
    ? (existingCuadre.retencionesPorCobrar || 0)
    : retencionesPorCobrar_Bs;
  const displayAbonosReal = isExisting
    ? (existingCuadre.totalAbonosReal || 0)
    : totalAbonosRecibidos_Bs;
  const displayCxCPendiente = isExisting
    ? (existingCuadre.totalCxCPendiente || 0)
    : totalCxCPendiente_Bs;
  // Use live saldoFavorReal state (loaded from existingCuadre by Effect 1, editable by user)
  const displaySaldoFavorReal = saldoFavorReal;
  // Use live ajustesTotal/deduccionesTotal (loaded from existingCuadre by Effect 1, editable by user)
  const displayAjustesManuales = ajustesTotal;
  const displayDeducciones = deduccionesTotal;

  // TOTAL POS: for existing cuadres, use saved total or compute from all metodos POS
  const summaryPOS = isExisting
    ? (existingCuadre.totalMetodosPOS || allMetodosPOS)
    : Math.round((displayDirectoPOS + displayRetencionesPOS + displayCreditoPOS + displaySaldoFavorPOS + deliveryDifPOS) * 100) / 100;

  // TOTAL VERIFICADO: always compute from live state so it matches the individual line items
  // shown in Section 8. For existing cuadres, display* values come from saved fields for
  // retenciones/crédito/saldos, while totalDirectMetodosReal comes from the live metodos state.
  // NOTA: CxC pendiente se suma como valor absoluto (sin signo negativo)
  const summaryReal = Math.round((
    totalDirectMetodosReal
    + displayRetencionesReal
    + displayRetencionesPorCobrar
    + displayAbonosReal
    + displayCxCPendiente
    + displaySaldoFavorReal
    + deliveryDifPOS
    + displayDeducciones
    + displayAjustesManuales
  ) * 100) / 100;

  // Cuadre difference = totalJustificado - ventaNetaZ (comparing against Z, NOT Odoo)
  const diferencia = Math.round((summaryReal - ventaNetaZ) * 100) / 100;
  
  // Estado calculado (mismo que se muestra en el badge)
  const calculatedEstado = existingCuadre?.cerradoPor
    ? (Math.abs(diferencia) < CUADRE_TOLERANCE_BS || ventaNetaZ === 0)
      ? "cuadrado" as const
      : "descuadrado" as const
    : "pendiente" as const;

  // Total Justificado and Diferencia for bottom section.
  // Always use summaryReal (computed from live state) — never the saved POS total.
  // Previously used existingCuadre.totalMetodosPOS which is the POS total, not the verified total,
  // causing the displayed difference to diverge from the real cuadre calculation.
  const displayTotalJustificado = summaryReal;
  const displayDiferencia = diferencia;

  const isLocked = existingCuadre?.cerradoPor && existingCuadre.estado !== "pendiente";
  const canClose = (user?.rol === "supervisor" || user?.rol === "admin") && !isLocked;
  const canReopen = (user?.rol === "supervisor" || user?.rol === "admin") && isLocked;
  const canDelete = user?.rol === "admin";

  // Save mutation
  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        sessionId: effectiveSessionId!,
        sessionName: session?.name || existingCuadre?.sessionName || "",
        fecha,
        caja: session?.config_id?.[1] || existingCuadre?.caja || "",
        cajero: session?.user_id?.[1] || existingCuadre?.cajero || "",
        maquinaFiscal,
        tasaDia: rate,
        zNumero: zData.zNumero,
        ventaBrutaZ: zData.ventaBrutaZ,
        notasCreditoZ: zData.notasCreditoZ,
        ventaNetaZ,
        baseImponibleZ: zData.baseImponibleZ,
        exentoZ: zData.exentoZ,
        ivaZ: zData.ivaZ,
        igtfZ: zData.igtfZ,
        primeraFacturaZ: zData.primeraFacturaZ,
        ultimaFacturaZ: zData.ultimaFacturaZ,
        primeraNCZ: zData.primeraNCZ,
        ultimaNCZ: zData.ultimaNCZ,
        totalOdooUSD,
        totalOdooBs,
        difCambiaria,
        observaciones,
        metodos,
        deducciones,
        ajustesManuales: ajustes,
        totalRetencionesPOS: displayRetencionesPOS,
        totalRetencionesReal: retencionesReal,
        totalCreditoPOS: displayCreditoPOS,
        totalAbonosReal: displayAbonosReal,
        totalCxCPendiente: displayCxCPendiente,
        totalSaldoFavorPOS: displaySaldoFavorPOS,
        retencionesPorCobrar: displayRetencionesPorCobrar,
        totalSaldoFavorReal: saldoFavorReal,
        saldoFavorObs,
        totalAjustesManuales: ajustesTotal,
        totalDeducciones: Math.round((deliveryDifPOS + deduccionesTotal) * 100) / 100,
        // Calculated internally in form - needed for accurate report display
        totalMetodosPOS: summaryPOS,
        totalJustificadoReal: summaryReal,
        totalDirectoPOS: displayDirectoPOS,
        diferencia,
        estado: calculatedEstado,
        // Snapshot data for historical consistency
        creditSales: (creditSales || []).map(c => ({
          ...c,
          residualBs: Math.round((c.residual || 0) * rate * 100) / 100,
        })),
        retenciones: (retentions || []).map(r => ({
          ...r,
          posTotalBs: Math.round((r.posTotalUSD || 0) * rate * 100) / 100,
          retentionAmountBs: Math.round((r.retentionAmount || 0) * rate * 100) / 100,
        })),
        saldosFavor: saldoFavorDetail || [],
        fiscalSummary: fiscalSummary || undefined,
      };

      if (isNew) {
        const res = await apiRequest("/api/cuadres", { method: "POST", body: JSON.stringify(body) });
            
        return res.json();
      } else {
        const res = await apiRequest(`/api/cuadres/${cuadreId}`, { method: "PUT", body: JSON.stringify(body) });
        return res.json();
      }
    },
    onSuccess: async (data) => {
      toast({ title: "Cuadre guardado" });
      // Invalidate both the list cache and the individual cuadre cache so that
      // retencionesReal and all other saved fields reload correctly on navigation.
      queryClient.invalidateQueries({ queryKey: ["cuadres-all"] });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      
      if (isNew) {
        navigate(`/cuadre/${data.id}`);
      } else {
        // For existing cuadres, force immediate refetch to reload saved data
        await refetchCuadre();
      }
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/cuadres/${cuadreId}/close`, {
        method: "POST",
        body: JSON.stringify({ cerradoPor: user?.email }),
      });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Cuadre cerrado" });
      queryClient.invalidateQueries({ queryKey: ["cuadres-all"] });
      await refetchCuadre();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(`/api/cuadres/${cuadreId}/reopen`, { method: "POST" });
      return res.json();
    },
    onSuccess: async () => {
      toast({ title: "Cuadre reabierto" });
      queryClient.invalidateQueries({ queryKey: ["cuadres-all"] });
      await refetchCuadre();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      await apiRequest(`/api/cuadres/${cuadreId}`, { method: "DELETE" });
    },
    onSuccess: () => {
      toast({ title: "Cuadre eliminado" });
      queryClient.invalidateQueries({ queryKey: ["cuadres-all"] });
      navigate("/");
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const updateMetodo = (idx: number, field: keyof MetodoRow, value: any) => {
    setMetodos((prev) => prev.map((m, i) => (i === idx ? { ...m, [field]: value } : m)));
  };

  const addDeduccion = () => {
    setDeducciones((prev) => [...prev, { tipo: "otro", descripcion: "", monto: 0, comprobante: "" }]);
  };

  const updateDeduccion = (idx: number, field: keyof DeduccionRow, value: any) => {
    setDeducciones((prev) => prev.map((d, i) => (i === idx ? { ...d, [field]: value } : d)));
  };

  const removeDeduccion = (idx: number) => {
    setDeducciones((prev) => prev.filter((_, i) => i !== idx));
  };

  const addAjuste = () => {
    setAjustes((prev) => [...prev, { tipo: "otro", descripcion: "", monto: 0, referencia: "" }]);
  };

  const updateAjuste = (idx: number, field: keyof AjusteRow, value: any) => {
    setAjustes((prev) => prev.map((a, i) => (i === idx ? { ...a, [field]: value } : a)));
  };

  const removeAjuste = (idx: number) => {
    setAjustes((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateZ = (field: keyof ZReportData, value: any) => {
    setZData((prev) => ({ ...prev, [field]: value }));
  };

  const getPaymentStateColor = (state: string) => {
    switch (state) {
      case "paid": case "in_payment": return "text-green-700 bg-green-50";
      case "partial": return "text-amber-700 bg-amber-50";
      default: return "text-red-700 bg-red-50";
    }
  };

  const getPaymentStateLabel = (state: string) => {
    switch (state) {
      case "paid": return "Pagado";
      case "in_payment": return "En pago";
      case "partial": return "Parcial";
      case "not_paid": return "Sin pago";
      default: return state;
    }
  };

  // Show loading screen while initial data loads
  const isInitialLoading = (!isNew && isLoadingCuadre) || isLoadingSession || (!!effectiveSessionId && isLoadingFiscal && !fiscalSummary);

  if (isInitialLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center gap-4">
        <Loader2 className="h-10 w-10 text-[#0A4083] animate-spin" />
        <p className="text-sm font-medium text-muted-foreground">Cargando datos de Odoo...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0A4083] text-white shadow-md no-print">
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="icon" className="text-white hover:bg-white/20" onClick={() => navigate("/")}>
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-bold">
                {isNew ? "Nuevo Cuadre" : `Cuadre ${existingCuadre?.sessionName || ""}`}
              </h1>
              {rate > 0 && (
                <p className="text-xs opacity-80">Tasa BCV del día: Bs {rate.toFixed(2)}/$</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isNew && prevCuadre && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/20" 
                onClick={() => {
                  setIsNavigating(true);
                  navigate(`/cuadre/${prevCuadre.id}`);
                }}
                disabled={isNavigating || isLoadingCuadre || isLoadingSession}
              >
                {isNavigating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ChevronLeft className="h-4 w-4 mr-1" />}
                Anterior
              </Button>
            )}
            {!isNew && nextCuadre && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/20" 
                onClick={() => {
                  setIsNavigating(true);
                  navigate(`/cuadre/${nextCuadre.id}`);
                }}
                disabled={isNavigating || isLoadingCuadre || isLoadingSession}
              >
                Siguiente 
                {isNavigating ? <Loader2 className="h-4 w-4 ml-1 animate-spin" /> : <ChevronRight className="h-4 w-4 ml-1" />}
              </Button>
            )}
            {!isNew && (
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-white hover:bg-white/20"
                onClick={() => navigate(`/cuadre/${cuadreId}/report`)}
                disabled={isNavigating || isLoadingCuadre}
              >
                <Printer className="h-4 w-4 mr-1" /> Reporte
              </Button>
            )}
            {!isLocked && (
              <Button 
                size="sm" 
                className="bg-white text-[#0A4083] hover:bg-white/90" 
                onClick={() => saveMutation.mutate()} 
                disabled={saveMutation.isPending || isNavigating || isLoadingCuadre}
              >
                <Save className="h-4 w-4 mr-1" />
                {saveMutation.isPending ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </div>
        </div>
      </header>

      {/* Navigation tabs: Fiscal / No Fiscal */}
      <div className="bg-white border-b no-print">
        <div className="max-w-5xl mx-auto px-4 flex">
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-[#0A4083] text-[#0A4083]"
          >
            Fiscal
          </button>
          <button
            className="px-4 py-2 text-sm font-medium border-b-2 border-transparent text-muted-foreground hover:text-purple-700 hover:border-purple-300"
            onClick={() => {
              const sid = effectiveSessionId;
              if (sid) navigate(`/cuadre-nf?sessionId=${sid}`);
            }}
          >
            <span className="bg-purple-100 text-purple-800 text-xs font-bold px-1.5 py-0.5 rounded mr-1">NF</span>
            No Fiscal
          </button>
        </div>
      </div>

      <main className="max-w-5xl mx-auto px-4 py-4 space-y-4">
        {/* Section 0: Session Info */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between">
              <span className="flex items-center gap-2">
                Información de Sesión
                <span className="bg-[#0A4083] text-white text-xs font-bold px-2 py-0.5 rounded">FISCAL</span>
              </span>
              {existingCuadre && (
                <Badge className={getStatusColor(calculatedEstado)}>
                  {getStatusLabel(calculatedEstado)}
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Sesión:</span>
                <p className="font-medium">{session?.name || existingCuadre?.sessionName || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Caja:</span>
                <p className="font-medium">{session?.config_id?.[1] || existingCuadre?.caja || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Cajero:</span>
                <p className="font-medium">{session?.user_id?.[1] || existingCuadre?.cajero || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Fecha:</span>
                <p className="font-medium">{fecha}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Máquina Fiscal:</span>
                <p className="font-medium text-xs">{maquinaFiscal || "—"}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Diario:</span>
                <p className="font-medium">{fiscalSummary?.journalCode || "—"}</p>
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
            {fiscalSummary?.companionSessionName && (
              <div className="mt-3 bg-blue-50 border border-blue-200 rounded-md p-2 text-sm text-blue-800">
                Incluye datos de <strong>{fiscalSummary.companionSessionName}</strong> (máquina fiscal compartida)
              </div>
            )}
            {effectiveSessionId && !fiscalSummary && !isLoadingFiscal && (
              <div className="mt-3">
                <Button variant="outline" size="sm" onClick={() => { refetchFiscal(); }}>
                  <RotateCcw className="w-4 h-4 mr-2" /> Cargar datos de Odoo
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Section 1: Datos del Reporte Z (manual input) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">1. Datos del Reporte Z</CardTitle>
            <p className="text-xs text-muted-foreground">Ingrese los datos del ticket Z impreso (fuente fiscal oficial). Todos los montos en Bs.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* --- Identificación --- */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Identificación</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
                <div>
                  <Label className="text-xs">Número Z</Label>
                  <Input
                    value={zData.zNumero}
                    onChange={(e) => updateZ("zNumero", e.target.value)}
                    disabled={!!isLocked}
                    placeholder="Ej: 0001234"
                  />
                </div>
              </div>
            </div>

            {/* --- Montos del Z --- */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Montos</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
                <div>
                  <Label className="text-xs">Venta Bruta (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    value={zData.ventaBrutaZ || ""}
                    onChange={(e) => updateZ("ventaBrutaZ", Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                  />
                </div>
                <div>
                  <Label className="text-xs">Notas de Crédito (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    value={zData.notasCreditoZ || ""}
                    onChange={(e) => updateZ("notasCreditoZ", Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                  />
                </div>
                <div className="bg-blue-50 rounded p-2 flex flex-col justify-center">
                  <Label className="text-xs text-blue-700">Venta Neta (Bs)</Label>
                  <p className="font-bold text-blue-900 text-lg">{formatBs(ventaNetaZ)}</p>
                </div>
                <div>
                  <Label className="text-xs">Base Imponible (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    value={zData.baseImponibleZ || ""}
                    onChange={(e) => updateZ("baseImponibleZ", Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                  />
                </div>
                <div>
                  <Label className="text-xs">Exento (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    value={zData.exentoZ || ""}
                    onChange={(e) => updateZ("exentoZ", Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                  />
                </div>
                <div>
                  <Label className="text-xs">IGTF (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    value={zData.igtfZ || ""}
                    onChange={(e) => updateZ("igtfZ", Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                  />
                </div>
                <div>
                  <Label className="text-xs">IVA (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    value={zData.ivaZ || ""}
                    onChange={(e) => updateZ("ivaZ", Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                  />
                </div>
              </div>
            </div>

            {/* --- Facturas --- */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Facturas</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
                <div>
                  <Label className="text-xs">Primera Factura (Z)</Label>
                  <Input
                    value={zData.primeraFacturaZ}
                    onChange={(e) => updateZ("primeraFacturaZ", e.target.value)}
                    disabled={!!isLocked}
                  />
                </div>
                <div>
                  <Label className="text-xs">Última Factura (Z)</Label>
                  <Input
                    value={zData.ultimaFacturaZ}
                    onChange={(e) => updateZ("ultimaFacturaZ", e.target.value)}
                    disabled={!!isLocked}
                  />
                </div>
                <div className="bg-gray-50 rounded p-2 flex flex-col justify-center">
                  <Label className="text-xs text-gray-600">Cantidad (Z)</Label>
                  <p className="font-bold text-gray-900">
                    {(() => {
                      const first = parseInt((zData.primeraFacturaZ || "").replace(/\D/g, ""), 10);
                      const last = parseInt((zData.ultimaFacturaZ || "").replace(/\D/g, ""), 10);
                      return !isNaN(first) && !isNaN(last) ? last - first + 1 : "—";
                    })()}
                  </p>
                </div>
              </div>
              {fiscalSummary && fiscalSummary.invoiceCount > 0 && (
                <div className="bg-green-50 rounded p-2 mt-2 space-y-1">
                  {fiscalSummary.companionInvoiceCount && fiscalSummary.companionInvoiceCount > 0 ? (
                    <>
                      <p className="text-xs text-green-700">
                        <span className="font-semibold">{fiscalSummary.mainCajaName || "Caja"}:</span>{" "}
                        {fiscalSummary.mainFirstInvoice} — {fiscalSummary.mainLastInvoice}{" "}
                        <span className="font-bold">({fiscalSummary.mainInvoiceCount} facturas)</span>
                      </p>
                      <p className="text-xs text-green-700">
                        <span className="font-semibold">{fiscalSummary.companionCajaName || "Companion"}:</span>{" "}
                        {fiscalSummary.companionFirstInvoice} — {fiscalSummary.companionLastInvoice}{" "}
                        <span className="font-bold">({fiscalSummary.companionInvoiceCount} facturas)</span>
                      </p>
                      <p className="text-xs text-green-800 font-semibold border-t border-green-200 pt-1">
                        Total: {fiscalSummary.invoiceCount} facturas
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-green-700">
                      <span className="font-semibold">Odoo:</span>{" "}
                      {fiscalSummary.firstInvoice} — {fiscalSummary.lastInvoice}{" "}
                      <span className="font-bold">({fiscalSummary.invoiceCount} facturas)</span>
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* --- Notas de Crédito --- */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Notas de Crédito</Label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-1">
                <div>
                  <Label className="text-xs">Primera NC (Z)</Label>
                  <Input
                    value={zData.primeraNCZ}
                    onChange={(e) => updateZ("primeraNCZ", e.target.value)}
                    disabled={!!isLocked}
                    placeholder="Ej: 00001"
                  />
                </div>
                <div>
                  <Label className="text-xs">Última NC (Z)</Label>
                  <Input
                    value={zData.ultimaNCZ}
                    onChange={(e) => updateZ("ultimaNCZ", e.target.value)}
                    disabled={!!isLocked}
                    placeholder="Ej: 00003"
                  />
                </div>
                <div className="bg-gray-50 rounded p-2 flex flex-col justify-center">
                  <Label className="text-xs text-gray-600">Cantidad (Z)</Label>
                  <p className="font-bold text-gray-900">
                    {(() => {
                      const first = parseInt((zData.primeraNCZ || "").replace(/\D/g, ""), 10);
                      const last = parseInt((zData.ultimaNCZ || "").replace(/\D/g, ""), 10);
                      return !isNaN(first) && !isNaN(last) ? last - first + 1 : "—";
                    })()}
                  </p>
                </div>
              </div>
              {fiscalSummary && fiscalSummary.ncCount > 0 && (
                <div className="bg-green-50 rounded p-2 mt-2 space-y-1">
                  {fiscalSummary.companionNcCount && fiscalSummary.companionNcCount > 0 ? (
                    <>
                      <p className="text-xs text-green-700">
                        <span className="font-semibold">{fiscalSummary.mainCajaName || "Caja"}:</span>{" "}
                        {fiscalSummary.mainFirstNC} — {fiscalSummary.mainLastNC}{" "}
                        <span className="font-bold">({fiscalSummary.mainNcCount} NCs)</span>
                      </p>
                      <p className="text-xs text-green-700">
                        <span className="font-semibold">{fiscalSummary.companionCajaName || "Companion"}:</span>{" "}
                        {fiscalSummary.companionFirstNC} — {fiscalSummary.companionLastNC}{" "}
                        <span className="font-bold">({fiscalSummary.companionNcCount} NCs)</span>
                      </p>
                      <p className="text-xs text-green-800 font-semibold border-t border-green-200 pt-1">
                        Total: {fiscalSummary.ncCount} NCs
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-green-700">
                      <span className="font-semibold">Odoo:</span>{" "}
                      {fiscalSummary.firstNC} — {fiscalSummary.lastNC}{" "}
                      <span className="font-bold">({fiscalSummary.ncCount} NCs)</span>
                    </p>
                  )}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Section 2: Comparación Odoo vs Z */}
        <Card className="border-amber-300 bg-amber-50">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              2. Comparación Odoo vs Z
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Venta Neta Z (Bs):</span>
                <p className="font-bold text-lg">{formatBs(ventaNetaZ)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Venta Neta Odoo (Bs):</span>
                <p className="font-bold text-lg">{formatBs(totalOdooBs)}</p>
                <p className="text-xs text-muted-foreground">{formatUSD(totalOdooUSD)} x {rate.toFixed(2)}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Diferencia Cambiaria:</span>
                <p className={`font-bold text-lg ${Math.abs(difCambiaria) < 0.01 ? "text-green-700" : "text-amber-700"}`}>
                  {formatBs(difCambiaria)}
                </p>
              </div>
            </div>
            {Math.abs(difCambiaria) >= 0.01 && (
              <p className="text-xs text-amber-700 mt-2 border-t border-amber-200 pt-2">
                Esta diferencia se reporta a contabilidad para ajuste por diferencia cambiaria.
              </p>
            )}
          </CardContent>
        </Card>

        {/* Section 3: Payment Methods Table (direct methods only) */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">3. Métodos de Pago Directos</CardTitle>
            <p className="text-xs text-muted-foreground">Solo métodos directos. Retenciones, créditos y saldos a favor están en sus secciones.</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="pb-2 font-medium">Método</th>
                    <th className="pb-2 font-medium text-right">POS (USD)</th>
                    <th className="pb-2 font-medium text-right">POS (Bs)</th>
                    <th className="pb-2 font-medium text-right">Real (Bs)</th>
                    <th className="pb-2 font-medium text-right">Diferencia</th>
                    <th className="pb-2 font-medium">Observación</th>
                  </tr>
                </thead>
                <tbody>
                  {directMetodos.map((m) => {
                    const originalIdx = metodos.findIndex(om => om.metodoId === m.metodoId);
                    const diff = m.montoReal ? Math.round((m.montoReal - m.montoPOS_Bs) * 100) / 100 : 0;
                    const displayName = getMethodDisplayName(m.metodoId, m.metodoNombre);
                    return (
                      <tr key={m.metodoId} className="border-b">
                        <td className="py-2 font-medium">
                          {displayName}
                          {(() => {
                            const fp = fiscalSummary?.payments?.find(p => p.methodId === m.metodoId);
                            if (!fp || !fp.companionAmountUSD) return null;
                            return (
                              <span className="text-amber-600 ml-1 text-xs" title={`Main: ${formatUSD(fp.mainAmountUSD || 0)} | CASHEA: ${formatUSD(fp.companionAmountUSD)}`}>
                                *
                              </span>
                            );
                          })()}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatUSD(m.montoPOS_USD)}
                        </td>
                        <td className="py-2 text-right text-muted-foreground">
                          {formatBs(m.montoPOS_Bs)}
                        </td>
                        <td className="py-2 text-right">
                          <Input
                            type="number"
                            step="0.01"
                            className="w-32 text-right ml-auto"
                            value={m.montoReal || ""}
                            onChange={(e) => updateMetodo(originalIdx, "montoReal", Number(e.target.value) || 0)}
                            disabled={!!isLocked}
                            placeholder="Bs"
                          />
                        </td>
                        <td className={`py-2 text-right font-medium ${diff === 0 ? "" : diff > 0 ? "text-green-600" : "text-red-600"}`}>
                          {m.montoReal ? formatBs(diff) : "—"}
                        </td>
                        <td className="py-2">
                          <Input
                            className="w-full min-w-[120px]"
                            placeholder="Observación"
                            value={m.observacion}
                            onChange={(e) => updateMetodo(originalIdx, "observacion", e.target.value)}
                            disabled={!!isLocked}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {fiscalSummary?.companionSessionName && directMetodos.some(m => {
              const fp = fiscalSummary?.payments?.find(p => p.methodId === m.metodoId);
              return fp && fp.companionAmountUSD && fp.companionAmountUSD > 0;
            }) && (
              <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                <p className="font-semibold mb-1">Desglose por caja (métodos con CASHEA *):</p>
                {directMetodos.map(m => {
                  const fp = fiscalSummary?.payments?.find(p => p.methodId === m.metodoId);
                  if (!fp || !fp.companionAmountUSD || fp.companionAmountUSD <= 0) return null;
                  return (
                    <div key={m.metodoId} className="flex justify-between">
                      <span>{getMethodDisplayName(m.metodoId, m.metodoNombre)}:</span>
                      <span>
                        {formatUSD(fp.mainAmountUSD || 0)} (Caja) + <span className="text-amber-700">{formatUSD(fp.companionAmountUSD)}</span> ({fiscalSummary.companionCajaName || "CASHEA"}) = {formatUSD(fp.totalUSD)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
            <div className="mt-2 text-right text-sm font-medium">
              Total real métodos directos: <strong>{formatBs(totalDirectMetodosReal)}</strong>
            </div>
          </CardContent>
        </Card>

        {/* Section 4: Retenciones Fiscales */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">4. Retenciones Fiscales (IVA)</CardTitle>
            <p className="text-xs text-muted-foreground">
              POS vs RIVAC. Total POS: {formatBs(totalRetencionesPOS_Bs)} ({formatUSD(totalRetencionesPOS_USD)})
            </p>
          </CardHeader>
          <CardContent>
            {(!retentions || retentions.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {totalRetencionesPOS_USD > 0 ? "Cargando retenciones..." : "Sin retenciones en esta sesión"}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Factura</th>
                        <th className="pb-2 font-medium">Cliente</th>
                        <th className="pb-2 font-medium text-right">Según POS (Bs)</th>
                        <th className="pb-2 font-medium text-right">Registrada RIVAC (Bs)</th>
                        <th className="pb-2 font-medium text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {retentions.map((r) => (
                        <tr key={r.invoiceNumber} className="border-b">
                          <td className="py-2 font-medium">{r.invoiceNumber}</td>
                          <td className="py-2">{r.partner}</td>
                          <td className="py-2 text-right">{formatBs(Math.round(r.posTotalUSD * rate * 100) / 100)}</td>
                          <td className="py-2 text-right">
                            {r.status === "registered" ? formatBs(Math.round(r.retentionAmount * rate * 100) / 100) : "—"}
                          </td>
                          <td className="py-2 text-center">
                            <Badge className={r.status === "registered"
                              ? "text-green-700 bg-green-50 border-green-200"
                              : "text-amber-700 bg-amber-50 border-amber-200"
                            }>
                              {r.status === "registered" ? "Registrada" : "Pendiente"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-4 text-sm border-t pt-3">
                  <div>
                    <span className="text-muted-foreground">Total POS:</span>
                    <p className="font-semibold">{formatBs(totalRetencionesPOS_Bs)}</p>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Total registradas RIVAC:</span>
                    <p className="font-semibold">{formatBs(totalRetencionesRegistradas_Bs)}</p>
                  </div>
                </div>
              </>
            )}
            <div className="mt-3 border-t pt-3">
              <Label className="text-xs">Total retenciones verificado real (Bs)</Label>
              <Input
                type="number" step="0.01"
                className="w-48 mt-1"
                value={retencionesReal || ""}
                onChange={(e) => setRetencionesReal(Number(e.target.value) || 0)}
                disabled={!!isLocked}
                placeholder="Bs"
              />
            </div>
          </CardContent>
        </Card>

        {/* Section 5: Ventas a Crédito y Abonos */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">5. Ventas a Crédito y Abonos</CardTitle>
            <p className="text-xs text-muted-foreground">
              Total crédito POS: {formatBs(totalCreditoPOS_Bs)} ({formatUSD(totalCreditoPOS_USD)})
            </p>
          </CardHeader>
          <CardContent>
            {(!creditSales || creditSales.length === 0) ? (
              <p className="text-sm text-muted-foreground text-center py-4">
                {totalCreditoPOS_USD > 0 ? "Cargando ventas a crédito..." : "Sin ventas a crédito en esta sesión"}
              </p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Factura</th>
                        <th className="pb-2 font-medium">Cliente</th>
                        <th className="pb-2 font-medium text-right">Total Fact. (Bs)</th>
                        <th className="pb-2 font-medium text-right">Abonos (Bs)</th>
                        <th className="pb-2 font-medium text-right">Retención (Bs)</th>
                        <th className="pb-2 font-medium text-right">Saldo (Bs)</th>
                        <th className="pb-2 font-medium">Vía</th>
                        <th className="pb-2 font-medium text-center">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {creditSales.map((c) => {
                        const isPending = c.residual > 0 || c.paymentState !== "paid";
                        const hasExcedente = c.excedenteUsd > 0;
                        const residualBs = Math.round(c.residual * rate * 100) / 100;
                        return (
                        <tr key={c.invoiceNumber} className={`border-b ${isPending ? "bg-amber-50" : ""} ${hasExcedente ? "bg-green-50" : ""}`}>
                          <td className="py-2 font-medium">{c.invoiceNumber}</td>
                          <td className="py-2">{c.partner}</td>
                          <td className="py-2 text-right">{formatBs(Math.round(c.invoiceTotal * rate * 100) / 100)}</td>
                          <td className="py-2 text-right text-green-700">{c.abonoAmount > 0 ? formatBs(c.abonoAmountBs > 0 ? c.abonoAmountBs : Math.round(c.abonoAmount * rate * 100) / 100) : "—"}</td>
                          <td className="py-2 text-right">{c.retentionAmountPOS > 0 ? formatBs(Math.round(c.retentionAmountPOS * rate * 100) / 100) : "—"}</td>
                          <td className={`py-2 text-right font-medium ${residualBs < 0 ? "text-green-700" : residualBs > 0 ? "text-amber-700" : ""}`}>
                            {residualBs !== 0 ? formatBs(residualBs) : "—"}
                          </td>
                          <td className="py-2 text-xs">{c.abonoJournal}</td>
                          <td className="py-2 text-center">
                            <Badge className={hasExcedente ? "bg-green-100 text-green-800" : getPaymentStateColor(c.paymentState)}>
                              {hasExcedente ? `Excedente ${c.excedenteConcepto}` : getPaymentStateLabel(c.paymentState)}
                            </Badge>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 border-t pt-3 space-y-2">
                  <div className="grid grid-cols-3 gap-4 text-sm">
                    <div>
                      <span className="text-muted-foreground">Total Crédito POS:</span>
                      <p className="font-semibold">{formatBs(totalCreditoPOS_Bs)}</p>
                      <p className="text-xs text-muted-foreground">{formatUSD(totalCreditoPOS_USD)}</p>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Total Abonos del día:</span>
                      <p className="font-semibold text-green-700">{formatBs(totalAbonosRecibidos_Bs)}</p>
                      <p className="text-xs text-muted-foreground">{formatUSD(totalAbonosRecibidos)}</p>
                    </div>
                    <div className="bg-amber-50 rounded p-2">
                      <span className="text-amber-700 text-xs font-medium">CxC Pendientes:</span>
                      <p className="font-bold text-amber-900 text-lg">{formatBs(totalCxCPendiente_Bs)}</p>
                      <p className="text-xs text-muted-foreground">{formatUSD(totalCxCPendiente)}</p>
                    </div>
                  </div>
                  {/* CxC Pendientes detail — today's invoices only */}
                  {creditSales && creditSales.filter((c) => c.residual > 0).length > 0 && (
                    <div className="mt-2 bg-amber-50 rounded p-2 border border-amber-200">
                      <p className="text-xs font-semibold text-amber-800 mb-1">Detalle CxC Pendientes:</p>
                      {creditSales.filter((c) => c.residual > 0).map((c) => (
                        <p key={c.invoiceNumber} className="text-xs text-amber-900">
                          {c.invoiceNumber} — {c.partner} — {formatBs(Math.round((c.residual) * rate * 100) / 100)}
                        </p>
                      ))}
                    </div>
                  )}
                  {/* Payment method summary for abonos */}
                  {creditSales && creditSales.filter((c) => c.abonoAmount > 0).length > 0 && (() => {
                    const methodTotalsBs: Record<string, number> = {};
                    for (const c of creditSales) {
                      if (c.abonoAmount > 0 && c.abonoJournal && c.abonoJournal !== "—") {
                        // Use per-journal breakdown for accurate amounts
                        if (c.abonoByJournal && Object.keys(c.abonoByJournal).length > 0) {
                          for (const [j, amounts] of Object.entries(c.abonoByJournal)) {
                            // If bs > 0, it's a VES journal — use directly; otherwise convert USD
                            const bs = amounts.bs > 0 ? amounts.bs : amounts.usd * rate;
                            methodTotalsBs[j] = (methodTotalsBs[j] || 0) + bs;
                          }
                        } else {
                          // Fallback for old data without per-journal breakdown
                          const journals = c.abonoJournal.split(", ");
                          const totalBs = c.abonoAmountBs > 0 ? c.abonoAmountBs : c.abonoAmount * rate;
                          const perJournal = totalBs / journals.length;
                          for (const j of journals) {
                            methodTotalsBs[j] = (methodTotalsBs[j] || 0) + perJournal;
                          }
                        }
                      }
                    }
                    const entries = Object.entries(methodTotalsBs);
                    if (entries.length === 0) return null;
                    const grandTotal = entries.reduce((s, [, v]) => s + v, 0);
                    return (
                      <div className="mt-3 bg-green-50 rounded p-3 border border-green-200">
                        <p className="text-xs font-semibold text-green-800 mb-2">Resumen Abonos por Método de Pago:</p>
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-green-200 text-left">
                              <th className="pb-1 font-medium text-green-800">Método</th>
                              <th className="pb-1 font-medium text-right text-green-800">Total (Bs)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map(([method, total]) => (
                              <tr key={method} className="border-b border-green-100">
                                <td className="py-1">{method}</td>
                                <td className="py-1 text-right">{formatBs(Math.round(total * 100) / 100)}</td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-green-300 font-bold">
                              <td className="py-1">TOTAL ABONOS</td>
                              <td className="py-1 text-right">{formatBs(Math.round(grandTotal * 100) / 100)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    );
                  })()}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Section 6: Saldos a Favor y Delivery */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">6. Saldos a Favor y Delivery</CardTitle>
            <p className="text-xs text-muted-foreground">
              Créditos de transacciones anteriores + Delivery cobrado (no facturado). El delivery queda como saldo a favor del cliente y se rebaja mediante asiento contable.
            </p>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Sub-sección: Saldos a Favor (créditos previos) */}
            <div>
              <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Saldos a Favor (Créditos Previos)</Label>
              <p className="text-xs text-muted-foreground mb-2">
                POS: {formatBs(totalSaldoFavorPOS_Bs)} ({formatUSD(totalSaldoFavorPOS_USD)})
              </p>
              {/* Detail table */}
              {saldoFavorDetail && saldoFavorDetail.length > 0 && (
                <div className="mb-3 overflow-x-auto">
                  <table className="w-full text-sm border-collapse">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="py-1 pr-2">Factura</th>
                        <th className="py-1 pr-2">Cliente</th>
                        <th className="py-1 pr-2 text-right">Monto ($)</th>
                        <th className="py-1 text-right">Monto (Bs)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {saldoFavorDetail.map((row, idx) => (
                        <tr key={idx} className="border-b border-dashed">
                          <td className="py-1 pr-2 font-mono text-xs">{row.invoiceNumber || row.orderName}</td>
                          <td className="py-1 pr-2">{row.partner || "—"}</td>
                          <td className="py-1 pr-2 text-right">{formatUSD(row.amount)}</td>
                          <td className="py-1 text-right">{formatBs(row.amountBs)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <Label className="text-xs">Según POS (Bs)</Label>
                  <p className="font-semibold text-lg mt-1">{formatBs(totalSaldoFavorPOS_Bs)}</p>
                </div>
                <div>
                  <Label className="text-xs">Verificado real (Bs)</Label>
                  <Input
                    type="number" step="0.01"
                    className="mt-1"
                    value={saldoFavorReal || ""}
                    onChange={(e) => setSaldoFavorReal(Number(e.target.value) || 0)}
                    disabled={!!isLocked}
                    placeholder="Bs"
                  />
                </div>
                <div>
                  <Label className="text-xs">Observación</Label>
                  <Input
                    className="mt-1"
                    value={saldoFavorObs}
                    onChange={(e) => setSaldoFavorObs(e.target.value)}
                    disabled={!!isLocked}
                    placeholder="Observación"
                  />
                </div>
              </div>
            </div>

            {/* Sub-sección: Delivery Cobrado (no facturado) */}
            {deliveryDifMetodos.length > 0 && (
              <div className="border-t pt-4">
                <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Delivery Cobrado (No Facturado — Saldo a Favor del Cliente)</Label>
                <p className="text-xs text-muted-foreground mb-2">
                  Monto cobrado en caja pero NO facturado. Queda como saldo a favor del cliente y se rebaja mediante asiento contable de administración.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left">
                        <th className="pb-2 font-medium">Método</th>
                        <th className="pb-2 font-medium text-right">POS (USD)</th>
                        <th className="pb-2 font-medium text-right">POS (Bs)</th>
                        <th className="pb-2 font-medium">Órdenes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {deliveryDifMetodos.map((m) => {
                        const fpPayment = fiscalSummary?.payments?.find(p => p.methodId === m.metodoId);
                        const refs = fpPayment?.orderRefs || [];
                        return (
                          <tr key={m.metodoId} className="border-b bg-blue-50">
                            <td className="py-2 font-medium">
                              {getMethodDisplayName(m.metodoId, m.metodoNombre)}
                            </td>
                            <td className="py-2 text-right text-muted-foreground">{formatUSD(m.montoPOS_USD)}</td>
                            <td className="py-2 text-right font-medium">{formatBs(m.montoPOS_Bs)}</td>
                            <td className="py-2 text-xs text-muted-foreground">{refs.length > 0 ? refs.join(", ") : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {fiscalSummary?.companionSessionName && deliveryDifMetodos.some(m => {
                    const fp = fiscalSummary?.payments?.find(p => p.methodId === m.metodoId);
                    return fp && fp.companionAmountUSD && fp.companionAmountUSD > 0;
                  }) && (
                    <div className="mt-2 bg-amber-50 border border-amber-200 rounded p-2 text-xs text-amber-800">
                      <p className="font-semibold mb-1">Desglose por caja (Delivery):</p>
                      {deliveryDifMetodos.map(m => {
                        const fp = fiscalSummary?.payments?.find(p => p.methodId === m.metodoId);
                        if (!fp || !fp.companionAmountUSD || fp.companionAmountUSD <= 0) return null;
                        return (
                          <div key={m.metodoId} className="flex justify-between">
                            <span>{getMethodDisplayName(m.metodoId, m.metodoNombre)}:</span>
                            <span>
                              {formatUSD(fp.mainAmountUSD || 0)} (Caja) + <span className="text-amber-700">{formatUSD(fp.companionAmountUSD)}</span> ({fiscalSummary.companionCajaName || "CASHEA"}) = {formatUSD(fp.totalUSD)}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div className="mt-2 text-right text-sm font-medium">
                  Total Delivery (Saldo a Favor): <strong className="text-blue-700">{formatBs(totalDeliveryDifPOS_Bs)}</strong>
                </div>
                <div className="mt-1 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
                  <strong>Nota contable:</strong> Este monto fue cobrado en caja pero NO se facturó. Queda como saldo a favor del cliente. El equipo de administración lo rebaja mediante asiento contable (pago al prestador del servicio de transporte).
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Deducciones: Manual deductions only (delivery moved to Section 6) */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">7. Deducciones Manuales</CardTitle>
                <p className="text-xs text-muted-foreground">Retenciones, notas de crédito y otras deducciones manuales. Todos los montos en Bs. (El delivery está en la Sección 6 como saldo a favor).</p>
              </div>
              {!isLocked && (
                <Button variant="outline" size="sm" onClick={addDeduccion}>
                  <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {/* Manual deductions */}
            {deducciones.length > 0 && (
              <div className="space-y-3">
                {deducciones.map((d, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end border-b pb-3">
                    <div>
                      <Label className="text-xs">Tipo</Label>
                      <Select value={d.tipo} onValueChange={(v) => updateDeduccion(idx, "tipo", v)} disabled={!!isLocked}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DEDUCTION_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Descripción</Label>
                      <Input value={d.descripcion} onChange={(e) => updateDeduccion(idx, "descripcion", e.target.value)} disabled={!!isLocked} />
                    </div>
                    <div>
                      <Label className="text-xs">Monto (Bs)</Label>
                      <Input type="number" step="0.01" value={d.monto || ""} onChange={(e) => updateDeduccion(idx, "monto", Number(e.target.value) || 0)} disabled={!!isLocked} />
                    </div>
                    <div>
                      <Label className="text-xs">Comprobante</Label>
                      <Input value={d.comprobante} onChange={(e) => updateDeduccion(idx, "comprobante", e.target.value)} disabled={!!isLocked} />
                    </div>
                    {!isLocked && (
                      <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeDeduccion(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {deducciones.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">Sin deducciones manuales</p>
            )}
          </CardContent>
        </Card>

        {/* Section 8: Summary */}
        <Card className={`border-2 ${Math.abs(diferencia) < CUADRE_TOLERANCE_BS && ventaNetaZ > 0 ? "border-green-300" : ventaNetaZ > 0 ? "border-red-300" : "border-gray-300"}`}>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">8. Resumen del Cuadre</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {/* Left: Según Odoo POS */}
              <div className="space-y-2">
                <h3 className="font-semibold text-sm border-b pb-1">SEGÚN ODOO POS</h3>
                <div className="flex justify-between text-sm">
                  <span>Pagos directos:</span>
                  <span>{formatBs(displayDirectoPOS)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Retenciones IVA:</span>
                  <span>{formatBs(displayRetencionesPOS)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Ventas a crédito:</span>
                  <span>{formatBs(displayCreditoPOS)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Saldos a favor:</span>
                  <span>{formatBs(displaySaldoFavorPOS)}</span>
                </div>
                {totalDeliveryDifPOS_Bs !== 0 && (
                  <div className="flex justify-between text-sm">
                    <span>Deducciones (Delivery/Dif.):</span>
                    <span>{formatBs(totalDeliveryDifPOS_Bs)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm font-bold border-t pt-1">
                  <span>TOTAL POS:</span>
                  <span>{formatBs(summaryPOS)}</span>
                </div>
              </div>

              {/* Right: Verificado Real */}
              <div className="space-y-2">
                <h3 className="font-semibold text-sm border-b pb-1">VERIFICADO REAL</h3>
                <div className="flex justify-between text-sm">
                  <span>Pagos directos:</span>
                  <span>{formatBs(totalDirectMetodosReal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Retenciones registradas:</span>
                  <span>{formatBs(displayRetencionesReal)}</span>
                </div>
                              {displayRetencionesPorCobrar > 0 && (
              <div className="flex justify-between text-sm">
                <span>Retenciones por cobrar:</span>
                <span className="text-amber-600">{formatBs(displayRetencionesPorCobrar)}</span>
              </div>
              )}
                <div className="flex justify-between text-sm">
                  <span>Abonos crédito recibidos:</span>
                  <span className="text-green-700">{formatBs(displayAbonosReal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>CxC pendientes:</span>
                  <span className="text-amber-700">{formatBs(Math.abs(displayCxCPendiente))}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span>Saldos a favor:</span>
                  <span>{formatBs(displaySaldoFavorReal)}</span>
                </div>
                {(totalDeliveryDifPOS_Bs !== 0 || displayDeducciones !== 0) && (
                  <div className="flex justify-between text-sm">
                    <span>Deducciones (Delivery/Dif.):</span>
                    <span>{formatBs(totalDeliveryDifPOS_Bs + displayDeducciones)}</span>
                  </div>
                )}
                <div className="flex justify-between text-sm">
                  <span>Ajustes manuales:</span>
                  <span>{formatBs(displayAjustesManuales)}</span>
                </div>
                <div className="flex justify-between text-sm font-bold border-t pt-1">
                  <span>TOTAL VERIFICADO:</span>
                  <span>{formatBs(summaryReal)}</span>
                </div>
              </div>
            </div>

            {/* Bottom: Reconciliation result */}
            <div className="mt-4 border-t pt-4 space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                  <span className="text-muted-foreground">Total Métodos + Deducciones (Bs):</span>
                  <p className="font-semibold">{formatBs(displayTotalJustificado)}</p>
                </div>
                <div className="bg-blue-50 rounded p-2">
                  <span className="text-blue-700 text-xs">Venta Neta Z (Bs) — referencia fiscal:</span>
                  <p className="font-bold text-blue-900">{formatBs(ventaNetaZ)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Diferencia:</span>
                  <p className={`font-bold text-lg ${Math.abs(displayDiferencia) < 0.01 && ventaNetaZ > 0 ? "text-green-600" : ventaNetaZ > 0 ? "text-red-600" : ""}`}>
                    {formatBs(displayDiferencia)}
                  </p>
                  {ventaNetaZ > 0 && (
                    <Badge className={`mt-1 ${Math.abs(displayDiferencia) < CUADRE_TOLERANCE_BS ? getStatusColor("cuadrado") : existingCuadre?.cerradoPor ? getStatusColor("descuadrado") : getStatusColor("pendiente")}`}>
                      {Math.abs(displayDiferencia) < CUADRE_TOLERANCE_BS ? "CUADRADO" : existingCuadre?.cerradoPor ? "DESCUADRADO" : "PENDIENTE"}
                    </Badge>
                  )}
                </div>
              </div>
              {/* Leyenda explicativa sobre la diferencia */}
              {ventaNetaZ > 0 && Math.abs(displayDiferencia) >= 0.01 && (
                <div className="mt-3 bg-gray-50 rounded p-3 border border-gray-200 text-xs text-gray-700 space-y-1">
                  <p className="font-semibold text-gray-900">¿Qué significa esta diferencia?</p>
                  {displayDiferencia > 0 ? (
                    <>
                      <p><span className="font-medium text-red-700">Sobra dinero ({formatBs(displayDiferencia)}):</span> Se justificó más de lo reportado en Z.</p>
                      <p>Posibles causas: pago duplicado, cobro no facturado, monto de método verificado mayor al real, o abono registrado que no corresponde al día.</p>
                    </>
                  ) : (
                    <>
                      <p><span className="font-medium text-red-700">Falta dinero ({formatBs(Math.abs(displayDiferencia))}):</span> No se logró justificar el total de la Venta Neta Z.</p>
                      <p>Posibles causas: pago no registrado, método de pago con monto menor al real, retención o crédito sin verificar, o deducción faltante.</p>
                    </>
                  )}
                  <p className="text-gray-500 italic">Use la sección "Ajustes y Excepciones" para registrar diferencias que no se pueden conciliar automáticamente.</p>
                </div>
              )}
              <div className="text-sm text-amber-700 border-t pt-2">
                <span>Dif. Cambiaria (info contabilidad): </span>
                <strong>{formatBs(difCambiaria)}</strong>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Section 9: Ajustes y Excepciones */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base">9. Ajustes y Excepciones</CardTitle>
                <p className="text-xs text-muted-foreground">Excepciones no registradas en Odoo. Todos los montos en Bs.</p>
              </div>
              {!isLocked && (
                <Button variant="outline" size="sm" onClick={addAjuste}>
                  <Plus className="h-4 w-4 mr-1" /> Agregar
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {ajustes.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Sin ajustes manuales</p>
            ) : (
              <div className="space-y-3">
                {ajustes.map((a, idx) => (
                  <div key={idx} className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end border-b pb-3">
                    <div>
                      <Label className="text-xs">Tipo</Label>
                      <Select value={a.tipo} onValueChange={(v) => updateAjuste(idx, "tipo", v)} disabled={!!isLocked}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {AJUSTE_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">Descripción</Label>
                      <Input value={a.descripcion} onChange={(e) => updateAjuste(idx, "descripcion", e.target.value)} disabled={!!isLocked} />
                    </div>
                    <div>
                      <Label className="text-xs">Monto (Bs)</Label>
                      <Input type="number" step="0.01" value={a.monto || ""} onChange={(e) => updateAjuste(idx, "monto", Number(e.target.value) || 0)} disabled={!!isLocked} />
                    </div>
                    <div>
                      <Label className="text-xs">Referencia</Label>
                      <Input value={a.referencia} onChange={(e) => updateAjuste(idx, "referencia", e.target.value)} disabled={!!isLocked} />
                    </div>
                    {!isLocked && (
                      <Button variant="ghost" size="icon" className="text-red-500" onClick={() => removeAjuste(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                ))}
                <div className="text-right text-sm font-medium pt-2">
                  Total ajustes: <strong>{formatBs(displayAjustesManuales)}</strong>
                </div>
              </div>
            )}
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
              disabled={!!isLocked}
              placeholder="Observaciones adicionales..."
            />
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex flex-wrap gap-2 no-print pb-8">
          {!isLocked && (
            <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              <Save className="h-4 w-4 mr-1" />
              {saveMutation.isPending ? "Guardando..." : "Guardar"}
            </Button>
          )}
          {canClose && !isNew && (
            <Button variant="outline" onClick={() => closeMutation.mutate()} disabled={closeMutation.isPending}>
              <Lock className="h-4 w-4 mr-1" /> Cerrar Cuadre
            </Button>
          )}
          {canReopen && (
            <Button variant="outline" onClick={() => reopenMutation.mutate()} disabled={reopenMutation.isPending}>
              <RotateCcw className="h-4 w-4 mr-1" /> Reabrir
            </Button>
          )}
          {canDelete && !isNew && (
            <Button variant="destructive" onClick={() => {
              if (confirm("¿Seguro que deseas eliminar este cuadre?")) deleteMutation.mutate();
            }} disabled={deleteMutation.isPending}>
              <Trash2 className="h-4 w-4 mr-1" /> Eliminar
            </Button>
          )}
        </div>
      </main>
    </div>
  );
}
