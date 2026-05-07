import { useQuery } from "@tanstack/react-query";
import { useRoute, useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { formatBs, formatUSD, getStatusLabel, formatDateTime } from "@/lib/utils";
import { ArrowLeft, Printer } from "lucide-react";
import type { CreditSaleRow, RetentionRow } from "@shared/schema";

// Payment method IDs to exclude from Sección II (direct payments)
const RETENCION_IVA_METHOD_ID = 26;
// pay_later credit methods (Venta a crédito)
const CREDITO_METHOD_IDS = new Set([14, 33]);
const SALDO_FAVOR_METHOD_ID = 25;
// Cashea companion method — shown separately in Sección III
const CASHEA_METHOD_ID = 42;
const DELIVERY_KEYWORDS = ["delivery", "diferencia"];

function isDeliveryOrDif(name: string) {
  const lower = name.toLowerCase();
  return DELIVERY_KEYWORDS.some((k) => lower.includes(k));
}

/** Methods excluded from Sección II — each has its own dedicated block */
function isExcluded(m: any) {
  return (
    m.metodoId === RETENCION_IVA_METHOD_ID ||
    CREDITO_METHOD_IDS.has(m.metodoId) ||
    m.metodoId === SALDO_FAVOR_METHOD_ID ||
    m.metodoId === CASHEA_METHOD_ID ||
    isDeliveryOrDif(m.metodoNombre || "")
  );
}

/** Thin horizontal rule for print */
function HR() {
  return <div style={{ borderTop: "1px solid #ccc", margin: "6px 0" }} />;
}

/** Section header */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        background: "#0A4083",
        color: "#fff",
        fontWeight: 700,
        fontSize: 10,
        letterSpacing: "0.05em",
        textTransform: "uppercase",
        padding: "3px 6px",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

/** Two-column key/value row */
function Row({
  label,
  value,
  bold,
  indent,
  valueColor,
}: {
  label: string;
  value: string;
  bold?: boolean;
  indent?: boolean;
  valueColor?: string;
}) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        fontSize: 10,
        fontWeight: bold ? 700 : 400,
        paddingLeft: indent ? 10 : 0,
        marginBottom: 1,
      }}
    >
      <span>{label}</span>
      <span style={{ color: valueColor }}>{value}</span>
    </div>
  );
}

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

  // ── Derived data ──────────────────────────────────────────────────────────
  const tasa = cuadre.tasaDia || 0;

  const metodos: any[] = cuadre.metodos || [];
  const directos = metodos.filter((m) => !isExcluded(m));
  const deliveryMethods = metodos.filter((m) => isDeliveryOrDif(m.metodoNombre || ""));
  // Cashea (PXC) — companion method shown in Sección III along with credit methods
  const casheaMethods = metodos.filter((m) => m.metodoId === CASHEA_METHOD_ID);
  const totalCasheaPOS = casheaMethods.reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);
  const totalCasheaReal = casheaMethods.reduce((s, m) => s + (m.montoReal || 0), 0);

  const creditSales: CreditSaleRow[] = cuadre.creditSales || [];
  const retentions: RetentionRow[] = cuadre.retenciones || [];

  // Totales directos (verificados real)
  const totalDirectosReal = directos.reduce((s, m) => s + (m.montoReal || 0), 0);
  const totalDirectosPOS = directos.reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);

  // Delivery/Diferencia POS (en Bs)
  const totalDeliveryPOS = deliveryMethods.reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);

  // Retenciones
  const totalRetPOS = cuadre.totalRetencionesPOS || 0;
  const totalRetReal = cuadre.totalRetencionesReal || 0;
  const retPorCobrar = cuadre.retencionesPorCobrar || 0;

  // CxC
  const totalCreditoPOS = cuadre.totalCreditoPOS || 0;
  const totalAbonos = cuadre.totalAbonosReal || 0;
  const totalCxCPendiente = cuadre.totalCxCPendiente || 0;

  // Saldo a favor
  const totalSaldoFavorPOS = cuadre.totalSaldoFavorPOS || 0;
  const totalSaldoFavorReal = cuadre.totalSaldoFavorReal || 0;

  // Ajustes
  const totalAjustes = cuadre.totalAjustesManuales || 0;

  // Totales POS vs Real
  const totalPOS = cuadre.totalMetodosPOS || 0;
  const totalReal = cuadre.totalJustificadoReal || 0;

  // Diferencias
  const ventaNetaZ = cuadre.ventaNetaZ || 0;
  const diferencia = cuadre.diferencia || 0;
  const difCambiaria = cuadre.difCambiaria || 0;

  // Estado
  const esCuadrado = Math.abs(diferencia) < 5 || cuadre.estado === "cuadrado";

  // Formato fecha
  const fechaFormateada = cuadre.fecha
    ? new Date(cuadre.fecha + "T12:00:00").toLocaleDateString("es-VE", {
        weekday: "long",
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : cuadre.fecha;

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Toolbar — only visible on screen */}
      <div className="max-w-[216mm] mx-auto p-4 flex justify-between items-center no-print">
        <Button variant="ghost" size="sm" onClick={() => setLocation(`/cuadre/${id}`)}>
          <ArrowLeft className="h-4 w-4 mr-1" /> Volver
        </Button>
        <Button size="sm" onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Imprimir
        </Button>
      </div>

      {/* ── REPORT BODY ─────────────────────────────────────────────────── */}
      <div
        id="report-content"
        className="max-w-[216mm] mx-auto bg-white print:p-0"
        style={{ padding: "16px 20px", fontFamily: "Arial, sans-serif" }}
      >
        {/* ── ENCABEZADO ─────────────────────────────────────────────────── */}
        <div
          style={{
            textAlign: "center",
            borderBottom: "2px solid #0A4083",
            paddingBottom: 8,
            marginBottom: 10,
          }}
        >
          <div style={{ fontSize: 16, fontWeight: 700, color: "#0A4083" }}>
            CUADRE DE CAJA — REPORTE FINANCIERO
          </div>
          <div style={{ fontSize: 10, color: "#555", marginTop: 2 }}>
            Global It System, C.A. — ONPROTEC
          </div>
        </div>

        {/* ── INFO GENERAL ───────────────────────────────────────────────── */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 20px",
            fontSize: 10,
            marginBottom: 8,
          }}
        >
          <div><strong>Fecha:</strong> {fechaFormateada}</div>
          <div><strong>Sesión:</strong> {cuadre.sessionName}</div>
          <div><strong>Caja:</strong> {cuadre.caja}</div>
          <div><strong>Cajero:</strong> {cuadre.cajero}</div>
          <div>
            <strong>Máquina Fiscal:</strong>{" "}
            {cuadre.serialMachine || cuadre.maquinaFiscal || "—"}
          </div>
          <div>
            <strong>Estado:</strong>{" "}
            <span style={{ fontWeight: 700, color: esCuadrado ? "#16a34a" : "#dc2626" }}>
              {getStatusLabel(cuadre.estado)}
            </span>
          </div>
          {cuadre.cerradoPor && (
            <div style={{ gridColumn: "1 / -1" }}>
              <strong>Cerrado por:</strong> {cuadre.cerradoPor} el{" "}
              {formatDateTime(cuadre.cerradoEn || "")}
            </div>
          )}
        </div>

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN I — REPORTE Z (FUENTE FISCAL OFICIAL)
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>I. Reporte Z — Fuente Fiscal Oficial</SectionTitle>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: "0 20px",
            marginBottom: 6,
          }}
        >
          {/* Columna izquierda: montos Z */}
          <div>
            <Row label="Número Z:" value={cuadre.zNumero || "—"} />
            <Row label="Venta Bruta (Z):" value={formatBs(cuadre.ventaBrutaZ)} />
            <Row label="(–) Notas de Crédito (Z):" value={formatBs(cuadre.notasCreditoZ)} indent />
            <div style={{ borderTop: "1px solid #999", marginTop: 2, paddingTop: 2 }}>
              <Row label="Venta Neta (Z):" value={formatBs(ventaNetaZ)} bold />
            </div>
            <div style={{ marginTop: 4 }}>
              <Row label="Base Imponible (Z):" value={formatBs(cuadre.baseImponibleZ)} />
              <Row label="Exento (Z):" value={formatBs(cuadre.exentoZ)} />
              <Row label="IVA (Z):" value={formatBs(cuadre.ivaZ)} />
              <Row label="IGTF Percibido (Z):" value={formatBs(cuadre.igtfZ)} />
            </div>
          </div>

          {/* Columna derecha: tasa + facturas */}
          <div>
            <div
              style={{
                background: "#f0f6ff",
                border: "1px solid #c3d9f7",
                borderRadius: 4,
                padding: "6px 8px",
                marginBottom: 6,
              }}
            >
              <div style={{ fontSize: 9, fontWeight: 700, color: "#0A4083", marginBottom: 3 }}>
                TASA BCV DEL DÍA
              </div>
              <div style={{ fontSize: 18, fontWeight: 700, color: "#0A4083" }}>
                Bs {tasa.toFixed(2)} / $
              </div>
              <div style={{ fontSize: 9, color: "#555", marginTop: 2 }}>
                Venta Neta Odoo:{" "}
                {formatUSD(cuadre.totalOdooUSD || 0)} × {tasa.toFixed(2)} ={" "}
                {formatBs(cuadre.totalOdooBs || 0)}
              </div>
              {Math.abs(difCambiaria) > 0.01 && (
                <div style={{ fontSize: 9, color: "#b45309", marginTop: 2 }}>
                  Dif. cambiaria: <strong>{formatBs(difCambiaria)}</strong> (ajuste contable)
                </div>
              )}
            </div>

            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2, marginTop: 2 }}>
              Facturas
            </div>
            <Row label="Primera:" value={cuadre.primeraFacturaZ || "—"} indent />
            <Row label="Última:" value={cuadre.ultimaFacturaZ || "—"} indent />
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2, marginTop: 4 }}>
              Notas de Crédito
            </div>
            <Row label="Primera NC:" value={cuadre.primeraNCZ || "—"} indent />
            <Row label="Última NC:" value={cuadre.ultimaNCZ || "—"} indent />
          </div>
        </div>

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN II — INGRESOS (MÉTODOS DE PAGO DIRECTOS)
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>II. Ingresos — Métodos de Pago Directos</SectionTitle>

        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 10, marginBottom: 4 }}>
          <thead>
            <tr style={{ background: "#f5f5f5" }}>
              <th style={{ textAlign: "left", padding: "3px 4px", fontWeight: 700 }}>Método</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>POS (USD)</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>POS (Bs)</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>Verificado (Bs)</th>
              <th style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>Dif.</th>
            </tr>
          </thead>
          <tbody>
            {directos.map((m, i) => {
              const diff =
                m.montoReal && m.montoPOS_Bs
                  ? Math.round((m.montoReal - m.montoPOS_Bs) * 100) / 100
                  : 0;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                  <td style={{ padding: "2px 4px" }}>{m.metodoNombre}</td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>
                    {formatUSD(m.montoPOS_USD || 0)}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px", color: "#555" }}>
                    {formatBs(m.montoPOS_Bs || 0)}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 600 }}>
                    {m.montoReal ? formatBs(m.montoReal) : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "right",
                      padding: "2px 4px",
                      color: diff === 0 ? "#555" : diff > 0 ? "#16a34a" : "#dc2626",
                    }}
                  >
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
              <td style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>
                {formatBs(totalDirectosPOS)}
              </td>
              <td style={{ textAlign: "right", padding: "3px 4px", fontWeight: 700 }}>
                {formatBs(totalDirectosReal)}
              </td>
              <td
                style={{
                  textAlign: "right",
                  padding: "3px 4px",
                  fontWeight: 700,
                  color:
                    Math.abs(totalDirectosReal - totalDirectosPOS) < 5 ? "#16a34a" : "#dc2626",
                }}
              >
                {formatBs(Math.round((totalDirectosReal - totalDirectosPOS) * 100) / 100)}
              </td>
            </tr>
          </tfoot>
        </table>

        {/* Delivery / Diferencia */}
        {deliveryMethods.length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>
              Delivery / Diferencias (contabilizado desde POS):
            </div>
            {deliveryMethods.map((m, i) => (
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

        {/* Bloque: Venta a Crédito (métodos pay_later) */}
        <div style={{ marginBottom: 6 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 3, borderBottom: "1px solid #ddd", paddingBottom: 2 }}>
            VENTA A CRÉDITO (Métodos diferidos)
          </div>
          {metodos.filter((m) => CREDITO_METHOD_IDS.has(m.metodoId)).length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 3 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>Método</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (USD)</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {metodos.filter((m) => CREDITO_METHOD_IDS.has(m.metodoId)).map((m, i) => (
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
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>
                    {formatBs(totalCreditoPOS)}
                  </td>
                </tr>
              </tfoot>
            </table>
          ) : (
            <div style={{ fontSize: 9, color: "#aaa", marginBottom: 4 }}>Sin ventas a crédito en esta sesión</div>
          )}
          <Row label="Abonos recibidos verificados (Bs):" value={formatBs(totalAbonos)} indent />
          <Row
            label="CxC pendiente de cobro (Bs):"
            value={formatBs(totalCxCPendiente)}
            bold
            valueColor={totalCxCPendiente > 0 ? "#dc2626" : "#16a34a"}
          />
        </div>

        {/* Bloque: PXC Cashea */}
        {casheaMethods.length > 0 && (
          <div style={{ marginBottom: 6 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 3, borderBottom: "1px solid #ddd", paddingBottom: 2 }}>
              PXC CASHEA (Por cobrar al operador)
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 3 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>Método</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (USD)</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>POS (Bs)</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Verificado (Bs)</th>
                </tr>
              </thead>
              <tbody>
                {casheaMethods.map((m, i) => (
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
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>
                    {formatBs(totalCasheaPOS)}
                  </td>
                  <td style={{ textAlign: "right", padding: "2px 4px", fontWeight: 700 }}>
                    {totalCasheaReal > 0 ? formatBs(totalCasheaReal) : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Detalle CxC por cliente */}
        <div style={{ marginBottom: 4 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 3, borderBottom: "1px solid #ddd", paddingBottom: 2 }}>
            DETALLE POR CLIENTE
          </div>

          {creditSales.length > 0 ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 4 }}>
              <thead>
                <tr style={{ background: "#f5f5f5" }}>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>Factura</th>
                  <th style={{ textAlign: "left", padding: "2px 4px" }}>Cliente</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Total Fact.</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Crédito POS</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Abono</th>
                  <th style={{ textAlign: "right", padding: "2px 4px" }}>Saldo</th>
                  <th style={{ textAlign: "center", padding: "2px 4px" }}>Estado</th>
                </tr>
              </thead>
              <tbody>
                {creditSales.map((c, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
                    <td style={{ padding: "2px 4px", fontWeight: 600 }}>{c.invoiceNumber}</td>
                    <td style={{ padding: "2px 4px" }}>{c.partner}</td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>
                      {formatUSD(c.invoiceTotal || 0)}
                    </td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>
                      {formatUSD(c.creditAmountPOS || 0)}
                    </td>
                    <td style={{ textAlign: "right", padding: "2px 4px" }}>
                      {formatUSD(c.abonoAmount || 0)}
                    </td>
                    <td
                      style={{
                        textAlign: "right",
                        padding: "2px 4px",
                        fontWeight: 600,
                        color: (c.residual || 0) > 0 ? "#dc2626" : "#16a34a",
                      }}
                    >
                      {formatUSD(c.residual || 0)}
                    </td>
                    <td style={{ textAlign: "center", padding: "2px 4px" }}>
                      {c.paymentState === "paid"
                        ? "Pagado"
                        : c.paymentState === "partial"
                        ? "Parcial"
                        : "Pendiente"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div style={{ fontSize: 9, color: "#aaa", marginBottom: 4 }}>Sin detalle de facturas a crédito</div>
          )}
        </div>{/* end DETALLE POR CLIENTE */}

        {(totalSaldoFavorPOS > 0 || totalSaldoFavorReal > 0) && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>
              Saldos a favor generados:
            </div>
            <Row
              label="  Saldo a favor según POS (Bs):"
              value={formatBs(totalSaldoFavorPOS)}
              indent
            />
            <Row
              label="  Saldo a favor verificado (Bs):"
              value={formatBs(totalSaldoFavorReal)}
              bold
              indent
              valueColor="#16a34a"
            />
            {cuadre.saldoFavorObs && (
              <div style={{ fontSize: 9, color: "#666", paddingLeft: 10, fontStyle: "italic" }}>
                Obs: {cuadre.saldoFavorObs}
              </div>
            )}
          </div>
        )}

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN IV — RETENCIONES IVA APLICADAS
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>IV. Retenciones IVA Aplicadas</SectionTitle>

        <div style={{ marginBottom: 4 }}>
          <Row label="Retenciones según POS (Bs):" value={formatBs(totalRetPOS)} />
          <Row
            label="Retenciones canceladas/registradas RIVAC (Bs):"
            value={formatBs(totalRetReal)}
            indent
          />
          {retPorCobrar > 0 && (
            <Row
              label="Retenciones pendientes de cobro (Bs):"
              value={formatBs(retPorCobrar)}
              bold
              valueColor="#b45309"
            />
          )}
        </div>

        {retentions.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 9, marginBottom: 4 }}>
            <thead>
              <tr style={{ background: "#f5f5f5" }}>
                <th style={{ textAlign: "left", padding: "2px 4px" }}>Factura</th>
                <th style={{ textAlign: "left", padding: "2px 4px" }}>Cliente</th>
                <th style={{ textAlign: "right", padding: "2px 4px" }}>Ret. POS (Bs)</th>
                <th style={{ textAlign: "right", padding: "2px 4px" }}>Ret. RIVAC (Bs)</th>
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
                      ? formatBs(Math.round(r.retentionAmount * tasa * 100) / 100)
                      : "—"}
                  </td>
                  <td
                    style={{
                      textAlign: "center",
                      padding: "2px 4px",
                      color: r.status === "registered" ? "#16a34a" : "#b45309",
                      fontWeight: 600,
                    }}
                  >
                    {r.status === "registered" ? "Registrada" : "Pendiente"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <HR />

        {/* ══════════════════════════════════════════════════════════════════
            SECCIÓN V — DIFERENCIAS Y SALDOS FINANCIEROS
        ═══════════════════════════════════════════════════════════════════*/}
        <SectionTitle>V. Diferencias y Saldos a Favor</SectionTitle>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
          {/* POS */}
          <div style={{ border: "1px solid #c3d9f7", borderRadius: 4, padding: 6 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#0A4083", marginBottom: 3 }}>
              SEGÚN SISTEMA (POS)
            </div>
            <Row label="Pagos directos:" value={formatBs(totalDirectosPOS)} />
            <Row label="Retenciones IVA:" value={formatBs(totalRetPOS)} />
            <Row label="Ventas a crédito:" value={formatBs(totalCreditoPOS)} />
            <Row label="Saldo a favor:" value={formatBs(totalSaldoFavorPOS)} />
            {totalDeliveryPOS > 0 && (
              <Row label="Delivery / Diferencias:" value={formatBs(totalDeliveryPOS)} />
            )}
            <div style={{ borderTop: "1px solid #999", marginTop: 3, paddingTop: 3 }}>
              <Row label="TOTAL POS:" value={formatBs(totalPOS)} bold />
            </div>
          </div>

          {/* Real */}
          <div style={{ border: "1px solid #c3d9f7", borderRadius: 4, padding: 6 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#0A4083", marginBottom: 3 }}>
              VERIFICADO REAL
            </div>
            <Row label="Pagos directos:" value={formatBs(totalDirectosReal)} />
            <Row label="Retenciones canceladas:" value={formatBs(totalRetReal)} />
            {retPorCobrar > 0 && (
              <Row label="Ret. por cobrar:" value={formatBs(retPorCobrar)} valueColor="#b45309" />
            )}
            <Row label="Abonos CxC recibidos:" value={formatBs(totalAbonos)} />
            <Row
              label="CxC pendiente:"
              value={formatBs(totalCxCPendiente)}
              valueColor={totalCxCPendiente > 0 ? "#dc2626" : undefined}
            />
            <Row label="Saldo a favor:" value={formatBs(totalSaldoFavorReal)} />
            {totalDeliveryPOS > 0 && (
              <Row label="Delivery / Diferencias:" value={formatBs(totalDeliveryPOS)} />
            )}
            {totalAjustes !== 0 && (
              <Row label="Ajustes manuales:" value={formatBs(totalAjustes)} />
            )}
            <div style={{ borderTop: "1px solid #999", marginTop: 3, paddingTop: 3 }}>
              <Row label="TOTAL REAL:" value={formatBs(totalReal)} bold />
            </div>
          </div>
        </div>

        {/* Ajustes manuales detalle */}
        {(cuadre.ajustesManuales || []).length > 0 && (
          <div style={{ marginBottom: 4 }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>
              Ajustes manuales:
            </div>
            {(cuadre.ajustesManuales || []).map((a: any, i: number) => (
              <Row key={i} label={`  ${a.descripcion || "Ajuste"}:`} value={formatBs(a.monto)} indent />
            ))}
          </div>
        )}

        {/* Resultado del Cuadre */}
        <div
          style={{
            border: `2px solid ${esCuadrado ? "#16a34a" : "#dc2626"}`,
            borderRadius: 6,
            padding: 8,
            background: esCuadrado ? "#f0fdf4" : "#fef2f2",
            marginBottom: 6,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr 1fr",
              gap: 8,
              textAlign: "center",
            }}
          >
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Venta Neta Z (Bs)</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#0A4083" }}>
                {formatBs(ventaNetaZ)}
              </div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Total Verificado (Bs)</div>
              <div style={{ fontSize: 14, fontWeight: 700 }}>{formatBs(totalReal)}</div>
            </div>
            <div>
              <div style={{ fontSize: 9, color: "#555" }}>Diferencia</div>
              <div
                style={{
                  fontSize: 14,
                  fontWeight: 700,
                  color: esCuadrado ? "#16a34a" : "#dc2626",
                }}
              >
                {formatBs(diferencia)}
              </div>
            </div>
          </div>

          <div style={{ textAlign: "center", marginTop: 6 }}>
            <span
              style={{
                display: "inline-block",
                background: esCuadrado ? "#16a34a" : "#dc2626",
                color: "#fff",
                fontWeight: 700,
                fontSize: 13,
                padding: "4px 20px",
                borderRadius: 4,
                letterSpacing: "0.1em",
              }}
            >
              {esCuadrado ? "✓ CUADRADO" : "✗ DESCUADRADO"}
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
            <div style={{ fontSize: 9, fontWeight: 700, color: "#555", marginBottom: 2 }}>
              OBSERVACIONES
            </div>
            <div style={{ fontSize: 10, color: "#333" }}>{cuadre.observaciones}</div>
          </div>
        )}

        {/* Firmas */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 30,
            marginTop: 20,
            paddingTop: 8,
            borderTop: "1px solid #ccc",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <div style={{ borderBottom: "1px solid #333", marginBottom: 4, height: 36 }} />
            <div style={{ fontSize: 9, fontWeight: 700 }}>Cajero: {cuadre.cajero}</div>
          </div>
          <div style={{ textAlign: "center" }}>
            <div style={{ borderBottom: "1px solid #333", marginBottom: 4, height: 36 }} />
            <div style={{ fontSize: 9, fontWeight: 700 }}>Supervisor</div>
          </div>
        </div>

        {/* Pie de página */}
        <div style={{ textAlign: "center", fontSize: 8, color: "#aaa", marginTop: 10 }}>
          Generado: {new Date().toLocaleString("es-VE", { timeZone: "America/Caracas" })} —
          Cuadre de Caja | Global It System, C.A.
        </div>
      </div>

      {/* Print styles */}
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
