import { z } from "zod";

// Universal tolerance for "cuadrado" status: ±5 Bs (fiscal) or ±0.01 USD (NF)
export const CUADRE_TOLERANCE_BS = 5;
export const CUADRE_TOLERANCE_USD = 0.01;

// User
export const userSchema = z.object({
  id: z.string(),
  nombre: z.string(),
  email: z.string().email(),
  password: z.string(),
  rol: z.enum(["cajero", "supervisor", "admin"]),
  activo: z.boolean(),
});
export type User = z.infer<typeof userSchema>;
export type UserPublic = Omit<User, "password">;

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Odoo session
export const posSessionSchema = z.object({
  id: z.number(),
  name: z.string(),
  config_id: z.tuple([z.number(), z.string()]),
  user_id: z.tuple([z.number(), z.string()]),
  state: z.string(),
  start_at: z.string().nullable(),
  stop_at: z.string().nullable(),
  report_z: z.union([z.string(), z.boolean()]).nullable(),
  serial_machine: z.union([z.string(), z.boolean()]).nullable(),
  cash_register_balance_start: z.number(),
  cash_register_balance_end: z.number(),
  cash_register_balance_end_real: z.number(),
  cash_register_difference: z.number(),
  total_payments_amount: z.number(),
  order_count: z.number(),
});
export type PosSession = z.infer<typeof posSessionSchema>;

// Payment grouped
export const paymentGroupSchema = z.object({
  methodId: z.number(),
  methodName: z.string(),
  methodType: z.string(),
  total: z.number(),
  count: z.number(),
});
export type PaymentGroup = z.infer<typeof paymentGroupSchema>;

// Order summary
export const orderSummarySchema = z.object({
  totalSales: z.number(),
  totalTax: z.number(),
  totalIGTF: z.number(),
  orderCount: z.number(),
  refundCount: z.number(),
  refundAmount: z.number(),
});
export type OrderSummary = z.infer<typeof orderSummarySchema>;

// Fiscal summary (from account.move invoices)
export interface FiscalPayment {
  methodId: number;
  methodName: string;
  totalUSD: number;
  totalBs: number;
  isCompanion?: boolean;
  orderRefs?: string[]; // Order/invoice references for delivery/diferencia methods
  // Per-session breakdown (null when no companion session)
  mainAmountUSD?: number;
  companionAmountUSD?: number;
  mainAmountBs?: number;
  companionAmountBs?: number;
}

export interface FiscalSummary {
  journalId: number;
  journalCode: string;
  invoiceCount: number;
  ncCount: number;
  totalUSD: number;
  totalTaxUSD: number;
  totalVES: number;
  rate: number;
  payments: FiscalPayment[];
  totalRetencionesPOS: number;
  totalCreditoPOS: number;
  totalSaldoFavorPOS: number;
  firstInvoice: string;
  lastInvoice: string;
  firstNC: string;
  lastNC: string;
  companionSessionName: string;
  // Per-caja ranges
  mainFirstInvoice?: string;
  mainLastInvoice?: string;
  mainInvoiceCount?: number;
  mainFirstNC?: string;
  mainLastNC?: string;
  mainNcCount?: number;
  companionFirstInvoice?: string;
  companionLastInvoice?: string;
  companionInvoiceCount?: number;
  companionFirstNC?: string;
  companionLastNC?: string;
  companionNcCount?: number;
  companionJournalCode?: string;
  mainJournalCode?: string;
  mainCajaName?: string;
  companionCajaName?: string;
}

// Retention row (from RIVAC journal cross-reference)
export interface RetentionRow {
  invoiceNumber: string;
  partner: string;
  posTotalUSD: number;
  retentionAmount: number;
  rivacEntryName: string;
  status: "registered" | "pending";
}

