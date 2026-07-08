import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, formatUSD, getStatusLabel, formatDateTime, calculateEstado } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";
import type { CreditSaleRow, RetentionRow } from "@shared/schema";

// ─── Clasificación de métodos ────────────────────────────────────────────────
const RETENCION_IVA_ID = 26;
const SALDO_FAVOR_ID   = 25;
const CASHEA_ID        = 42;

// Solo IDs pay_later reales. ID 38 se llama "Venta a crédito" en Odoo pero es
// P.Movil BNC (type=bank) — es un ingreso directo, NO va a la sección de CxC.
const CREDITO_IDS = new Set([14, 33]);

// Métodos cuyo nombre en Odoo es incorrecto y debe ignorarse para la clasificación
const NOMBRE_OVERRIDE_IDS = new Set([38, 42]); // 38=P.Movil BNC, 42=PXC Cashea

/** Overrides de nombre igual que el formulario */
const METHOD_NAME_OVERRIDES: Record<number, string> = {
  38: "P.Movil BNC",
  42: "PXC Cashea",
};
function getMethodName(m: any): string {
  return METHOD_NAME_OVERRIDES[m.metodoId] || m.metodoNombre || "";
}

/** Nombre contiene "delivery" o "diferencia" (case-insensitive) */
function isDeliveryOrDif(name: string) {
  const n = (name || "").toLowerCase();
  return n.includes("delivery") || n.includes("diferencia");
}

/** Método pay_later de crédito real — solo por ID, nunca por nombre.
 *  ID 38 queda EXCLUIDO aunque Odoo lo nombre "Venta a crédito". */
function isVentaCredito(m: any) {
  if (NOMBRE_OVERRIDE_IDS.has(m.metodoId)) return false; // nombre no es fiable para estos IDs
  if (CREDITO_IDS.has(m.metodoId)) return true;
  const n = (m.metodoNombre || "").toLowerCase();
  return n.includes("crédito") || n.includes("credito");
}

/** Métodos excluidos de Sección II — aparecen en sus propias secciones */
function isExcluded(m: any) {
  return (
    m.metodoId === RETENCION_IVA_ID ||
    m.metodoId === SALDO_FAVOR_ID   ||
    m.metodoId === CASHEA_ID        ||
    isVentaCredito(m)               ||
    isDeliveryOrDif(m.metodoNombre)
  );
}

// ─── Componentes de presentación ────────────────────────────────────────────
function HR() {
  return <div style={{ borderTop: "1px solid #ccc", margin: "5px 0" }} />;
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: "#0A4083", color: "#fff", fontWeight: 700, fontSize: 10,
      letterSpacing: "0.05em", textTransform: "uppercase",
      padding: "3px 6px", marginBottom: 4,
    }}>
      {children}
    </div>
  );
}

function SubHead({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      fontSize: 9, fontWeight: 700, color: "#444",
      borderBottom: "1px solid #ddd", paddingBottom: 2, marginBottom: 3,
    }}>
      {children}
    </div>
  );
}

function Row({ label, value, bold, indent, valueColor }: {
  label: string; value: string;
  bold?: boolean; indent?: boolean; valueColor?: string;
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between",
      fontSize: 10, fontWeight: bold ? 700 : 400,
      paddingLeft: indent ? 10 : 0, marginBottom: 1,
    }}>
      <span>{label}</span>
      <span style={{ color: valueColor }}>{value}</span>
    </div>
  );
}

// ─── Componente principal ────────────────────────────────────────────────────
export default function CuadreReport() {
  const [, params] = useRoute("/cuadre/:id/report");
  const [, setLocation] = useLocation();
  const id = params?.id;

  const { data: cuadre, isLoading } = useQuery({
    queryKey: [`/api/cuadres/${id}`],
    enabled: !!id,
    staleTime: 0,
    queryFn: async () => {
      const r = await fetch(`/api/cuadres/${id}`);
      if (!r.ok) throw new Error("Error al cargar cuadre");
      return r.json();
    },
  });

  if (isLoading) return <div className="p-8 text-center">Cargando...</div>;
  if (!cuadre)   return <div className="p-8 text-center">Cuadre no encontrado</div>;

  // ── Datos derivados ──────────────────────────────────────────────────────
  const tasa = cuadre.tasaDia || 0;
  const metodos: any[] = cuadre.metodos || [];

  const directos       = metodos.filter(m => !isExcluded(m));
  const deliveryMtds   = metodos.filter(m => isDeliveryOrDif(m.metodoNombre));
  const creditoMtds    = metodos.filter(m => isVentaCredito(m));
  const casheaMtds     = metodos.filter(m => m.metodoId === CASHEA_ID);

  const creditSales: CreditSaleRow[] = cuadre.creditSales || [];
  const retentions: RetentionRow[]   = cuadre.retenciones  || [];

  // ── Totales calculados desde los arrays de items ──────────────────────────
  // Se calculan desde los arrays guardados (métodos, creditSales, retenciones)
  // para que la Sección V sume exactamente los items que muestra. NO se usan
  // los valores pre-computados del formulario (cuadre.totalXxx) porque tienen
  // una agrupación/orden diferente sin el enfoque financiero necesario.

  const totalDirectosPOS  = directos.reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);
  const totalDirectosReal = directos.reduce((s, m) => s + (m.montoReal    || 0), 0);
  const totalDeliveryPOS  = deliveryMtds.reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);
  const totalCasheaPOS    = casheaMtds.reduce((s, m) => s + (m.montoPOS_Bs  || 0), 0);
  const totalCasheaReal   = casheaMtds.reduce((s, m) => s + (m.montoReal    || 0), 0);
  const totalCreditoPOS   = creditoMtds.reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);

  // Abonos y CxC pendiente desde creditSales (USD → Bs con tasa del día)
  const totalAbonos = (creditSales?.length ?? 0) > 0
    ? Math.round(creditSales.reduce((s, c) => {
        const v = c.abonoAmountBs > 0 ? c.abonoAmountBs : (c.abonoAmount || 0) * tasa;
        return s + v;
      }, 0) * 100) / 100
    : (cuadre.totalAbonosReal || 0);

  const totalCxCPendiente = (creditSales?.length ?? 0) > 0
    ? Math.round(creditSales.reduce((s, c) => s + ((c.residual || 0) * tasa), 0) * 100) / 100
    : (cuadre.totalCxCPendiente || 0);

  // Retenciones desde retentions array
  const totalRetPOS = (retentions?.length ?? 0) > 0
    ? Math.round(retentions.reduce((s, r) => s + ((r.posTotalUSD || 0) * tasa), 0) * 100) / 100
    : (cuadre.totalRetencionesPOS || 0);

  const totalRetReal = cuadre.totalRetencionesReal || 0;   // ← campo manual del usuario
  const retPorCobrar = Math.max(0, Math.round((totalRetPOS - totalRetReal) * 100) / 100);

  // Saldos a favor desde array
  const totalSFavorPOS = (cuadre.saldosFavor?.length ?? 0) > 0
    ? Math.round(cuadre.saldosFavor.reduce((s, sf) => s + (sf.amountBs || sf.amount * tasa), 0) * 100) / 100
    : (cuadre.totalSaldoFavorPOS || 0);

  const totalSFavorReal = cuadre.totalSaldoFavorReal || 0;  // ← campo manual del usuario

  // Ajustes manuales desde array
  const totalAjustes = (cuadre.ajustesManuales?.length ?? 0) > 0
    ? cuadre.ajustesManuales.reduce((s, a) => s + (a.monto || 0), 0)
    : (cuadre.totalAjustesManuales || 0);

  // Deducciones manuales (ítems adicionales de delivery/diferencia)
  const totalDeduccionesManuales = (cuadre.deducciones?.length ?? 0) > 0
    ? cuadre.deducciones.reduce((s, d) => s + (d.monto || 0), 0)
    : 0;
  const ventaNetaZ        = cuadre.ventaNetaZ           || 0;
  const difCambiaria      = cuadre.difCambiaria         || 0;

  // ── CÁLCULO AUTORITATIVO DEL TOTAL REAL Y DIFERENCIA ──────────────────────
  // Se recalcula aquí con la MISMA fórmula que usa el formulario (summaryReal).
  // NO se usa cuadre.diferencia ni cuadre.totalJustificadoReal de la DB porque
  // pueden estar desactualizados (guardados antes del fix del doble conteo).
  //
  // Fórmula equivalente a CuadreForm.tsx summaryReal.
  // NOTA: el form incluye Cashea (ID 42) en totalDirectMetodosReal, pero el reporte
  // lo mueve a Section III como línea separada. Por eso se suma totalCasheaReal aparte.
  //   totalDirectosReal
  //   + totalCasheaReal   (migrado de directos a línea propia en Secc. III)
  //   + totalRetReal      (retenciones reales — campo manual)
  //   + retPorCobrar
  //   + totalAbonos
  //   + totalCxCPendiente
  //   + totalSFavorReal
  //   + totalDeducciones  (deliveryPOS + deducciones manuales)
  //   + totalAjustes
  const totalDeducciones = Math.round((totalDeliveryPOS + totalDeduccionesManuales) * 100) / 100;

  const totalReal = Math.round((
    totalDirectosReal  +
    totalCasheaReal    +
    totalRetReal       +
    totalAbonos        +
    Math.abs(totalCxCPendiente)  +  // ← Valor absoluto (sin signo negativo)
    totalSFavorReal    +
    totalDeducciones   +
    totalAjustes
  ) * 100) / 100;

  // Diferencia: totalReal - ventaNetaZ, ajustada por la brecha entre ret. procesadas y ret. IVA
  const diferencia  = Math.round((totalReal - ventaNetaZ - (totalRetReal - totalRetPOS)) * 100) / 100;
  // Estado calculado con misma lógica que formulario/dashboard/historial
  const estadoVisible = calculateEstado(cuadre);
  const esCuadrado = estadoVisible === "cuadrado";

  const fechaFormateada = cuadre.fecha
    ? new Date(cuadre.fecha + "T12:00:00").toLocaleDateString("es-VE", {
        weekday: "long", year: "numeric", month: "long", day: "numeric",
      })
    : cuadre.fecha;

  // helper: calcula cantidad Z entre primera/última
  function cantZ(primera: string, ultima: string) {
    const a = parseInt((primera || "").replace(/\D/g, ""), 10);
    const b = parseInt((ultima  || "").replace(/\D/g, ""), 10);
    return (!isNaN(a) && !isNaN(b) && b >= a) ? `${b - a + 1}` : "—";
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Toolbar */}
      <div className="max-w-[216mm] mx-auto p-4 flex justify-between items-center no-print">
        <Button variant="ghost" size="sm" onClick={() => setLocation(`/cuadre/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
      </div>

      {/* ══════════════════════ CUERPO DEL REPORTE ══════════════════════════ */}
      <div
        id="report-content"
        className="max-w-[216mm] mx-auto bg-white print:p-0"
        style={{ padding: "14px 18px", fontFamily: "Arial, sans-serif" }}
      >
        {/* ── ENCABEZADO ─────────────────────────────────────────────────── */}
        <div style={{ textAlign: "center", borderBottom: "2px solid #0A4083", paddingBottom: 6, marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0A4083" }}>
            CUADRE DE CAJA — REPORTE FINANCIERO
          </div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 1 }}>
            Global It System, C.A. — ONPROTEC
          </div>
        </div>

        {/* ── INFO GENERAL ───────────────────────────────────────────────── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1px 20px", fontSize: 10, marginBottom: 6 }}>
          <div><strong>Fecha:</strong> {fechaFormateada}</div>
          <div><strong>Sesión:</strong> {cuadre.sessionName}</div>
          <div><strong>Caja:</strong> {cuadre.caja}</div>
          <div><strong>Cajero:</strong> {cuadre.cajero}</div>
          <div><strong>Máquina Fiscal:</strong> {cuadre.serialMachine || cuadre.maquinaFiscal || "—"}</div>
          <div>
            <strong>Estado:</strong>{" "}
            <span style={{ fontWeight: 700, color: esCuadrado ? "#16a34a" : "#dc2626" }}>
              {getStatusLabel(estadoVisible)}
            </span>
          </div>
          {cuadre.cerradoPor && (
            <div style={{ gridColumn: "1 / -1" }}>
              <strong>Cerrado por:</strong> {cuadre.cerradoPor} el {formatDateTime(cuadre.cerradoEn || "")}
            </div>
          )}
        </div>

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN I — REPORTE Z
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>I. Reporte Z — Fuente Fiscal Oficial</SectionTitle>

        {/* Fila superior: montos + tasa (lado a lado) */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px", marginBottom: 4 }}>

          {/* Col izq: montos Z */}
          <div>
            <Row label="Número Z:" value={cuadre.zNumero || "—"} />
            <Row label="Venta Bruta:" value={formatBs(cuadre.ventaBrutaZ)} />
            <Row label="(–) Notas de Crédito:" value={formatBs(cuadre.notasCreditoZ)} indent />
            <div style={{ borderTop: "1px solid #999", marginTop: 2, paddingTop: 2 }}>
              <Row label="Venta Neta:" value={formatBs(ventaNetaZ)} bold />
            </div>
            <div style={{ marginTop: 3 }}>
              <Row label="Base Imponible:" value={formatBs(cuadre.baseImponibleZ)} />
              <Row label="Exento:"          value={formatBs(cuadre.exentoZ)} />
              <Row label="IVA:"             value={formatBs(cuadre.ivaZ)} />
              <Row label="IGTF Percibido:"  value={formatBs(cuadre.igtfZ)} />
            </div>
          </div>

          {/* Col der: caja de tasa */}
          <div style={{
            background: "#f0f6ff", border: "1px solid #c3d9f7",
            borderRadius: 4, padding: "6px 8px",
          }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#0A4083", marginBottom: 2 }}>
              TASA BCV DEL DÍA
            </div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#0A4083", lineHeight: 1 }}>
              Bs {tasa.toFixed(2)} / $
            </div>
            <div style={{ fontSize: 9, color: "#555", marginTop: 3 }}>
              Venta Neta Odoo: {formatUSD(cuadre.totalOdooUSD || 0)} × {tasa.toFixed(2)} = {formatBs(cuadre.totalOdooBs || 0)}
            </div>
            {Math.abs(difCambiaria) > 0.01 && (
              <div style={{ fontSize: 9, color: "#b45309", marginTop: 2 }}>
                Dif. cambiaria: <strong>{formatBs(difCambiaria)}</strong> (ajuste contable)
              </div>
            )}
          </div>
        </div>

        {/* Fila inferior: facturas y NC en 4 columnas compactas */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gap: "0 8px", background: "#f9f9f9",
          border: "1px solid #e5e5e5", borderRadius: 3,
          padding: "4px 8px", fontSize: 10, marginBottom: 4,
        }}>
          <div>
            <div style={{ fontSize: 8, color: "#888", fontWeight: 700, marginBottom: 1 }}>PRIMERA FACTURA</div>
            <div style={{ fontWeight: 600 }}>{cuadre.primeraFacturaZ || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#888", fontWeight: 700, marginBottom: 1 }}>ÚLTIMA FACTURA</div>
            <div style={{ fontWeight: 600 }}>{cuadre.ultimaFacturaZ || "—"}</div>
            <div style={{ fontSize: 8, color: "#888" }}>
              Cant: {cantZ(cuadre.primeraFacturaZ, cuadre.ultimaFacturaZ)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#888", fontWeight: 700, marginBottom: 1 }}>PRIMERA NC</div>
            <div style={{ fontWeight: 600 }}>{cuadre.primeraNCZ || "—"}</div>
          </div>
          <div>
            <div style={{ fontSize: 8, color: "#888", fontWeight: 700, marginBottom: 1 }}>ÚLTIMA NC</div>
            <div style={{ fontWeight: 600 }}>{cuadre.ultimaNCZ || "—"}</div>
            <div style={{ fontSize: 8, color: "#888" }}>
              Cant: {cantZ(cuadre.primeraNCZ, cuadre.ultimaNCZ)}
            </div>
          </div>
        </div>

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN II — INGRESOS DIRECTOS
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>II. Ingresos — Métodos de Pago Directos</SectionTitle>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 4 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={{ textAlign: "left",  padding: "3px 4px", fontWeight: 700 }}>Método</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>POS (USD)</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>POS (Bs)</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>Verificado (Bs)</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>Dif.</th>
            </tr>
          </thead>
          <tbody>
            {directos.map((m, i) => {
              const diff = m.montoReal && m.montoPOS_Bs
                ? Math.round((m.montoReal - m.montoPOS_Bs) * 100) / 100 : 0;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "2px 4px" }}>{getMethodName(m)}</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>{formatUSD(m.montoPOS_USD || 0)}</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>{formatBs(m.montoPOS_Bs || 0)}</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 600 }}>
                    {m.montoReal ? formatBs(m.montoReal) : "—"}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px",
                    color: diff === 0 ? "#555" : diff > 0 ? "#16a34a" : "#dc2626" }}>
                    {m.montoReal ? formatBs(diff) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: "2px solid #0A4083", background: "#f0f6ff" }}>
              <td style={{ padding: "3px 4px", fontWeight: 700 }}>TOTAL DIRECTOS</td>
              <td style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>
                {tasa > 0 ? formatUSD(Math.round((totalDirectosPOS / tasa) * 100) / 100) : "—"}
              </td>
              <td style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>{formatBs(totalDirectosPOS)}</td>
              <td style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>{formatBs(totalDirectosReal)}</td>
              <td style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700,
                color: Math.abs(totalDirectosReal - totalDirectosPOS) < 5 ? "#16a34a" : "#dc2626" }}>
                {formatBs(Math.round((totalDirectosReal - totalDirectosPOS) * 100) / 100)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Delivery / Diferencia */}
        {deliveryMtds.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>
              Delivery / Diferencias (contabilizado desde POS):
            </div>
            {deliveryMtds.map((m, i) => (
              <Row key={i} label={`  ${m.metodoNombre}:`} value={formatBs(m.montoPOS_Bs || 0)} indent />
            ))}
            <Row label="  Total Delivery/Dif.:" value={formatBs(totalDeliveryPOS)} bold indent />
          </div>
        )}

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN III — CxC, VENTA A CRÉDITO Y CASHEA
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>III. Cuentas por Cobrar — Crédito y Cashea</SectionTitle>

        {/* Bloque A: Venta a Crédito */}
        <div style={{ marginBottom: 6 }}>
          <SubHead>VENTA A CRÉDITO (Métodos diferidos)</SubHead>
          {creditoMtds.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 3 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left",  padding: "2px 4px" }}>Método</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (USD)</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {creditoMtds.map((m, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "2px 4px" }}>{m.metodoNombre}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>{formatUSD(m.montoPOS_USD || 0)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>{formatBs(m.montoPOS_Bs || 0)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #0A4083", background: "#f0f6ff" }}>
                  <td style={{ padding: "2px 4px", fontWeight: 700 }}>TOTAL CRÉDITO POS</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>
                    {tasa > 0 ? formatUSD(Math.round((totalCreditoPOS / tasa) * 100) / 100) : "—"}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>{formatBs(totalCreditoPOS)}</td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div style={{ fontSize: 9, color: "#aaa", marginBottom: 4 }}>Sin ventas a crédito en esta sesión</div>
          )}
          <Row label="Abonos recibidos verificados (Bs):" value={formatBs(totalAbonos)} indent />
          <Row label="CxC pendiente de cobro (Bs):" value={formatBs(Math.abs(totalCxCPendiente))} bold
            valueColor={totalCxCPendiente > 0 ? "#dc2626" : "#16a34a"} />
        </div>

        {/* Bloque B: PXC Cashea */}
        {casheaMtds.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <SubHead>PXC CASHEA (Por cobrar al operador)</SubHead>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 3 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left",  padding: "2px 4px" }}>Método</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (USD)</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (Bs)</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Verificado (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {casheaMtds.map((m, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "2px 4px" }}>PXC Cashea</td>
                    <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>{formatUSD(m.montoPOS_USD || 0)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>{formatBs(m.montoPOS_Bs || 0)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 600 }}>
                      {m.montoReal ? formatBs(m.montoReal) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #0A4083", background: "#f0f6ff" }}>
                  <td style={{ padding: "2px 4px", fontWeight: 700 }}>TOTAL CASHEA</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>
                    {tasa > 0 ? formatUSD(Math.round((totalCasheaPOS / tasa) * 100) / 100) : "—"}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>{formatBs(totalCasheaPOS)}</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>
                    {totalCasheaReal > 0 ? formatBs(totalCasheaReal) : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Bloque C: Detalle por cliente */}
        <div style={{ marginBottom: 4 }}>
          <SubHead>DETALLE POR CLIENTE</SubHead>
          {creditSales.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 4 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left",   padding: "2px 4px" }}>Factura</th>
                  <th style={{ textAlign: "left",   padding: "2px 4px" }}>Cliente</th>
                  <th style={{ textAlign: "right",  padding: "2px 4px" }}>Total Fact.</th>
                  <th style={{ textAlign: "right",  padding: "2px 4px" }}>Crédito POS</th>
                  <th style={{ textAlign: "right",  padding: "2px 4px" }}>Abono</th>
                  <th style={{ textAlign: "right",  padding: "2px 4px" }}>Saldo</th>
                  <th style={{ textAlign: "center", padding: "2px 4px" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {creditSales.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "2px 4px", fontWeight: 600 }}>{c.invoiceNumber}</td>
                    <td style={{ padding: "2px 4px" }}>{c.partner}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>{formatUSD(c.invoiceTotal || 0)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>{formatUSD(c.creditAmountPOS || 0)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>{formatUSD(c.abonoAmount || 0)}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 600,
                      color: (c.residual || 0) > 0 ? "#dc2626" : "#16a34a" }}>
                      {formatUSD(c.residual || 0)}
                    </td>
                    <td style={{ textAlign: "center", padding: "2px 4px" }}>
                      {c.paymentState === "paid" ? "Pagado"
                        : c.paymentState === "partial" ? "Parcial" : "Pendiente"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 9, color: "#aaa", marginBottom: 4 }}>Sin detalle de facturas a crédito</div>
          )}
        </div>

        {/* Saldos a favor */}
        {(totalSFavorPOS > 0 || totalSFavorReal > 0) && (
          <div style={{ marginBottom: 4 }}>
            <SubHead>SALDOS A FAVOR GENERADOS</SubHead>
            <Row label="  Saldo a favor según POS (Bs):"   value={formatBs(totalSFavorPOS)}  indent />
            <Row label="  Saldo a favor verificado (Bs):"  value={formatBs(totalSFavorReal)} bold indent valueColor="#16a34a" />
            {cuadre.saldoFavorObs && (
              <div style={{ fontSize: 9, color: "#666", paddingLeft: 10, fontStyle: "italic" }}>
                Obs: {cuadre.saldoFavorObs}
              </div>
            )}
          </div>
        )}

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN IV — RETENCIONES IVA
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>IV. Retenciones IVA Aplicadas</SectionTitle>

        <div style={{ marginBottom: 4 }}>
          <Row label="Retenciones según POS (Bs):"                      value={formatBs(totalRetPOS)} />
          <Row label="Retenciones procesadas / registradas RIVAC (Bs):" value={formatBs(totalRetReal)} indent />
          {retPorCobrar > 0 && (
            <Row label="Retenciones pendientes de cobro (Bs):" value={formatBs(retPorCobrar)} bold valueColor="#b45309" />
          )}
        </div>

        {retentions.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 4 }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ textAlign: "left",   padding: "2px 4px" }}>Factura</th>
                <th style={{ textAlign: "left",   padding: "2px 4px" }}>Cliente</th>
                <th style={{ textAlign: "right",  padding: "2px 4px" }}>Ret. POS (Bs)</th>
                <th style={{ textAlign: "right",  padding: "2px 4px" }}>Ret. RIVAC (Bs)</th>
                <th style={{ textAlign: "center", padding: "2px 4px" }}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {retentions.map((r, i) => (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "2px 4px", fontWeight: 600 }}>{r.invoiceNumber}</td>
                  <td style={{ padding: "2px 4px" }}>{r.partner}</td>
                  <td style={{ textAlign: "right", padding: "2px 4px" }}>
                    {formatBs(Math.round(r.posTotalUSD * tasa * 100) / 100)}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px" }}>
                    {r.status === "registered"
                      ? formatBs(Math.round(r.retentionAmount * tasa * 100) / 100) : "—"}
                  </td>
                  <td style={{ textAlign: "center", padding: "2px 4px", fontWeight: 600,
                    color: r.status === "registered" ? "#16a34a" : "#b45309" }}>
                    {r.status === "registered" ? "Registrada" : "Pendiente"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN V — DIFERENCIAS Y RESULTADO
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>V. Diferencias y Saldos a Favor</SectionTitle>

        {/* Cuadro comparativo POS vs Real */}
        {(() => {
          // TOTAL POS: suma de todos los items POS que se muestran en este bloque.
          // NOTA: totalDeduccionesManuales (ítems agregados por el usuario) no provienen
          // del POS, por lo tanto solo incluye totalDeliveryPOS (métodos con nombre delivery/dif).
          const totalPOSCalculado = Math.round((
            totalDirectosPOS  +
            totalRetPOS       +
            totalCreditoPOS   +
            totalSFavorPOS    +
            totalDeliveryPOS  +
            totalCasheaPOS
          ) * 100) / 100;

          return (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
              {/* SEGÚN SISTEMA (POS) */}
              <div style={{ border: "1px solid #c3d9f7", borderRadius: 4, padding: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#0A4083", marginBottom: 3 }}>SEGÚN SISTEMA (POS)</div>
                <Row label="Pagos directos:"   value={formatBs(totalDirectosPOS)} />
                <Row label="Retenciones IVA:"  value={formatBs(totalRetPOS)} />
                <Row label="Ventas a crédito:" value={formatBs(totalCreditoPOS)} />
                <Row label="Saldo a favor:"    value={formatBs(totalSFavorPOS)} />
                {totalDeliveryPOS !== 0 && <Row label="Delivery / Dif.:" value={formatBs(totalDeliveryPOS)} />}
                {totalCasheaPOS   > 0 && <Row label="PXC Cashea:"      value={formatBs(totalCasheaPOS)} />}
                <div style={{ borderTop: "1px solid #999", marginTop: 3, paddingTop: 3 }}>
                  <Row label="TOTAL POS:" value={formatBs(totalPOSCalculado)} bold />
                </div>
              </div>

              {/* VERIFICADO REAL */}
              <div style={{ border: "1px solid #c3d9f7", borderRadius: 4, padding: 6 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: "#0A4083", marginBottom: 3 }}>VERIFICADO REAL</div>
                <Row label="Pagos directos:"         value={formatBs(totalDirectosReal)} />
                <Row label="Retenciones procesadas:" value={formatBs(totalRetReal)} />
                {retPorCobrar > 0 && (
                  <Row label="Ret. por cobrar:" value={formatBs(retPorCobrar)} valueColor="#b45309" />
                )}
                <Row label="Abonos CxC recibidos:" value={formatBs(totalAbonos)} />
                <Row label="CxC pendiente:"        value={formatBs(Math.abs(totalCxCPendiente))}
                  valueColor={totalCxCPendiente > 0 ? "#dc2626" : undefined} />
                <Row label="Saldo a favor:"        value={formatBs(totalSFavorReal)} />
                {totalDeliveryPOS !== 0 && <Row label="Delivery / Dif. (POS):" value={formatBs(totalDeliveryPOS)} />}
                {totalDeduccionesManuales !== 0 && <Row label="Deducciones manuales:" value={formatBs(totalDeduccionesManuales)} />}
                {totalCasheaReal  > 0 && <Row label="PXC Cashea:"      value={formatBs(totalCasheaReal)} />}
                {totalAjustes    !== 0 && <Row label="Ajustes manuales:" value={formatBs(totalAjustes)} />}
                <div style={{ borderTop: "1px solid #999", marginTop: 3, paddingTop: 3 }}>
                  <Row label="TOTAL REAL:" value={formatBs(totalReal)} bold />
                </div>
              </div>
            </div>
          );
        })()}

        {/* Ajustes manuales detalle */}
        {(cuadre.ajustesManuales || []).length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>Ajustes manuales:</div>
            {(cuadre.ajustesManuales || []).map((a: any, i: number) => (
              <Row key={i} label={`  ${a.descripcion || "Ajuste"}:`} value={formatBs(a.monto)} indent />
            ))}
          </div>
        )}

        {/* Resultado */}
          <div style={{
            border: `2px solid ${esCuadrado ? "#16a34a" : "#dc2626"}`,
            borderRadius: 6, padding: 8,
            background: esCuadrado ? "#f0fdf4" : "#fef2f2",
            marginBottom: 6,
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, textAlign: "center" }}>
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Venta Neta Z (Bs)</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0A4083" }}>{formatBs(ventaNetaZ)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Total Verificado (Bs)</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{formatBs(totalReal)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Diferencia</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: esCuadrado ? "#16a34a" : "#dc2626" }}>
                {formatBs(diferencia)}
              </div>
            </div>
          </div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            <span style={{
              display: "inline-block",
              background: esCuadrado ? "#16a34a" : "#dc2626",
              color: "#fff", fontWeight: 700, fontSize: 13,
              padding: "4px 20px", borderRadius: 4, letterSpacing: "0.1em",
            }}>
              {estadoVisible === "cuadrado" ? "✓ CUADRADO" : estadoVisible === "descuadrado" ? "✗ DESCUADRADO" : "△ PENDIENTE"}
            </span>
          </div>
          {Math.abs(difCambiaria) >= 0.01 && (
            <div style={{ fontSize: 9, color: "#b45309", textAlign: "center", marginTop: 4 }}>
              Diferencia cambiaria (ajuste contable): {formatBs(difCambiaria)} —{" "}
              {formatUSD(cuadre.totalOdooUSD || 0)} × {tasa.toFixed(2)} Bs/$
            </div>
          )}
        </div>

        <HR />

        {/* Observaciones */}
        {cuadre.observaciones && (
          <div style={{ marginBottom: 8 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>OBSERVACIONES</div>
            <div style={{ fontSize: 10, color: "#333" }}>{cuadre.observaciones}</div>
          </div>
        )}

        {/* Firmas */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr", gap: 30,
          marginTop: 18, paddingTop: 8, borderTop: "1px solid #ccc",
        }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderBottom: "1px solid #333", marginBottom: 4, height: 34 }} />
            <div style={{ fontSize: 9, fontWeight: 700 }}>Cajero: {cuadre.cajero}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderBottom: "1px solid #333", marginBottom: 4, height: 34 }} />
            <div style={{ fontSize: 9, fontWeight: 700 }}>Supervisor</div>
          </div>
        </div>

        {/* Pie */}
        <div style={{ textAlign: "center", fontSize: 8, color: "#aaa", marginTop: 8 }}>
          Generado: {new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })} —
          Cuadre de Caja | Global It System, C.A.
        </div>
      </div>

      {/* Print styles — hoja carta */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          #report-content { box-shadow: none !important; max-width: 100% !important; }
          @page { margin: 12mm 15mm; size: letter; }
        }
      `}</style>
    </div>
  );
}