// Credit sale row (from account.partial.reconcile tracing)
export interface CreditSaleRow {
  invoiceNumber: string;
  partner: string;
  invoiceTotal: number;
  creditAmountPOS: number;
  retentionAmountPOS: number;
  abonoAmount: number;
  abonoAmountBs: number;
  abonoJournal: string;
  abonoByJournal: Record<string, { usd: number; bs: number }>;
  residual: number;
  paymentState: string;
  // Excedente: when the client pays more than the invoice debt (e.g. delivery fee)
  paymentTotalBs: number;      // Total amount the client actually paid (Bs)
  paymentTotalUsd: number;     // Total amount the client actually paid (USD)
  excedenteBs: number;         // Excess over invoice: paymentTotal - amountAppliedToInvoice (Bs)
  excedenteUsd: number;        // Same in USD
  excedenteConcepto: string;   // e.g. "delivery", "otro", "" if no excess
  generaSaldoFavor: boolean;   // true if excedenteBs > 0
}

// Saldo a favor detail row
export interface SaldoFavorRow {
  orderName: string;
  partner: string;
  invoiceNumber: string;
  amount: number;      // USD
  amountBs: number;    // VES
}

// Non-fiscal (recibos) summary
export interface NonFiscalPaymentGroup {
  methodId: number;
  methodName: string;  // POS payment method name
  totalUSD: number;
  count: number;
}

export interface NonFiscalCreditRow {
  orderName: string;
  partner: string;
  amountUSD: number;
}

export interface NonFiscalSummary {
  receiptCount: number;
  totalUSD: number;
  payments: NonFiscalPaymentGroup[];
  creditSales: NonFiscalCreditRow[];
  totalCreditUSD: number;
}

// Cuadre — fiscal / Bolívares version
export const cuadreSchema = z.object({
  id: z.string(),
  fecha: z.string(),
  caja: z.string(),
  maquinaFiscal: z.string(),
  sessionId: z.number(),
  sessionName: z.string(),
  cajero: z.string(),
  serialMachine: z.string().optional(),

  // Z Report data (manual, fiscal source)
  zNumero: z.string(),
  ventaBrutaZ: z.number(),
  notasCreditoZ: z.number(),
  ventaNetaZ: z.number(),
  baseImponibleZ: z.number(),
  exentoZ: z.number(),
  ivaZ: z.number(),
  igtfZ: z.number(),
  primeraFacturaZ: z.string(),
  ultimaFacturaZ: z.string(),
  primeraNCZ: z.string(),
  ultimaNCZ: z.string(),

  // Exchange rate
  tasaDia: z.number(),

  // Odoo reference data
  totalOdooUSD: z.number(),
  totalOdooBs: z.number(),
  difCambiaria: z.number(),

  // Totals (all in Bs)
  totalMetodosReal: z.number(),
  totalDeducciones: z.number(),
  totalJustificado: z.number(),
  diferencia: z.number(),

  // New: retention/credit/saldo totals
  totalRetencionesPOS: z.number(),
  totalRetencionesReal: z.number(),
  retencionesPorCobrar: z.number().optional().default(0),
  totalCreditoPOS: z.number(),
  totalAbonosReal: z.number(),
  totalCxCPendiente: z.number(),
  totalSaldoFavorPOS: z.number(),
  totalSaldoFavorReal: z.number(),
  totalAjustesManuales: z.number(),
  // Calculated internally in form for display (persisted to Sheets as optional)
  totalMetodosPOS: z.number().optional(),
  totalJustificadoReal: z.number().optional(),
  totalDirectoPOS: z.number().optional(),

  estado: z.enum(["cuadrado", "descuadrado", "pendiente"]),
  observaciones: z.string(),
  observacionesNF: z.string().optional(),
  tipo: z.enum(["fiscal", "nf"]).optional(),
  saldoFavorObs: z.string().optional(),
  cerradoPor: z.string(),
  creadoEn: z.string(),
  cerradoEn: z.string(),
});
export type Cuadre = z.infer<typeof cuadreSchema>;

export const ajusteManualSchema = z.object({
  tipo: z.string(),
  descripcion: z.string(),
  monto: z.number(),
  referencia: z.string().optional(),
});

export const createCuadreSchema = z.object({
  sessionId: z.number(),
  sessionName: z.string(),
  fecha: z.string(),
  caja: z.string(),
  cajero: z.string(),
  maquinaFiscal: z.string(),
  tasaDia: z.number(),

  // Z Report data (MANUAL INPUT — FISCAL SOURCE)
  zNumero: z.string(),
  ventaBrutaZ: z.number(),
  notasCreditoZ: z.number(),
  ventaNetaZ: z.number(),
  baseImponibleZ: z.number(),
  exentoZ: z.number(),
  ivaZ: z.number(),
  igtfZ: z.number(),
  primeraFacturaZ: z.string(),
  ultimaFacturaZ: z.string(),
  primeraNCZ: z.string().optional().default(""),
  ultimaNCZ: z.string().optional().default(""),

  // Odoo reference data (AUTO from API)
  totalOdooUSD: z.number(),
  totalOdooBs: z.number(),
  difCambiaria: z.number(),

  // New totals
  totalRetencionesPOS: z.number().optional().default(0),
  totalRetencionesReal: z.number().optional().default(0),
  retencionesPorCobrar: z.number().optional().default(0),

  totalCreditoPOS: z.number().optional().default(0),
  totalAbonosReal: z.number().optional().default(0),
  totalCxCPendiente: z.number().optional().default(0),

  totalSaldoFavorPOS: z.number().optional().default(0),
  totalSaldoFavorReal: z.number().optional().default(0),
  totalAjustesManuales: z.number().optional().default(0),

  // Values directly from form display (calculated internally)
  totalMetodosPOS: z.number().optional().default(0),
  totalJustificadoReal: z.number().optional().default(0),
  totalDirectoPOS: z.number().optional().default(0),  // Pagos directos sin delivery/dif

  // NUEVO: observación de saldos a favor
  saldoFavorObs: z.string().optional(),

  observaciones: z.string().optional(),

  // NF-specific observations (separate from fiscal observations)
  observacionesNF: z.string().optional(),

  // Tipo: fiscal (default) or nf (non-fiscal)
  tipo: z.enum(["fiscal", "nf"]).optional(),

  // Payment methods verified (in Bs)
  metodos: z.array(z.object({
    metodoId: z.coerce.number(),
    metodoNombre: z.string(),
    montoPOS_USD: z.coerce.number(),
    montoPOS_Bs: z.coerce.number(),
    montoReal: z.coerce.number(),
    observacion: z.string().optional(),
  })),

  // Deductions (in Bs)
  deducciones: z.array(z.object({
    tipo: z.string(),
    descripcion: z.string(),
    monto: z.number(),
    comprobante: z.string().optional(),
  })),

  // Manual adjustments
  ajustesManuales: z.array(ajusteManualSchema).optional().default([]),
});
export type CreateCuadre = z.infer<typeof createCuadreSchema>;

// MetodoVerificado
export const metodoVerificadoSchema = z.object({
  id: z.string(),
  cuadreId: z.string(),
  metodoId: z.number(),
  metodoNombre: z.string(),
  montoPOS_USD: z.number(),
  montoPOS_Bs: z.number(),
  montoReal: z.number(),
  diferencia: z.number(),
  observacion: z.string(),
});
export type MetodoVerificado = z.infer<typeof metodoVerificadoSchema>;

// Deduccion
export const deduccionSchema = z.object({
  id: z.string(),
  cuadreId: z.string(),
  tipo: z.string(),
  descripcion: z.string(),
  monto: z.number(),
  comprobante: z.string(),
});
export type Deduccion = z.infer<typeof deduccionSchema>;

// AjusteManual (persisted)
export interface AjusteManual {
  id: string;
  cuadreId: string;
  tipo: string;
  descripcion: string;
  monto: number;
  referencia: string;
}

// Cuadre detail (with related records + live Odoo data hydrated by GET /api/cuadres/:id)
export interface CuadreDetail extends Cuadre {
  metodos: MetodoVerificado[];
  deducciones: Deduccion[];
  ajustesManuales: AjusteManual[];
  // Live fields hydrated from Odoo at query time
  creditSales?: CreditSaleRow[];      // Ventas a crédito con detalle de excedente/saldo a favor
  saldosFavor?: SaldoFavorRow[];      // Saldos a favor generados en la sesión
  retenciones?: RetentionRow[];        // Retenciones IVA cruzadas con asientos RIVAC
  fiscalSummary?: FiscalSummary;        // Resumen fiscal de facturas Odoo
  tasa?: number;                       // Tasa del día (alias de tasaDia para compatibilidad con Report)
  saldoFavorObs?: string;              // Observación de saldos a favor
}
