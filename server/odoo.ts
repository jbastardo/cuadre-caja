import xmlrpc from "xmlrpc";
import type { PaymentGroup, OrderSummary, FiscalSummary, FiscalPayment, RetentionRow, CreditSaleRow, SaldoFavorRow, NonFiscalSummary, NonFiscalPaymentGroup, NonFiscalCreditRow } from "../shared/schema.js";

const ODOO_URL = process.env.ODOO_URL || "https://www.onprotec.shop";
const ODOO_DB = process.env.ODOO_DB || "binaural-dev-onprotec-16-release-8815487";
const ODOO_USERNAME = process.env.ODOO_USERNAME || "";
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || "";

let cachedUid: number | null = null;

// ========== CACHE SYSTEM ==========
interface CacheEntry<T> {
  value: T;
  expires: number;
}

const DEFAULT_TTL = 15 * 60 * 1000; // 15 minutes

class SimpleCache {
  private store = new Map<string, CacheEntry<any>>();

  get<T>(key: string, ttl = DEFAULT_TTL): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expires) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttl = DEFAULT_TTL): void {
    this.store.set(key, { value, expires: Date.now() + ttl });
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  // For debugging
  get size(): number {
    return this.store.size;
  }
}

// Cache instances - initialized on first use
let rateCache: SimpleCache | null = null;
let sessionCache: SimpleCache | null = null;
let paymentMethodCache: SimpleCache | null = null;
let creditSalesCache: SimpleCache | null = null;

function getRateCache(): SimpleCache {
  if (!rateCache) rateCache = new SimpleCache();
  return rateCache;
}

function getSessionCache(): SimpleCache {
  if (!sessionCache) sessionCache = new SimpleCache();
  return sessionCache;
}

function getCreditSalesCache(): SimpleCache {
  if (!creditSalesCache) creditSalesCache = new SimpleCache();
  return creditSalesCache;
}

function getPaymentMethodCache(): SimpleCache {
  if (!paymentMethodCache) paymentMethodCache = new SimpleCache();
  return paymentMethodCache;
}
// ========== END CACHE SYSTEM ==========

// POS Config → Journal mapping
const CONFIG_JOURNAL_MAP: Record<number, { journalId: number; journalCode: string }> = {
  1: { journalId: 15, journalCode: "FAC01" },
  2: { journalId: 72, journalCode: "FAC02" },
  7: { journalId: 131, journalCode: "FAC4" },
  8: { journalId: 131, journalCode: "FAC4" },
};

// Payment method IDs for special categories
const METHOD_RETENCION_IVA = 26;
const METHOD_VENTA_CREDITO = 14;
const METHOD_VENTA_CREDITO_2 = 33; // Second "Venta a crédito" (pay_later) used in Caja 1/2
// WARNING: Method 38 is "Venta a crédito" in name but type=bank, journal=BNC Bs (Cashea).
// It is actually a P.Movil BNC bank transfer. Do NOT include it in CREDIT_METHOD_IDS.
const CREDIT_METHOD_IDS = [METHOD_VENTA_CREDITO, METHOD_VENTA_CREDITO_2]; // pay_later credit methods only
const METHOD_SALDO_FAVOR = 25;
const RIVAC_JOURNAL_ID = 1;
const FISCAL_JOURNAL_IDS = new Set([15, 72, 131]); // FAC01, FAC02, FAC4

// Configs that share a fiscal machine — their sessions should be merged for cuadre
const COMPANION_CONFIGS: Record<number, number> = {
  1: 7,   // Caja 1 ↔ CASHEA 1 (machine Z1F0019552)
  7: 1,   // CASHEA 1 ↔ Caja 1
  2: 8,   // Caja 2 ↔ CASHEA 2 (machine Z7C7044514)
  8: 2,   // CASHEA 2 ↔ Caja 2
};



function getCommonClient() {
  const url = new URL("/xmlrpc/2/common", ODOO_URL);
  return xmlrpc.createSecureClient({
    host: url.hostname,
    port: 443,
    path: url.pathname,
  });
}

function getObjectClient() {
  const url = new URL("/xmlrpc/2/object", ODOO_URL);
  return xmlrpc.createSecureClient({
    host: url.hostname,
    port: 443,
    path: url.pathname,
  });
}

function authenticate(): Promise<number> {
  if (cachedUid) return Promise.resolve(cachedUid);
  return new Promise((resolve, reject) => {
    const client = getCommonClient();
    client.methodCall(
      "authenticate",
      [ODOO_DB, ODOO_USERNAME, ODOO_PASSWORD, {}],
      (err: any, uid: any) => {
        if (err) {
          console.error("Odoo auth error:", err.message);
          return reject(err);
        }
        if (!uid || uid === false) return reject(new Error("Odoo authentication failed - invalid credentials"));
        cachedUid = uid as number;
        resolve(uid as number);
      }
    );
  });
}

function executeKw(
  model: string,
  method: string,
  args: any[],
  kwargs: Record<string, any> = {}
): Promise<any> {
  return authenticate().then((uid) => {
    return new Promise((resolve, reject) => {
      const client = getObjectClient();
      client.methodCall(
        "execute_kw",
        [ODOO_DB, uid, ODOO_PASSWORD, model, method, args, kwargs],
        (err: any, result: any) => {
          if (err) {
            console.error(`Odoo error [${model}.${method}]:`, err.message || err);
            return reject(err);
          }
          // Filter out binary/image fields
          resolve(filterBinaryFields(result));
        }
      );
    });
  });
}

function filterBinaryFields(data: any): any {
  if (Array.isArray(data)) {
    return data.map(filterBinaryFields);
  }
  if (data && typeof data === "object") {
    const filtered: any = {};
    for (const [key, value] of Object.entries(data)) {
      // Skip binary fields
      if (key.includes("Image") || key.includes("image") || key.includes("Binary") || 
          key.includes("binary") || key.includes("Logo") || key.includes("logo") || 
          key.includes("_bin") || key.includes("_file") || key.includes("attachment_ids") ||
          key === "image_1920" || key === "image_1024" || key === "image_512" || key === "image_256" ||
          key === "avatar_1920" || key === "avatar_1024" || key === "avatar_512" || key === "avatar_256") {
        continue; // Skip binary fields
      }
      if (Array.isArray(value)) {
        filtered[key] = value.map(filterBinaryFields);
      } else if (value && typeof value === "object") {
        filtered[key] = filterBinaryFields(value);
      } else {
        filtered[key] = value;
      }
    }
    return filtered;
  }
  return data;
}

/**
 * Returns all session IDs that should be merged for a cuadre.
 * If the session's config has a companion (shared fiscal machine), finds the companion's
 * session for the same date and returns both IDs.
 */

// ========== TIMEZONE HELPERS (Venezuela: America/Caracas UTC-4) ==========
/**
 * Converts a Venezuelan date string (YYYY-MM-DD) to UTC datetime range [startUtc, endUtc]
 * Venezuela is UTC-4.
 * Start of day: YYYY-MM-DD 00:00:00 VET = YYYY-MM-DD 04:00:00 UTC
 * End of day:   YYYY-MM-DD 23:59:59 VET = NextDay 03:59:59 UTC
 */
export function getUtcRangeForDate(dateStr: string): { startUtc: string; endUtc: string } {
  if (!dateStr || !dateStr.includes("-")) {
    const today = new Date().toISOString().split("T")[0];
    dateStr = today;
  }
  const [year, month, day] = dateStr.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, 4, 0, 0));
  const end = new Date(Date.UTC(year, month - 1, day + 1, 3, 59, 59));

  const formatUtc = (d: Date) => {
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const dNum = String(d.getUTCDate()).padStart(2, "0");
    const h = String(d.getUTCHours()).padStart(2, "0");
    const min = String(d.getUTCMinutes()).padStart(2, "0");
    const s = String(d.getUTCSeconds()).padStart(2, "0");
    return `${y}-${m}-${dNum} ${h}:${min}:${s}`;
  };

  return { startUtc: formatUtc(start), endUtc: formatUtc(end) };
}

/**
 * Converts a UTC datetime string (from Odoo "YYYY-MM-DD HH:mm:ss") to Venezuelan date string (YYYY-MM-DD)
 */
export function getVenezuelanDateFromUtc(utcStr: string): string {
  if (!utcStr) return "";
  const [dPart, tPart] = utcStr.split(" ");
  if (!dPart || !dPart.includes("-")) return "";
  const [year, month, day] = dPart.split("-").map(Number);
  const [h, m, s] = (tPart || "00:00:00").split(":").map(Number);
  // Subtract 4 hours (UTC-4)
  const dt = new Date(Date.UTC(year, month - 1, day, (h || 0) - 4, m || 0, s || 0));
  const y = dt.getUTCFullYear();
  const mon = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dNum = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mon}-${dNum}`;
}
// ========== END TIMEZONE HELPERS ==========

async function getRelatedSessionIds(sessionId: number): Promise<{ sessionIds: number[]; companionSessionName: string }> {
  const session = await getSessionById(sessionId);
  if (!session) return { sessionIds: [sessionId], companionSessionName: "" };

  const configId = session.config_id[0];
  const venDate = getVenezuelanDateFromUtc(session.start_at || session.stop_at || "");
  if (!venDate) return { sessionIds: [sessionId], companionSessionName: "" };

  const { startUtc, endUtc } = getUtcRangeForDate(venDate);

  // Group by fiscal machine configs: Caja 1 (1) ↔ CASHEA 1 (7), Caja 2 (2) ↔ CASHEA 2 (8)
  const relatedConfigs = (configId === 1 || configId === 7) ? [1, 7]
                       : (configId === 2 || configId === 8) ? [2, 8]
                       : [configId];

  console.log(`[getRelatedSessionIds] Session ${sessionId}, configId ${configId}, venDate: ${venDate}, configs: [${relatedConfigs.join(", ")}]`);

  const domain: any[] = [
    ["config_id", "in", relatedConfigs],
    "|",
    "&", ["start_at", ">=", startUtc], ["start_at", "<=", endUtc],
    "&", ["stop_at", ">=", startUtc], ["stop_at", "<=", endUtc],
    ["state", "in", ["opened", "closing_control", "closed"]],
  ];

  const matchedSessions = await executeKw("pos.session", "search_read",
    [domain],
    { fields: ["id", "name", "config_id", "serial_machine", "user_id", "start_at"] }
  );

  if (matchedSessions && matchedSessions.length > 0) {
    const companionConfigs = relatedConfigs.filter(c => c !== configId);
    
    let validSessionIds = [sessionId];
    let names = [`${session.config_id[1]} (${session.name})`];
    let companionNames: string[] = [];

    const mainStart = new Date(session.start_at || session.stop_at || 0).getTime();

    for (const compConfig of companionConfigs) {
      // Find all sessions for this companion config on the same day
      const compSessions = matchedSessions.filter((s: any) => s.config_id[0] === compConfig);
      
      if (compSessions.length > 0) {
        // Find the one closest in start time to the main session (handles multiple shifts)
        let closestSession = compSessions[0];
        let minDiff = Math.abs(new Date(closestSession.start_at || 0).getTime() - mainStart);
        
        for (let i = 1; i < compSessions.length; i++) {
          const diff = Math.abs(new Date(compSessions[i].start_at || 0).getTime() - mainStart);
          if (diff < minDiff) {
            closestSession = compSessions[i];
            minDiff = diff;
          }
        }
        
        validSessionIds.push(closestSession.id);
        const compName = `${closestSession.config_id[1]} (${closestSession.name})`;
        names.push(compName);
        companionNames.push(compName);
      }
    }

    const companionSessionName = companionNames.join(", ");
    console.log(`[getRelatedSessionIds] Found ${validSessionIds.length} valid related sessions: ${names.join(", ")}`);
    return { sessionIds: validSessionIds, companionSessionName };
  }

  return { sessionIds: [sessionId], companionSessionName: "" };
}

/**
 * Returns the set of pos.order IDs for a session that belong to fiscal journals.
 * Chain: pos.order → account.move → journal_id ∈ FISCAL_JOURNAL_IDS
 */
async function getFiscalOrderIds(sessionIds: number | number[]): Promise<Set<number>> {
  const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds];
  const orders = await executeKw("pos.order", "search_read",
    [[["session_id", "in", ids]]],
    { fields: ["id", "account_move"] }
  );

  if (!orders || orders.length === 0) return new Set();

  const orderMoveMap: Record<number, number> = {};
  const moveIds: number[] = [];
  for (const o of orders) {
    if (o.account_move) {
      const moveId = Array.isArray(o.account_move) ? o.account_move[0] : o.account_move;
      orderMoveMap[o.id] = moveId;
      moveIds.push(moveId);
    }
  }

  if (moveIds.length === 0) return new Set();

  const moves = await executeKw("account.move", "read",
    [moveIds],
    { fields: ["journal_id"] }
  );

  const moveJournalMap: Record<number, number> = {};
  for (const m of moves) {
    moveJournalMap[m.id] = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
  }

  const fiscalOrderIds = new Set<number>();
  for (const [orderId, moveId] of Object.entries(orderMoveMap)) {
    const journalId = moveJournalMap[moveId];
    if (journalId && FISCAL_JOURNAL_IDS.has(journalId)) {
      fiscalOrderIds.add(Number(orderId));
    }
  }

  return fiscalOrderIds;
}

export async function getSessions(date: string): Promise<any[]> {
  const { startUtc, endUtc } = getUtcRangeForDate(date);
  const sessions = await executeKw(
    "pos.session",
    "search_read",
    [[
      "|",
      "&", ["start_at", ">=", startUtc], ["start_at", "<=", endUtc],
      "&", ["stop_at", ">=", startUtc], ["stop_at", "<=", endUtc],
      ["state", "in", ["opened", "closing_control", "closed"]],
    ]],
    {
      fields: [
        "name", "config_id", "user_id", "state", "start_at", "stop_at",
        "report_z", "serial_machine",
        "cash_register_balance_start", "cash_register_balance_end",
        "cash_register_balance_end_real", "cash_register_difference",
        "total_payments_amount", "order_count",
      ],
      order: "id asc",
    }
  );
  return sessions || [];
}

export async function getSessionById(sessionId: number): Promise<any> {
  // Check cache first (1 minute TTL for sessions - they can change state)
  const cache = getSessionCache();
  const cacheKey = `session-${sessionId}`;
  const cached = cache.get<any>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const sessions = await executeKw(
    "pos.session",
    "read",
    [[sessionId]],
    {
      fields: [
        "name", "config_id", "user_id", "state", "start_at", "stop_at",
        "report_z", "serial_machine",
        "cash_register_balance_start", "cash_register_balance_end",
        "cash_register_balance_end_real", "cash_register_difference",
        "total_payments_amount", "order_count",
      ],
    }
  );
  const session = sessions?.[0] || null;
  if (session) {
    cache.set(cacheKey, session, 60 * 1000); // 1 minute TTL
  }
  return session;
}

export async function getSessionPayments(sessionIds: number | number[], fiscalOnly: boolean = true): Promise<PaymentGroup[]> {
  const ids = Array.isArray(sessionIds) ? sessionIds : [sessionIds];
  const payments = await executeKw(
    "pos.payment",
    "search_read",
    [[["session_id", "in", ids]]],
    {
      fields: ["amount", "payment_method_id", "pos_order_id"],
    }
  );

  let filteredPayments = payments || [];

  if (fiscalOnly) {
    const fiscalOrderIds = await getFiscalOrderIds(ids);
    filteredPayments = filteredPayments.filter((p: any) => {
      const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
      return fiscalOrderIds.has(orderId);
    });
  }

  // Get payment method details
  const methodIds = [...new Set(filteredPayments.map((p: any) => p.payment_method_id[0]))];
  let methodDetails: Record<number, { name: string; type: string }> = {};
  if (methodIds.length > 0) {
    const methods = await executeKw(
      "pos.payment.method",
      "read",
      [methodIds],
      { fields: ["name", "type"] }
    );
    for (const m of methods) {
      methodDetails[m.id] = { name: m.name, type: m.type || "bank" };
    }
  }

  // Group by method
  const groups: Record<number, PaymentGroup> = {};
  for (const p of filteredPayments) {
    const methodId = p.payment_method_id[0];
    const methodName = methodDetails[methodId]?.name || p.payment_method_id[1];
    if (!groups[methodId]) {
      groups[methodId] = {
        methodId,
        methodName,
        methodType: methodDetails[methodId]?.type || "bank",
        total: 0,
        count: 0,
      };
    }
    groups[methodId].total += p.amount;
    groups[methodId].count += 1;
  }

  // Round totals
  return Object.values(groups).map((g) => ({
    ...g,
    total: Math.round(g.total * 100) / 100,
  }));
}

export async function getSessionSummary(sessionId: number): Promise<OrderSummary> {
  const orders = await executeKw(
    "pos.order",
    "search_read",
    [[["session_id", "=", sessionId]]],
    {
      fields: ["amount_total", "amount_tax", "igtf_amount"],
    }
  );

  let totalSales = 0;
  let totalTax = 0;
  let totalIGTF = 0;
  let orderCount = 0;
  let refundCount = 0;
  let refundAmount = 0;

  for (const o of orders || []) {
    totalSales += o.amount_total || 0;
    totalTax += o.amount_tax || 0;
    totalIGTF += o.igtf_amount || 0;
    orderCount++;
    if (o.amount_total < 0) {
      refundCount++;
      refundAmount += o.amount_total;
    }
  }

  return {
    totalSales: Math.round(totalSales * 100) / 100,
    totalTax: Math.round(totalTax * 100) / 100,
    totalIGTF: Math.round(totalIGTF * 100) / 100,
    orderCount,
    refundCount,
    refundAmount: Math.round(refundAmount * 100) / 100,
  };
}

export async function getDayRate(date: string): Promise<number> {
  // Check cache first (5 minute TTL for rates)
  const cache = getRateCache();
  const cached = cache.get<number>(date);
  if (cached !== null) {
    return cached;
  }

  // VES currency id is 3 in Odoo
  // company_rate gives Bs per USD directly (e.g., 451.51)
  const rates = await executeKw(
    "res.currency.rate",
    "search_read",
    [[ ["currency_id", "=", 3], ["name", "=", date] ]],
    { fields: ["company_rate"], limit: 1 }
  );
  if (rates && rates.length > 0) {
    const rate = rates[0].company_rate || 0;
    cache.set(date, rate);
    return rate;
  }
  // Fallback: get latest rate
  const latestRates = await executeKw(
    "res.currency.rate",
    "search_read",
    [[["currency_id", "=", 3]]],
    { fields: ["company_rate", "name"], order: "name desc", limit: 1 }
  );
  const rate = latestRates?.[0]?.company_rate || 0;
  cache.set(date, rate);
  return rate;
}

export async function getRatesHistory(days: number = 30): Promise<Array<{date: string, rate: number}>> {
  const rates = await executeKw(
    "res.currency.rate",
    "search_read",
    [[["currency_id", "=", 3]]],
    { fields: ["name", "company_rate"], order: "name desc", limit: days }
  );
  return (rates || []).map((r: any) => ({
    date: r.name,
    rate: r.company_rate || 0,
  }));
}

export async function getPaymentMethods(): Promise<any[]> {
  // Check cache first (15 minute TTL for payment methods - they rarely change)
  const cache = getPaymentMethodCache();
  const cacheKey = "active-methods";
  const cached = cache.get<any[]>(cacheKey);
  if (cached !== null) {
    return cached;
  }

  const methods = await executeKw(
    "pos.payment.method",
    "search_read",
    [[["active", "=", true]]],
    {
      fields: ["name", "type", "is_cash_count"],
    }
  );
  const result = methods || [];
  cache.set(cacheKey, result, 15 * 60 * 1000); // 15 minute TTL
  return result;
}

// Export cache invalidation for when data changes
export function invalidateCaches(): void {
  getRateCache().clear();
  getSessionCache().clear();
  getPaymentMethodCache().clear();
  getCreditSalesCache().clear();
}

// Export cache stats for debugging/monitoring
export function getCacheStats(): { rate: number; session: number; paymentMethod: number; creditSales: number } {
  return {
    rate: getRateCache().size,
    session: getSessionCache().size,
    paymentMethod: getPaymentMethodCache().size,
    creditSales: getCreditSalesCache().size,
  };
}

export async function getFiscalSummary(sessionId: number): Promise<FiscalSummary> {
  // Get session to determine config_id and date
  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Sesión no encontrada");

  const configId = session.config_id[0];
  const journalInfo = CONFIG_JOURNAL_MAP[configId];
  if (!journalInfo) {
    throw new Error(`No hay diario fiscal configurado para config_id ${configId}`);
  }

  const date = getVenezuelanDateFromUtc(session.start_at || session.stop_at || "") || new Date().toISOString().split("T")[0];

  // Get related sessions (companion fiscal machine merge)
  const { sessionIds, companionSessionName } = await getRelatedSessionIds(sessionId);
  console.log(`[getFiscalSummary] Session ${sessionId}, date ${date}, related sessions: ${sessionIds.join(", ")}`);

  // Determine main vs companion session IDs and their caja names (need this before filtering invoices)
  const mainSessionId = sessionId;
  const companionSessionId = sessionIds.find(sid => sid !== mainSessionId);
  const mainCajaName = session.config_id[1] || "";
  
  // Get ALL journals from ALL related sessions
  const allowedJournals = new Set<number>([journalInfo.journalId]);
  const sessionJournals: Record<number, { journalId: number; journalCode: string; cajaName: string }> = {};
  sessionJournals[sessionId] = { journalId: journalInfo.journalId, journalCode: journalInfo.journalCode, cajaName: mainCajaName };
  
  let companionCajaName = "";
  let companionJournalCode = "";
  let companionJournalId: number | undefined = undefined;
  
  for (const sid of sessionIds) {
    if (sid !== sessionId) {
      const s = await getSessionById(sid);
      if (s) {
        const cj = CONFIG_JOURNAL_MAP[s.config_id[0]];
        if (cj) {
          allowedJournals.add(cj.journalId);
          sessionJournals[sid] = { journalId: cj.journalId, journalCode: cj.journalCode, cajaName: s.config_id[1] || "" };
          // Keep backward compatibility with companion variables
          if (!companionJournalId) {
            companionCajaName = s.config_id[1] || "";
            companionJournalCode = cj.journalCode;
            companionJournalId = cj.journalId;
          }
        }
      }
    }
  }

  // Get exchange rate
  const rate = await getDayRate(date);

  // Current session's serial_machine — documents from other machines must be excluded
  const currentSerialMachine = session.serial_machine || "";

  // --- SESSION-BASED INVOICE QUERY ---
  // Query invoices through POS sessions → orders → account.move
  // This ensures we only get invoices from THIS session's orders, not all invoices
  // on the shared journal (fixes FAC4 shared between CASHEA 1 and CASHEA 2).
  const allOrders = await executeKw("pos.order", "search_read",
    [[["session_id", "in", sessionIds]]],
    { fields: ["id", "account_move", "session_id"] }
  );
  console.log(`[getFiscalSummary] Total orders found: ${allOrders?.length || 0}`);

  // Build order→move mapping, filtered to fiscal journals only
  const moveIds: number[] = [];
  const orderMoveMap: Record<number, number> = {};
  const orderSessionMap: Record<number, number> = {};
  for (const o of allOrders || []) {
    if (o.account_move) {
      const moveId = Array.isArray(o.account_move) ? o.account_move[0] : o.account_move;
      orderMoveMap[o.id] = moveId;
      orderSessionMap[o.id] = Array.isArray(o.session_id) ? o.session_id[0] : o.session_id;
      moveIds.push(moveId);
    }
  }

  // Build session→serial_machine map for fiscal machine validation
  const sessionSerialMap: Record<number, string> = {};
  // Add main session serial (current session)
  sessionSerialMap[mainSessionId] = currentSerialMachine;
  // Add companion session serial if available (already fetched earlier)
  if (companionSessionId) {
    const cs = await getSessionById(companionSessionId);
    if (cs) sessionSerialMap[companionSessionId] = cs.serial_machine || "";
  }
  // Add all order-linked sessions
  const allSessionIds = [...new Set(Object.values(orderSessionMap))];
  if (allSessionIds.length > 0) {
    const sessionsData = await executeKw("pos.session", "read",
      [allSessionIds],
      { fields: ["id", "serial_machine"] }
    );
    for (const s of sessionsData || []) {
      sessionSerialMap[s.id] = s.serial_machine || "";
    }
  }

  // Read all moves and filter to fiscal journals + posted invoices/refunds
  let invoices: any[] = [];
  if (moveIds.length > 0) {
    const allMoves = await executeKw("account.move", "read",
      [moveIds],
      {
        fields: [
          "id", "journal_id", "state", "move_type",
          "amount_total", "amount_untaxed", "amount_tax",
          "foreign_total_billed", "foreign_taxable_income", "foreign_rate",
          "name",
        ],
      }
    );
    invoices = (allMoves || []).filter((m: any) => {
      const jid = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
      // Include invoices/NCs from all related session journals (same fiscal machine)
      if (!allowedJournals.has(jid)) return false;
      if (m.state !== "posted") return false;
      if (m.move_type !== "out_invoice" && m.move_type !== "out_refund") return false;

      // CRITICAL: Exclude documents whose originating session has a different fiscal machine.
      // This prevents cross-contamination when a document is registered in the wrong journal
      // (e.g., a Caja 1 NC accidentally created in Caja 2's journal).
      if (currentSerialMachine) {
        const originOrderId = Object.entries(orderMoveMap).find(([, moveId]) => moveId === m.id)?.[0];
        if (originOrderId) {
          const originSessionId = orderSessionMap[Number(originOrderId)];
          const originSerial = sessionSerialMap[originSessionId] || "";
          if (originSerial && originSerial !== currentSerialMachine) {
            console.log(`[getFiscalSummary] EXCLUDED doc ${m.name} — serial mismatch: ${originSerial} != ${currentSerialMachine}`);
            return false;
          }
        }
      }

      return true;
    });
    console.log(`[getFiscalSummary] Total moves: ${moveIds.length}, invoices filtered: ${invoices.length}`);
    console.log(`[getFiscalSummary] Invoice names: ${invoices.map((i: any) => i.name).slice(0, 20).join(", ")}`);
  }

  // Build move→session mapping for per-caja tracking
  const moveSessionMap: Record<number, number> = {};
  for (const [orderId, moveId] of Object.entries(orderMoveMap)) {
    moveSessionMap[moveId] = orderSessionMap[Number(orderId)];
  }

  let totalUSD = 0;
  let totalTaxUSD = 0;
  let totalVES = 0;
  let invoiceCount = 0;
  let ncCount = 0;
  const invoiceNames: string[] = [];
  const ncNames: string[] = [];
  // Per-caja tracking
  const mainInvoiceNames: string[] = [];
  const mainNcNames: string[] = [];
  const companionInvoiceNames: string[] = [];
  const companionNcNames: string[] = [];
  let mainInvoiceCount = 0;
  let mainNcCount = 0;
  let companionInvoiceCount = 0;
  let companionNcCount = 0;

  for (const inv of invoices) {
    const isFromCompanion = companionSessionId && moveSessionMap[inv.id] === companionSessionId;
    if (inv.move_type === "out_refund") {
      ncCount++;
      totalUSD -= inv.amount_total || 0;
      totalTaxUSD -= inv.amount_tax || 0;
      totalVES -= inv.foreign_total_billed || 0;
      if (inv.name) {
        ncNames.push(inv.name);
        if (isFromCompanion) { companionNcNames.push(inv.name); companionNcCount++; }
        else { mainNcNames.push(inv.name); mainNcCount++; }
      }
    } else {
      invoiceCount++;
      totalUSD += inv.amount_total || 0;
      totalTaxUSD += inv.amount_tax || 0;
      totalVES += inv.foreign_total_billed || 0;
      if (inv.name) {
        invoiceNames.push(inv.name);
        if (isFromCompanion) { companionInvoiceNames.push(inv.name); companionInvoiceCount++; }
        else { mainInvoiceNames.push(inv.name); mainInvoiceCount++; }
      }
    }
  }

  // Sort names to get first/last
  invoiceNames.sort();
  ncNames.sort();

  // --- FALLBACK: Always search NCs directly by journal+date ---
    // Some NCs are created directly in accounting (not through POS refunds)
    // and won't appear in the order→move mapping. We must find them regardless
    // of how many NCs were found through POS orders.
    const searchJournals = [journalInfo.journalId];
    if (companionJournalId) searchJournals.push(companionJournalId);
    
    for (const journalId of searchJournals) {
      const directNCs = await executeKw("account.move", "search_read", [[
        ["journal_id", "=", journalId],
        ["move_type", "=", "out_refund"],
        ["state", "=", "posted"],
        ["date", "=", date],
      ]], {
        fields: ["id", "name", "amount_total", "amount_tax", "foreign_total_billed", "journal_id", "ref"],
      });
      // Exclude any NCs already counted from POS orders
      const existingMoveIds = new Set(Object.values(orderMoveMap));
      for (const nc of directNCs || []) {
        if (existingMoveIds.has(nc.id)) continue;

        // Try to determine the originating session through ref or payment references
        // If we can't determine it, include the NC (safe default) but log a warning
        let ncSerial = "";
        const ref = nc.ref || "";
        // Try to find a POS order reference in the NC's ref field
        if (ref) {
          const matchingOrder = (allOrders || []).find((o: any) => ref.includes(o.name || ""));
          if (matchingOrder) {
            const orderSessionId = Array.isArray(matchingOrder.session_id) ? matchingOrder.session_id[0] : matchingOrder.session_id;
            ncSerial = sessionSerialMap[orderSessionId] || "";
          }
        }

        if (ncSerial && ncSerial !== currentSerialMachine) {
          console.log(`[getFiscalSummary] EXCLUDED direct NC ${nc.name} — serial mismatch: ${ncSerial} != ${currentSerialMachine}`);
          continue;
        }

        const isFromCompanion = companionJournalId && (Array.isArray(nc.journal_id) ? nc.journal_id[0] : nc.journal_id) === companionJournalId;
        ncCount++;
        totalUSD -= nc.amount_total || 0;
        totalTaxUSD -= nc.amount_tax || 0;
        totalVES -= nc.foreign_total_billed || 0;
        if (nc.name) {
          ncNames.push(nc.name);
          if (isFromCompanion) { companionNcNames.push(nc.name); companionNcCount++; }
          else { mainNcNames.push(nc.name); mainNcCount++; }
        }
      }
    }
      // Re-sort NC names after fallback
    ncNames.sort();
    mainNcNames.sort();
  mainInvoiceNames.sort();
  mainNcNames.sort();
  companionInvoiceNames.sort();
  companionNcNames.sort();

  // Get POS payments grouped by method from ALL related sessions, converted to Bs
  // WARNING: All payment methods from fiscal journal orders must be included.
  // The fiscal journal filter (getFiscalOrderIds) already ensures only invoice-journal
  // payments are returned. Do NOT add additional method-ID exclusions here.
  //
  // Also get per-session payments to tag companion (CASHEA) methods with isCompanion
  const posPayments = await getSessionPayments(sessionIds);

  // Get per-session payment breakdown for companion tagging
  const mainMethodTotals: Record<number, number> = {};
  const companionMethodTotals: Record<number, number> = {};
  if (companionSessionId) {
    const [mainPmts, companionPmts] = await Promise.all([
      getSessionPayments([mainSessionId]),
      getSessionPayments([companionSessionId]),
    ]);
    for (const mp of mainPmts) {
      mainMethodTotals[mp.methodId] = mp.total;
    }
    for (const cp of companionPmts) {
      companionMethodTotals[cp.methodId] = cp.total;
    }
  }

  const payments: FiscalPayment[] = posPayments.map((p) => ({
    methodId: p.methodId,
    methodName: p.methodName,
    totalUSD: p.total,
    totalBs: Math.round(p.total * rate * 100) / 100,
    // Mark as companion if ANY of this method's payments came from companion session
    isCompanion: companionSessionId
      ? (companionMethodTotals[p.methodId] || 0) > 0
      : false,
    mainAmountUSD: companionSessionId ? (mainMethodTotals[p.methodId] || 0) : undefined,
    companionAmountUSD: companionSessionId ? (companionMethodTotals[p.methodId] || 0) : undefined,
    mainAmountBs: companionSessionId ? Math.round((mainMethodTotals[p.methodId] || 0) * rate * 100) / 100 : undefined,
    companionAmountBs: companionSessionId ? Math.round((companionMethodTotals[p.methodId] || 0) * rate * 100) / 100 : undefined,
  }));

  // For delivery/diferencia methods, fetch individual order references
  const deliveryDifMethods = payments.filter(p =>
    p.methodName.toLowerCase().includes("delivery") || p.methodName.toLowerCase().includes("diferencia")
  );
  if (deliveryDifMethods.length > 0) {
    const ddMethodIds = deliveryDifMethods.map(p => p.methodId);
    const ddPayments = await executeKw("pos.payment", "search_read",
      [[
        ["session_id", "in", sessionIds],
        ["payment_method_id", "in", ddMethodIds],
      ]],
      { fields: ["payment_method_id", "pos_order_id"] }
    );
    // Filter to fiscal orders only
    const fiscalOids = await getFiscalOrderIds(sessionIds);
    const fiscalDdPayments = (ddPayments || []).filter((p: any) => {
      const oid = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
      return fiscalOids.has(oid);
    });
    // Group order IDs by method
    const orderIdsByMethod: Record<number, Set<number>> = {};
    for (const p of fiscalDdPayments) {
      const mid = p.payment_method_id[0];
      const oid = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
      if (!orderIdsByMethod[mid]) orderIdsByMethod[mid] = new Set();
      orderIdsByMethod[mid].add(oid);
    }
    // Read order names
    const allOids = [...new Set(fiscalDdPayments.map((p: any) => {
      return Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    }))];
    let orderNameMap: Record<number, string> = {};
    if (allOids.length > 0) {
      const orders = await executeKw("pos.order", "read", [allOids], { fields: ["name"] });
      for (const o of orders || []) {
        orderNameMap[o.id] = o.name || `#${o.id}`;
      }
    }
    // Attach orderRefs to payments
    for (const pm of payments) {
      if (orderIdsByMethod[pm.methodId]) {
        pm.orderRefs = [...orderIdsByMethod[pm.methodId]].map(id => orderNameMap[id] || `#${id}`);
      }
    }
  }

  // Calculate special method totals
  let totalRetencionesPOS = 0;
  let totalCreditoPOS = 0;
  let totalSaldoFavorPOS = 0;
  for (const p of posPayments) {
    if (p.methodId === METHOD_RETENCION_IVA) {
      totalRetencionesPOS += p.total;
    } else if (CREDIT_METHOD_IDS.includes(p.methodId)) {
      totalCreditoPOS += p.total;
    } else if (p.methodId === METHOD_SALDO_FAVOR) {
      totalSaldoFavorPOS += p.total;
    }
  }

  return {
    journalId: journalInfo.journalId,
    journalCode: journalInfo.journalCode,
    invoiceCount,
    ncCount,
    totalUSD: Math.round(totalUSD * 100) / 100,
    totalTaxUSD: Math.round(totalTaxUSD * 100) / 100,
    totalVES: Math.round(totalVES * 100) / 100,
    rate,
    payments,
    totalRetencionesPOS: Math.round(totalRetencionesPOS * 100) / 100,
    totalCreditoPOS: Math.round(totalCreditoPOS * 100) / 100,
    totalSaldoFavorPOS: Math.round(totalSaldoFavorPOS * 100) / 100,
    firstInvoice: invoiceNames[0] || "",
    lastInvoice: invoiceNames[invoiceNames.length - 1] || "",
    firstNC: ncNames[0] || "",
    lastNC: ncNames[ncNames.length - 1] || "",
    companionSessionName,
    // Per-caja ranges
    mainJournalCode: journalInfo.journalCode,
    mainCajaName,
    mainFirstInvoice: mainInvoiceNames[0] || undefined,
    mainLastInvoice: mainInvoiceNames[mainInvoiceNames.length - 1] || undefined,
    mainInvoiceCount: mainInvoiceCount || undefined,
    mainFirstNC: mainNcNames[0] || undefined,
    mainLastNC: mainNcNames[mainNcNames.length - 1] || undefined,
    mainNcCount: mainNcCount || undefined,
    companionJournalCode: companionJournalCode || undefined,
    companionCajaName: companionCajaName || undefined,
    companionFirstInvoice: companionInvoiceNames[0] || undefined,
    companionLastInvoice: companionInvoiceNames[companionInvoiceNames.length - 1] || undefined,
    companionInvoiceCount: companionInvoiceCount || undefined,
    companionFirstNC: companionNcNames[0] || undefined,
    companionLastNC: companionNcNames[companionNcNames.length - 1] || undefined,
    companionNcCount: companionNcCount || undefined,
  };
}

/**
 * Debug: get all invoices for a session with full details for discrepancy diagnosis
 */
export async function debugFiscalSummary(sessionId: number): Promise<any> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Sesión no encontrada");

  const configId = session.config_id[0];
  const journalInfo = CONFIG_JOURNAL_MAP[configId];
  if (!journalInfo) throw new Error(`No hay diario fiscal configurado para config_id ${configId}`);

  const date = getVenezuelanDateFromUtc(session.start_at || session.stop_at || "") || new Date().toISOString().split("T")[0];
  const { sessionIds, companionSessionName } = await getRelatedSessionIds(sessionId);

  // Get ALL journals from ALL related sessions
  const allowedJournals = new Set<number>([journalInfo.journalId]);
  const sessionJournals: Record<string, { journalId: number; journalCode: string }> = {};
  sessionJournals[String(sessionId)] = { journalId: journalInfo.journalId, journalCode: journalInfo.journalCode };
  
  for (const sid of sessionIds) {
    if (sid !== sessionId) {
      const s = await getSessionById(sid);
      if (s) {
        const cj = CONFIG_JOURNAL_MAP[s.config_id[0]];
        if (cj) {
          allowedJournals.add(cj.journalId);
          sessionJournals[String(sid)] = { journalId: cj.journalId, journalCode: cj.journalCode };
        }
      }
    }
  }

  const allOrders = await executeKw("pos.order", "search_read",
    [[["session_id", "in", sessionIds]]],
    { fields: ["id", "account_move", "session_id", "name"] }
  );

  const moveIds: number[] = [];
  const orderMoveMap: Record<number, number> = {};
  const orderSessionMap: Record<number, number> = {};
  for (const o of allOrders || []) {
    if (o.account_move) {
      const moveId = Array.isArray(o.account_move) ? o.account_move[0] : o.account_move;
      orderMoveMap[o.id] = moveId;
      orderSessionMap[o.id] = Array.isArray(o.session_id) ? o.session_id[0] : o.session_id;
      moveIds.push(moveId);
    }
  }

  let allMoves: any[] = [];
  if (moveIds.length > 0) {
    allMoves = await executeKw("account.move", "read",
      [moveIds],
      {
        fields: [
          "id", "journal_id", "state", "move_type",
          "amount_total", "amount_untaxed", "amount_tax",
          "foreign_total_billed", "foreign_taxable_income", "foreign_rate",
          "name", "invoice_date",
        ],
      }
    );
  }

  const invoices = allMoves.filter((m: any) => {
    const jid = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
    return allowedJournals.has(jid)
      && m.state === "posted"
      && (m.move_type === "out_invoice" || m.move_type === "out_refund");
  });

  const excludedByJournal = allMoves.filter((m: any) => {
    const jid = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
    return !allowedJournals.has(jid)
      && m.state === "posted"
      && (m.move_type === "out_invoice" || m.move_type === "out_refund");
  });

  const excludedByState = allMoves.filter((m: any) => {
    const jid = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
    return allowedJournals.has(jid)
      && m.state !== "posted"
      && (m.move_type === "out_invoice" || m.move_type === "out_refund");
  });

  const excludedByType = allMoves.filter((m: any) => {
    const jid = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
    return allowedJournals.has(jid)
      && m.state === "posted"
      && m.move_type !== "out_invoice"
      && m.move_type !== "out_refund";
  });

  // Group by session
  const bySession: Record<string, any[]> = {};
  for (const inv of invoices) {
    const moveId = inv.id;
    const orderId = Object.keys(orderMoveMap).find(k => orderMoveMap[Number(k)] === moveId);
    const sid = orderId ? orderSessionMap[Number(orderId)] : null;
    const key = String(sid || "unknown");
    if (!bySession[key]) bySession[key] = [];
    bySession[key].push({
      id: inv.id,
      name: inv.name,
      moveType: inv.move_type,
      amountTotal: inv.amount_total,
      foreignTotal: inv.foreign_total_billed,
      foreignRate: inv.foreign_rate,
      journalId: Array.isArray(inv.journal_id) ? inv.journal_id[0] : inv.journal_id,
      state: inv.state,
      invoiceDate: inv.invoice_date,
    });
  }

  return {
    sessionId,
    sessionName: session.name,
    configId,
    date,
    sessionIds,
    companionSessionName,
    mainJournalId: journalInfo.journalId,
    mainJournalCode: journalInfo.journalCode,
    sessionJournals,
    allowedJournals: [...allowedJournals],
    totalOrders: allOrders?.length || 0,
    totalMoves: moveIds.length,
    includedInvoices: invoices.length,
    includedByType: {
      invoices: invoices.filter(i => i.move_type === "out_invoice").length,
      refunds: invoices.filter(i => i.move_type === "out_refund").length,
    },
    excludedByJournal: excludedByJournal.length,
    excludedByState: excludedByState.length,
    excludedByType: excludedByType.length,
    bySession,
    allInvoiceNames: invoices.map(i => i.name).sort(),
    excludedInvoiceNames: [
      ...excludedByJournal.map(i => ({ name: i.name, reason: "journal", journalId: Array.isArray(i.journal_id) ? i.journal_id[0] : i.journal_id })),
      ...excludedByState.map(i => ({ name: i.name, reason: "state", state: i.state })),
      ...excludedByType.map(i => ({ name: i.name, reason: "type", type: i.move_type })),
    ],
  };
}

/**
 * Get IVA retentions for a session: cross-references POS retention payments
 * with RIVAC journal entries to verify registration status.
 */
export async function getSessionRetentions(sessionId: number): Promise<RetentionRow[]> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Sesión no encontrada");

  const configId = session.config_id[0];
  const journalInfo = CONFIG_JOURNAL_MAP[configId];
  if (!journalInfo) throw new Error(`No hay diario fiscal configurado para config_id ${configId}`);

  const date = getVenezuelanDateFromUtc(session.start_at || session.stop_at || "") || new Date().toISOString().split("T")[0];

  // Get related sessions (companion fiscal machine merge)
  const { sessionIds } = await getRelatedSessionIds(sessionId);

  // --- SESSION-BASED INVOICE QUERY ---
  // Query invoices through POS sessions → orders → account.move
  // This ensures we only get invoices from THIS session's orders, not all invoices
  // on the shared journal (fixes FAC4 shared between CASHEA 1 and CASHEA 2).
  const allOrders = await executeKw("pos.order", "search_read",
    [[["session_id", "in", sessionIds]]],
    { fields: ["id", "account_move"] }
  );

  const moveIds: number[] = [];
  for (const o of allOrders || []) {
    if (o.account_move) {
      const moveId = Array.isArray(o.account_move) ? o.account_move[0] : o.account_move;
      moveIds.push(moveId);
    }
  }

  // Read all moves and filter to fiscal journals + posted invoices
  let invoices: any[] = [];
  if (moveIds.length > 0) {
    const allMoves = await executeKw("account.move", "read",
      [moveIds],
      { fields: ["id", "journal_id", "state", "move_type", "name", "partner_id", "amount_total"] }
    );
    invoices = (allMoves || []).filter((m: any) => {
      const jid = Array.isArray(m.journal_id) ? m.journal_id[0] : m.journal_id;
      return FISCAL_JOURNAL_IDS.has(jid)
        && m.state === "posted"
        && m.move_type === "out_invoice";
    });
  }

  if (invoices.length === 0) return [];

  // Extract invoice numbers from invoice names (e.g., "FAC01 00029888" → "00029888")
  const invoiceMap: Record<string, { name: string; partner: string; total: number }> = {};
  for (const inv of invoices) {
    const parts = (inv.name || "").split(" ");
    const invoiceNumber = parts[parts.length - 1]; // last part is the number
    if (invoiceNumber) {
      invoiceMap[invoiceNumber] = {
        name: inv.name,
        partner: inv.partner_id ? inv.partner_id[1] : "",
        total: inv.amount_total || 0,
      };
    }
  }

  // 2. Get POS payments with method=26 (Retención de IVA) for all related sessions, filtered by fiscal journal
  const allRetentionPayments = await executeKw(
    "pos.payment",
    "search_read",
    [[
      ["session_id", "in", sessionIds],
      ["payment_method_id", "=", METHOD_RETENCION_IVA],
    ]],
    {
      fields: ["amount", "pos_order_id"],
    }
  );

  const fiscalOrderIds = await getFiscalOrderIds(sessionIds);
  const retentionPayments = (allRetentionPayments || []).filter((p: any) => {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    return fiscalOrderIds.has(orderId);
  });

  // Map POS orders to invoices to get per-invoice retention amounts
  const orderIds = [...new Set(retentionPayments.map((p: any) => p.pos_order_id[0]))];
  const orderInvoiceMap: Record<number, string> = {};
  if (orderIds.length > 0) {
    const orders = await executeKw(
      "pos.order",
      "read",
      [orderIds],
      { fields: ["account_move"] }
    );
    // Batch read all moves at once
    const moveIds = orders?.filter((o: any) => o.account_move && o.account_move.length > 0).map((o: any) => o.account_move[0]) || [];
    const moveInvoiceMap: Record<number, string> = {};
    if (moveIds.length > 0) {
      const moves = await executeKw(
        "account.move",
        "read",
        [moveIds],
        { fields: ["name"] }
      );
      for (const m of moves || []) {
        const parts = (m.name || "").split(" ");
        moveInvoiceMap[m.id] = parts[parts.length - 1];
      }
    }
    for (const order of orders || []) {
      if (order.account_move && order.account_move.length > 0) {
        const moveId = order.account_move[0];
        orderInvoiceMap[order.id] = moveInvoiceMap[moveId] || "";
      }
    }
  }

  // Build per-invoice retention amounts from POS
  const posRetentionByInvoice: Record<string, number> = {};
  for (const p of retentionPayments || []) {
    const orderId = p.pos_order_id[0];
    const invoiceNumber = orderInvoiceMap[orderId];
    if (invoiceNumber) {
      posRetentionByInvoice[invoiceNumber] = (posRetentionByInvoice[invoiceNumber] || 0) + p.amount;
    }
  }

  // 3. Search RIVAC journal (id=1) entries where name contains any invoice number
  const invoiceNumbers = Object.keys(posRetentionByInvoice);
  if (invoiceNumbers.length === 0) return [];

  const results: RetentionRow[] = [];

  for (const invoiceNumber of invoiceNumbers) {
    // Search RIVAC entries where name contains the invoice number, filtered by session date
    const rivacEntries = await executeKw(
      "account.move",
      "search_read",
      [[
        ["journal_id", "=", RIVAC_JOURNAL_ID],
        ["name", "ilike", invoiceNumber],
        ["date", "=", date],
        ["state", "=", "posted"],
      ]],
      {
        fields: ["name", "amount_total"],
        limit: 5,
      }
    );

    const invInfo = invoiceMap[invoiceNumber] || { name: invoiceNumber, partner: "", total: 0 };
    const posAmount = Math.round((posRetentionByInvoice[invoiceNumber] || 0) * 100) / 100;

    if (rivacEntries && rivacEntries.length > 0) {
      // Retention found in RIVAC
      const rivacEntry = rivacEntries[0];
      results.push({
        invoiceNumber,
        partner: invInfo.partner,
        posTotalUSD: posAmount,
        posTotalBs: 0,
        retentionAmount: Math.round((rivacEntry.amount_total || 0) * 100) / 100,
        retentionAmountBs: 0,
        rivacEntryName: rivacEntry.name || "",
        status: "registered",
      });
    } else {
      // Retention in POS but not yet in RIVAC
      results.push({
        invoiceNumber,
        partner: invInfo.partner,
        posTotalUSD: posAmount,
        posTotalBs: 0,
        retentionAmount: 0,
        retentionAmountBs: 0,
        rivacEntryName: "",
        status: "pending",
      });
    }
  }

  return results;
}

// DEBUG: Get credit sales with full invoice data
export async function getCreditSalesDebug(sessionId: number): Promise<any> {
  const session = await getSessionById(sessionId);
  if (!session) return { error: "Session not found" };
  const sessionDate = (session.start_at || "").substring(0, 10);
  const rate = await getDayRate(sessionDate);

  const { sessionIds } = await getRelatedSessionIds(sessionId);

  // Get credit payments from POS
  const allCreditPayments = await executeKw(
    "pos.payment",
    "search_read",
    [[
      ["session_id", "in", sessionIds],
      ["payment_method_id", "in", CREDIT_METHOD_IDS],
    ]],
    { fields: ["amount", "pos_order_id"] }
  );

  const fiscalOrderIds = await getFiscalOrderIds(sessionIds);
  const creditPayments = (allCreditPayments || []).filter((p: any) => {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    return fiscalOrderIds.has(orderId);
  });

  if (creditPayments.length === 0) return { invoices: [], debug: { rate, sessionDate, sessionIds } };

  const orderPayments: Record<number, number> = {};
  for (const p of creditPayments) {
    const orderId = p.pos_order_id[0];
    orderPayments[orderId] = (orderPayments[orderId] || 0) + p.amount;
  }
  const orderIds = Object.keys(orderPayments).map(Number);

  // Get orders with invoices
  const orders = await executeKw(
    "pos.order",
    "search_read",
    [[["id", "in", orderIds]]],
    { fields: ["id", "name", "account_move", "partner_id"] }
  );

  // Get retenciones from POS
  const retenciones = await executeKw(
    "pos.payment",
    "search_read",
    [[
      ["session_id", "in", sessionIds],
      ["payment_method_id", "=", METHOD_RETENCION_IVA],
    ]],
    { fields: ["amount", "pos_order_id"] }
  );
  const retencionesByOrder: Record<number, number> = {};
  for (const r of retenciones || []) {
    const oid = r.pos_order_id[0];
    retencionesByOrder[oid] = (retencionesByOrder[oid] || 0) + Math.abs(r.amount);
  }

  // Get delivery payments
  const deliveryPayments = await executeKw(
    "pos.payment",
    "search_read",
    [[
      ["session_id", "in", sessionIds],
    ]],
    { fields: ["amount", "pos_order_id", "payment_method_id"] }
  );
  const methods = await executeKw(
    "pos.payment.method",
    "search_read",
    [[["active", "=", true]]],
    { fields: ["id", "name"] }
  );
  const methodMap: Record<number, string> = {};
  for (const m of methods || []) {
    methodMap[m.id] = m.name;
  }
  const deliveryByOrder: Record<number, number> = {};
  for (const p of deliveryPayments || []) {
    const methodName = methodMap[p.payment_method_id[0]] || "";
    if (methodName.toLowerCase().includes("delivery")) {
      const oid = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
      deliveryByOrder[oid] = (deliveryByOrder[oid] || 0) + Math.abs(p.amount);
    }
  }

  // Process each invoice
  const invoices = [];
  for (const order of orders || []) {
    if (!order.account_move || order.account_move.length === 0) continue;
    const moveId = order.account_move[0];

    // Read invoice - ONLY specify safe fields (avoid payment_state which triggers broken computed field)
    let invoice: any = null;
    try {
      const moves = await executeKw(
        "account.move",
        "read",
        [[moveId]],
        { fields: ["name", "partner_id", "amount_total", "amount_residual", "currency_id", "move_type"] }
      );
      invoice = moves?.[0];
    } catch (err: any) {
      // If read fails due to broken computed field, try with minimal fields
      const moves = await executeKw(
        "account.move",
        "read",
        [[moveId]],
        { fields: ["name", "partner_id", "amount_total", "amount_residual", "move_type"] }
      );
      invoice = moves?.[0];
    }
    if (!invoice) continue;

    // Check if this is a credit note (out_refund) - negate the amount if so
    const isRefund = invoice.move_type === "out_refund";
    const sign = isRefund ? -1 : 1;

    // Get real payments from reconciled lines
    // Find all credit lines on this invoice
    const creditLines = await executeKw(
      "account.move.line",
      "search_read",
      [[
        ["move_id", "=", moveId],
        ["account_type", "=", "asset_receivable"],
        ["credit", ">", 0],
      ]],
      { fields: ["credit", "currency_id", "journal_id", "name"] }
    );

    // Sum all payments from reconciled credit lines
    let pagoReal = 0;
    let journalName = "";
    for (const line of creditLines || []) {
      pagoReal += Math.abs(line.credit || 0);
      if (line.journal_id && !journalName) {
        journalName = Array.isArray(line.journal_id) ? line.journal_id[1] : "Journal";
      }
    }

    const retencion = Math.round((retencionesByOrder[order.id] || 0) * 100) / 100;
    const delivery = Math.round((deliveryByOrder[order.id] || 0) * 100) / 100;
    const montoFactura = Math.round((invoice.amount_total || 0) * 100) / 100 * sign;
    
    // Saldo = Factura - Pago - Retencion (apply sign to retencion too for refunds)
    const saldo = Math.round((montoFactura - (pagoReal * sign) - (retencion * sign)) * 100) / 100;

    // Determine payment state from credit lines (avoid payment_state which triggers broken computed field)
    let paymentState = isRefund ? "refunded" : "not_paid";
    if (!isRefund && creditLines && creditLines.length > 0) {
      paymentState = pagoReal >= Math.abs(montoFactura) ? "paid" : "partial";
    }

    invoices.push({
      invoiceNumber: invoice.name,
      partner: invoice.partner_id ? invoice.partner_id[1] : "",
      montoFactura,
      pagoReal: pagoReal * sign,
      retencion: retencion * sign,
      delivery: delivery * sign,
      saldo,
      paymentState
    });
  }

  return { invoices, debug: { rate, sessionDate, sessionIds } };
}

/**
 * Get credit sales for a session: POS payments with method_id=14 (Venta a crédito),
 * then traces abonos via account.partial.reconcile.
 */
export async function getCreditSales(sessionId: number): Promise<CreditSaleRow[]> {
  // Check cache first (5 minute TTL)
  const cache = getCreditSalesCache();
  const cached = cache.get<CreditSaleRow[]>(String(sessionId));
  if (cached) return cached;

  // 0. Get session date for filtering abonos
  const session = await getSessionById(sessionId);
  if (!session) return [];
  const sessionDate = (session.start_at || "").substring(0, 10);
  const rate = await getDayRate(sessionDate);

  // Get related sessions (companion fiscal machine merge)
  const { sessionIds } = await getRelatedSessionIds(sessionId);

  // 1. Get POS payments with credit method (14, 33 = pay_later) for all related sessions, filtered by fiscal journal
  const allCreditPayments = await executeKw(
    "pos.payment",
    "search_read",
    [[
      ["session_id", "in", sessionIds],
      ["payment_method_id", "in", CREDIT_METHOD_IDS],
    ]],
    {
      fields: ["amount", "pos_order_id"],
    }
  );

  const fiscalOrderIds = await getFiscalOrderIds(sessionIds);
  const creditPayments = (allCreditPayments || []).filter((p: any) => {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    return fiscalOrderIds.has(orderId);
  });

  if (creditPayments.length === 0) return [];

  // Group payments by order
  const orderPayments: Record<number, number> = {};
  for (const p of creditPayments) {
    const orderId = p.pos_order_id[0];
    orderPayments[orderId] = (orderPayments[orderId] || 0) + p.amount;
  }

  const orderIds = Object.keys(orderPayments).map(Number);

          // Also get retention payments (method 26) for these same orders to track overlap
    const allRetPaymentsForOrders = await executeKw(
      "pos.payment",
      "search_read",
      [[
        ["pos_order_id", "in", orderIds],
        ["payment_method_id", "=", METHOD_RETENCION_IVA],
      ]],
      { fields: ["amount", "pos_order_id"] }
    );
    const retentionByOrder: Record<number, number> = {};
    for (const rp of allRetPaymentsForOrders || []) {
      const oid = rp.pos_order_id[0];
      retentionByOrder[oid] = (retentionByOrder[oid] || 0) + rp.amount;
    }

  // 2. Get pos.order → account_move (invoice)
  const orders = await executeKw(
    "pos.order",
    "read",
    [orderIds],
    { fields: ["account_move", "partner_id"] }
  );

  // Get all payments for credit orders (to calculate paymentTotal)
  const allOrderPayments = await executeKw(
    "pos.payment",
    "search_read",
    [[["pos_order_id", "in", orderIds]]],
    { fields: ["amount", "pos_order_id", "payment_method_id"] }
  );

  // Get payment method names for excedente detection
  const paymentMethods = await executeKw(
    "pos.payment.method",
    "search_read",
    [[["active", "=", true]]],
    { fields: ["name", "id"] }
  );
  const paymentMethodsMap: Record<number, string> = {};
  for (const m of paymentMethods || []) {
    paymentMethodsMap[m.id] = m.name;
  }

  // Group all payments by order
  const allPaymentsByOrder: Record<number, any[]> = {};
  for (const p of allOrderPayments || []) {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    if (!allPaymentsByOrder[orderId]) allPaymentsByOrder[orderId] = [];
    allPaymentsByOrder[orderId].push(p);
  }

  const results: CreditSaleRow[] = [];

  // Batch read all invoices at once
  const moveIds = (orders || [])
    .filter((o: any) => o.account_move && o.account_move.length > 0)
    .map((o: any) => o.account_move[0]);

  let invoiceMap: Record<number, any> = {};
  if (moveIds.length > 0) {
    try {
      const moves = await executeKw(
        "account.move",
        "read",
        [moveIds],
        {
          fields: ["name", "partner_id", "amount_total", "amount_residual", "currency_id", "amount_total_signed", "move_type"],
        }
      );
      for (const m of moves || []) {
        invoiceMap[m.id] = m;
      }
    } catch {
      // Fallback: try with minimal fields
      try {
        const moves = await executeKw(
          "account.move",
          "read",
          [moveIds],
          {
            fields: ["name", "partner_id", "amount_total", "amount_residual", "move_type"],
          }
        );
        for (const m of moves || []) {
          invoiceMap[m.id] = m;
        }
      } catch {
        // Ignore errors
      }
    }
  }

  // Batch fetch ALL payments and receivables for all unique partnerIds to avoid N+1 queries
  const uniquePartnerIds = Array.from(new Set(
    (orders || [])
      .map((o: any) => {
        const moveId = o.account_move && o.account_move.length > 0 ? o.account_move[0] : null;
        const inv = moveId ? invoiceMap[moveId] : null;
        return inv?.partner_id ? (Array.isArray(inv.partner_id) ? inv.partner_id[0] : inv.partner_id) : (o.partner_id ? o.partner_id[0] : null);
      })
      .filter(Boolean)
  ));

  let allPayments: any[] = [];
  let allPartnerLines: any[] = [];

  if (uniquePartnerIds.length > 0) {
    try {
      allPayments = await executeKw(
        "account.payment",
        "search_read",
        [[
          ["partner_id", "in", uniquePartnerIds],
          ["date", "=", sessionDate],
          ["state", "=", "posted"],
        ]],
        { fields: ["name", "ref", "journal_id", "amount", "currency_id", "payment_type", "reconciled_invoice_ids", "partner_id"] }
      ) || [];
    } catch {
      // Ignore errors fetching payments
    }

    try {
      allPartnerLines = await executeKw(
        "account.move.line",
        "search_read",
        [[
          ["partner_id", "in", uniquePartnerIds],
          ["account_type", "=", "asset_receivable"],
        ]],
        { fields: ["partner_id", "credit", "debit", "currency_id"] }
      ) || [];
    } catch {
      // Ignore errors fetching partner balance
    }
  }

  // Pre-calculate partner balances to avoid recalculating per order
  const partnerBalanceMap: Record<number, number> = {};
  const partnerCreditDebit: Record<number, { credit: number; debit: number }> = {};
  for (const line of allPartnerLines) {
    const pid = line.partner_id && line.partner_id[0];
    if (pid) {
      if (!partnerCreditDebit[pid]) partnerCreditDebit[pid] = { credit: 0, debit: 0 };
      partnerCreditDebit[pid].credit += Math.abs(line.credit || 0);
      partnerCreditDebit[pid].debit += Math.abs(line.debit || 0);
    }
  }
  for (const pid in partnerCreditDebit) {
    partnerBalanceMap[pid] = Math.round((partnerCreditDebit[pid].credit - partnerCreditDebit[pid].debit) * 100) / 100;
  }

  for (const order of orders || []) {
    if (!order.account_move || order.account_move.length === 0) continue;

    const moveId = order.account_move[0];
    const creditAmountPOS = Math.round((orderPayments[order.id] || 0) * 100) / 100;
    const invoice = invoiceMap[moveId];
    if (!invoice) continue;

    // Check if this is a credit note (out_refund) - negate the amount if so
    const isRefund = invoice.move_type === "out_refund";
    const sign = isRefund ? -1 : 1;

    if (!invoice) continue;

    const invoiceParts = (invoice.name || "").split(" ");
    const invoiceNumber = invoiceParts[invoiceParts.length - 1];
    const partner = invoice.partner_id ? invoice.partner_id[1] : (order.partner_id ? order.partner_id[1] : "");
    const invoiceTotal = Math.round((invoice.amount_total || 0) * 100) / 100 * sign;
    
    // Get retention from POS payments (method 26)
    const retentionAmountUsd = Math.round((retentionByOrder[order.id] || 0) * 100) / 100 * sign;
    
    // Get delivery from POS payments
    let deliveryAmountUsd = 0;
    const orderAllPayments = allPaymentsByOrder[order.id] || [];
    for (const p of orderAllPayments) {
      const methodName = paymentMethodsMap[p.payment_method_id[0]] || "";
      if (methodName.toLowerCase().includes("delivery")) {
        deliveryAmountUsd += Math.abs(p.amount);
      }
    }
    deliveryAmountUsd = deliveryAmountUsd * sign;

    const partnerId = invoice.partner_id ? (Array.isArray(invoice.partner_id) ? invoice.partner_id[0] : invoice.partner_id) : null;

    // Get real payment amounts from Odoo accounting (debit lines on receivable account by partner)
    let abonoAmount = 0;
    let abonoAmountBs = 0;
    let abonoJournal = "—";
    const abonoByJournal: Record<string, { usd: number; bs: number }> = {};
    let paymentLines: any[] = [];

    if (partnerId) {
      try {
        // Extract the correlativo from invoice name (e.g., "INV/2026/00030221" -> "00030221")
        const correlativo = invoiceNumber.split("/").pop() || invoiceNumber;

        // Find REAL PAYMENTS from pre-fetched allPayments
        const payments = allPayments.filter((p: any) => p.partner_id && p.partner_id[0] === partnerId);

        const journalsSeen = new Set<string>();
        for (const payment of payments) {
          // Only count incoming payments (not outbound refunds)
          const paymentType = payment.payment_type || "";
          if (paymentType !== "inbound") continue;
          
          const amount = Math.round((payment.amount || 0) * 100) / 100;

          // Check currency - if VES (id 3), amount is already in Bs
          const currencyId = Array.isArray(payment.currency_id) ? payment.currency_id[0] : payment.currency_id;
          if (currencyId === 3) {
            // VES: amount is already in Bs, convert to USD for abonoAmount
            const amountUsd = rate > 0 ? Math.round((amount / rate) * 100) / 100 : 0;
            abonoAmount += amountUsd;
            abonoAmountBs += amount; // Already in Bs
          } else {
            // USD or other: convert to Bs
            const amountBs = Math.round((amount * rate) * 100) / 100;
            abonoAmount += amount;
            abonoAmountBs += amountBs;
          }

          if (payment.journal_id) {
            const journalName = Array.isArray(payment.journal_id) ? payment.journal_id[1] : "Journal";
            
            if (!journalsSeen.has(journalName)) {
              journalsSeen.add(journalName);
              if (abonoJournal === "—") {
                abonoJournal = journalName;
              } else {
                abonoJournal += ", " + journalName;
              }
            }

            // Track by journal
            if (!abonoByJournal[journalName]) {
              abonoByJournal[journalName] = { usd: 0, bs: 0 };
            }
            if (currencyId === 3) {
              abonoByJournal[journalName].bs += amount;
            } else {
              abonoByJournal[journalName].usd += amount;
            }
          }
        }
      } catch {
        // Ignore errors fetching payments
      }
    }

    // Get partner's account balance (saldo a favor = credit - debit on receivable account)
    let partnerBalance = partnerId ? (partnerBalanceMap[partnerId] || 0) : 0;

    // Fallback if no payment records were returned but invoice amount_residual indicates a payment
    if (!isRefund && abonoAmount === 0 && invoice.amount_residual !== undefined && invoice.amount_residual < invoiceTotal) {
      const residualPaid = Math.max(0, Math.round((creditAmountPOS - invoice.amount_residual) * 100) / 100);
      if (residualPaid > 0) {
        abonoAmount = residualPaid;
        abonoAmountBs = Math.round(residualPaid * rate * 100) / 100;
        if (abonoJournal === "—") abonoJournal = "Abono Odoo";
        if (!abonoByJournal[abonoJournal]) {
          abonoByJournal[abonoJournal] = { usd: abonoAmount, bs: abonoAmountBs };
        }
      }
    }

    // Saldo = Deuda original tomada (creditAmountPOS) - Abonos posteriores
    // Positivo = cuenta por cobrar (cliente debe)
    // Negativo = devolución o saldo a favor
    let saldoReal = Math.round((creditAmountPOS - abonoAmount) * 100) / 100;

    // Sobrepago: si el cliente pagó más de lo que debía (Abono > Deuda), la factura queda en 0
    if (!isRefund && abonoAmount > 0 && saldoReal < 0) {
      saldoReal = 0;
    }
    
    // Excedente = delivery (terceros)
    const excedenteUsd = Math.round(deliveryAmountUsd * 100) / 100;
    const excedenteBs = Math.round(excedenteUsd * rate * 100) / 100;

    // Determine payment state based on saldo
    // Si saldo > 0: partial (debe dinero)
    // Si saldo <= 0: paid (pagado o saldo a favor)
    let paymentState = isRefund ? "refunded" : "not_paid";
    if (!isRefund && abonoAmount > 0) {
      paymentState = saldoReal > 0 ? "partial" : "paid";
    }

    // Total pagado = abono + delivery
    const paymentTotalUsd = Math.round((abonoAmount + excedenteUsd) * 100) / 100;
    const paymentTotalBs = Math.round(paymentTotalUsd * rate * 100) / 100;

    // generaSaldoFavor = true si saldo es negativo (hay excedente)
    const generaSaldoFavor = saldoReal < 0;
    const residualBs = Math.round((saldoReal || 0) * rate * 100) / 100;

    results.push({
      invoiceNumber,
      partner,
      invoiceTotal,
      creditAmountPOS,
      retentionAmountPOS: retentionAmountUsd,
      abonoAmount,
      abonoAmountBs,
      abonoJournal,
      abonoByJournal,
      residual: saldoReal,
      residualBs,
      paymentState,
      paymentTotalBs,
      paymentTotalUsd,
      excedenteBs,
      excedenteUsd,
      excedenteConcepto: excedenteUsd > 0 ? "delivery" : "",
      generaSaldoFavor,
    });
  }

  // Cache results for 5 minutes
  cache.set(String(sessionId), results, 5 * 60 * 1000);

  return results;
}

/**
 * Get individual saldo a favor (payment method 25) operations with detail.
 * Filtered to fiscal-journal orders only.
 */
export async function getSaldoFavorDetail(sessionId: number): Promise<SaldoFavorRow[]> {
  const session = await getSessionById(sessionId);
  if (!session) throw new Error("Sesión no encontrada");

  const date = getVenezuelanDateFromUtc(session.start_at || session.stop_at || "") || new Date().toISOString().split("T")[0];
  const rate = await getDayRate(date);

  // Get related sessions (companion fiscal machine merge)
  const { sessionIds } = await getRelatedSessionIds(sessionId);

  // Get all saldo a favor payments for all related sessions
  const allPayments = await executeKw(
    "pos.payment",
    "search_read",
    [[
      ["session_id", "in", sessionIds],
      ["payment_method_id", "=", METHOD_SALDO_FAVOR],
    ]],
    {
      fields: ["amount", "pos_order_id"],
    }
  );

  if (!allPayments || allPayments.length === 0) return [];

  // Filter by fiscal orders
  const fiscalOrderIds = await getFiscalOrderIds(sessionIds);
  const payments = allPayments.filter((p: any) => {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    return fiscalOrderIds.has(orderId);
  });

  if (payments.length === 0) return [];

  // Get order details
  const orderIds = [...new Set(payments.map((p: any) =>
    Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id
  ))];

  const orders = await executeKw(
    "pos.order",
    "read",
    [orderIds],
    { fields: ["name", "partner_id", "account_move"] }
  );

  const orderMap: Record<number, any> = {};
  for (const o of orders || []) {
    orderMap[o.id] = o;
  }

  // Get invoice names
  const moveIds = (orders || [])
    .filter((o: any) => o.account_move && o.account_move.length > 0)
    .map((o: any) => o.account_move[0]);

  const moveMap: Record<number, string> = {};
  if (moveIds.length > 0) {
    const moves = await executeKw(
      "account.move",
      "read",
      [moveIds],
      { fields: ["name"] }
    );
    for (const m of moves || []) {
      moveMap[m.id] = m.name || "";
    }
  }

  const results: SaldoFavorRow[] = [];
  for (const p of payments) {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    const order = orderMap[orderId];
    const moveId = order?.account_move?.[0];
    const invoiceName = moveId ? (moveMap[moveId] || "") : "";
    const amount = Math.round((p.amount || 0) * 100) / 100;

    results.push({
      orderName: order?.name || "",
      partner: order?.partner_id ? order.partner_id[1] : "",
      invoiceNumber: invoiceName,
      amount,
      amountBs: Math.round(amount * rate * 100) / 100,
    });
  }

  return results;
}

/**
 * Get non-fiscal operations (recibos): orders that do NOT have invoices in fiscal journals.
 * These are the inverse of fiscal orders — all amounts in USD (divisas).
 */
export async function getNonFiscalSummary(sessionId: number): Promise<NonFiscalSummary> {
  // Get related sessions (companion fiscal machine merge)
  const { sessionIds } = await getRelatedSessionIds(sessionId);

  // Get all orders for the sessions
  const allOrders = await executeKw("pos.order", "search_read",
    [[["session_id", "in", sessionIds]]],
    { fields: ["id", "account_move", "name", "partner_id", "amount_total"] }
  );

  if (!allOrders || allOrders.length === 0) {
    return { receiptCount: 0, totalUSD: 0, payments: [], creditSales: [], totalCreditUSD: 0 };
  }

  // Get fiscal order IDs
  const fiscalOrderIds = await getFiscalOrderIds(sessionIds);

  // Non-fiscal orders = orders NOT in fiscal set
  const nfOrders = allOrders.filter((o: any) => !fiscalOrderIds.has(o.id));

  if (nfOrders.length === 0) {
    return { receiptCount: 0, totalUSD: 0, payments: [], creditSales: [], totalCreditUSD: 0 };
  }

  const nfOrderIds = new Set(nfOrders.map((o: any) => o.id));

  // Separate Gross Sales from Refunds / Notas de Crédito
  const salesOrders = nfOrders.filter((o: any) => (o.amount_total || 0) >= 0);
  const refundOrders = nfOrders.filter((o: any) => (o.amount_total || 0) < 0);

  const totalGrossUSD = Math.round(salesOrders.reduce((sum: number, o: any) => sum + (o.amount_total || 0), 0) * 100) / 100;
  const totalRefundUSD = Math.round(Math.abs(refundOrders.reduce((sum: number, o: any) => sum + (o.amount_total || 0), 0)) * 100) / 100;
  const totalUSD = Math.round((totalGrossUSD - totalRefundUSD) * 100) / 100;

  const refunds: { orderName: string; partner: string; amountUSD: number }[] = refundOrders.map((o: any) => ({
    orderName: o.name || `#${o.id}`,
    partner: o.partner_id ? o.partner_id[1] : "",
    amountUSD: Math.round(Math.abs(o.amount_total || 0) * 100) / 100,
  }));

  // Get payments for non-fiscal orders
  const allPayments = await executeKw("pos.payment", "search_read",
    [[["session_id", "in", sessionIds]]],
    { fields: ["amount", "payment_method_id", "pos_order_id"] }
  );

  const nfPayments = (allPayments || []).filter((p: any) => {
    const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
    return nfOrderIds.has(orderId);
  });

  // Get payment method details (POS method names)
  const methodIds = [...new Set(nfPayments.map((p: any) => p.payment_method_id[0]))];
  let methodDetails: Record<number, { name: string }> = {};
  if (methodIds.length > 0) {
    const methods = await executeKw("pos.payment.method", "read",
      [methodIds],
      { fields: ["name"] }
    );
    for (const m of methods) {
      methodDetails[m.id] = { name: m.name };
    }
  }

  // Group payments by method
  const groups: Record<number, NonFiscalPaymentGroup> = {};
  for (const p of nfPayments) {
    const methodId = p.payment_method_id[0];
    const methodName = methodDetails[methodId]?.name || p.payment_method_id[1];
    if (!groups[methodId]) {
      groups[methodId] = { methodId, methodName, totalUSD: 0, count: 0 };
    }
    groups[methodId].totalUSD += p.amount;
    groups[methodId].count += 1;
  }

  const payments: NonFiscalPaymentGroup[] = Object.values(groups).map((g) => ({
    ...g,
    totalUSD: Math.round(g.totalUSD * 100) / 100,
  }));

  // Identify credit sales among NF orders (pay_later methods)
  const creditSales: NonFiscalCreditRow[] = [];
  let totalCreditUSD = 0;

  const nfCreditPayments = nfPayments.filter((p: any) =>
    CREDIT_METHOD_IDS.includes(p.payment_method_id[0])
  );

  if (nfCreditPayments.length > 0) {
    // Group credit amounts by order
    const creditByOrder: Record<number, number> = {};
    for (const p of nfCreditPayments) {
      const orderId = Array.isArray(p.pos_order_id) ? p.pos_order_id[0] : p.pos_order_id;
      creditByOrder[orderId] = (creditByOrder[orderId] || 0) + p.amount;
    }

    const orderMap: Record<number, any> = {};
    for (const o of nfOrders) {
      orderMap[o.id] = o;
    }

    for (const [orderIdStr, creditAmount] of Object.entries(creditByOrder)) {
      const order = orderMap[Number(orderIdStr)];
      if (order) {
        const roundedAmount = Math.round(creditAmount * 100) / 100;
        totalCreditUSD += roundedAmount;
        creditSales.push({
          orderName: order.name || `#${order.id}`,
          partner: order.partner_id ? order.partner_id[1] : "",
          amountUSD: roundedAmount,
        });
      }
    }
    totalCreditUSD = Math.round(totalCreditUSD * 100) / 100;
  }

  return {
    receiptCount: nfOrders.length,
    totalUSD,
    totalGrossUSD,
    totalRefundUSD,
    refundCount: refundOrders.length,
    refunds,
    payments,
    creditSales,
    totalCreditUSD,
  };
  
}

// ========== CxC/CxP ==========

interface Cuenta {
  id: string;
  name: string;
  partnerId: number;
  partnerName: string;
  totalPendiente: number;
  totalPendienteBs?: number;
  totalAbonos: number;
  currency: string;
  rate?: number;
}

interface CuentasResult {
  totalPendiente: number;
  totalPendienteBs?: number;
  totalAbonos: number;
  cuentas: Cuenta[];
  rate?: number;
}

interface Movimiento {
  id: string;
  documento: string;
  documentoAfectado: string;
  partnerName: string;
  fecha: string;
  monto: number;
  saldo: number;
  estado: string;
}

interface BancoData {
  total: number;
  ingresos: number;
  egresos: number;
  movimientos: Movimiento[];
}

async function searchPartnersByType(isCustomer: boolean): Promise<any[]> {
  const field = isCustomer ? "customer_rank" : "supplier_rank";
  const creditField = isCustomer ? "credit" : "debit";
  const limitField = isCustomer ? "credit_limit" : "debit_limit";
  const domain = [[field, ">", 0], ["parent_id", "=", false]];
  const fields = ["id", "name", creditField, limitField];
  return executeKw("res.partner", "search_read", [domain], { fields });
}

const FACTURA_JOURNALS = ["FAC01", "FAC02", "FAC4"];

// CxC: facturas de clientes por diarios FAC - con filtros opcionales por diario y banco
export async function getCxCFacturas(
  fechaDesde?: string,
  fechaHasta?: string,
  diario?: string,
  banco?: string
): Promise<any[]> {
  const journalFilter = diario ? [diario] : FACTURA_JOURNALS;
  const domain: any[] = [
    ["move_type", "=", "out_invoice"],
    ["state", "=", "posted"],
    ["journal_id.name", "in", journalFilter]
  ];
  if (fechaDesde) domain.push(["invoice_date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["invoice_date", "<=", fechaHasta]);
  const fields = ["id", "name", "partner_id", "invoice_date", "amount_total", "amount_residual", "journal_id", "invoice_payments_widget"];
  const invoices = await executeKw("account.move", "search_read", [domain], { fields });
  // Enrich each invoice with Bs amount at the rate of its date
  const enriched = await Promise.all((invoices || []).map(async (inv: any) => {
    const date = inv.invoice_date || new Date().toISOString().split("T")[0];
    const rate = await getDayRate(date);
    const montoBs = Math.round((inv.amount_total || 0) * rate * 100) / 100;
    const saldoBs = Math.round((inv.amount_residual || 0) * rate * 100) / 100;
    const estado = (inv.amount_residual || 0) <= 0 ? "pagado" : "pendiente";
    return {
      id: inv.id,
      numero: inv.name,
      cliente: inv.partner_id ? inv.partner_id[1] : "",
      fecha: inv.invoice_date,
      diario: inv.journal_id ? inv.journal_id[1] : "",
      montoUSD: inv.amount_total || 0,
      saldoUSD: inv.amount_residual || 0,
      montoBs,
      saldoBs,
      tasa: rate,
      estado,
      tipo: "cxc"
    };
  }));
  return enriched;
}

// CxP: facturas de proveedores solo diario Delivery
export async function getCxPFacturas(
  fechaDesde?: string,
  fechaHasta?: string,
  banco?: string
): Promise<any[]> {
  const domain: any[] = [
    ["move_type", "=", "in_invoice"],
    ["state", "=", "posted"],
    ["journal_id.name", "ilike", "Delivery"]
  ];
  if (fechaDesde) domain.push(["invoice_date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["invoice_date", "<=", fechaHasta]);
  const fields = ["id", "name", "partner_id", "invoice_date", "amount_total", "amount_residual", "journal_id"];
  const invoices = await executeKw("account.move", "search_read", [domain], { fields });
  const enriched = await Promise.all((invoices || []).map(async (inv: any) => {
    const date = inv.invoice_date || new Date().toISOString().split("T")[0];
    const rate = await getDayRate(date);
    const montoBs = Math.round((inv.amount_total || 0) * rate * 100) / 100;
    const saldoBs = Math.round((inv.amount_residual || 0) * rate * 100) / 100;
    const estado = (inv.amount_residual || 0) <= 0 ? "pagado" : "pendiente";
    return {
      id: inv.id,
      numero: inv.name,
      proveedor: inv.partner_id ? inv.partner_id[1] : "",
      fecha: inv.invoice_date,
      diario: inv.journal_id ? inv.journal_id[1] : "",
      montoUSD: inv.amount_total || 0,
      saldoUSD: inv.amount_residual || 0,
      montoBs,
      saldoBs,
      tasa: rate,
      estado,
      tipo: "cxp"
    };
  }));
  return enriched;
}

async function getCxCLines(fechaDesde?: string, fechaHasta?: string): Promise<any[]> {
  return getCxCFacturas(fechaDesde, fechaHasta);
}

async function getCxPLines(fechaDesde?: string, fechaHasta?: string): Promise<any[]> {
  return getCxPFacturas(fechaDesde, fechaHasta);
}

// Listar métodos de pago POS activos
export async function getMetodosPOS(): Promise<any[]> {
  const methods = await executeKw("pos.payment.method", "search_read",
    [[["active", "=", true]]],
    { fields: ["id", "name"] }
  );
  return (methods || []).map((m: any) => ({ id: m.id, name: m.name }));
}

// Listar diarios bancarios (bancos) disponibles
export async function getBancosDisponibles(): Promise<any[]> {
  const journals = await executeKw("account.journal", "search_read",
    [[["type", "in", ["bank", "cash"]], ["active", "=", true]]],
    { fields: ["id", "name", "type"] }
  );
  return (journals || []).map((j: any) => ({ id: j.id, name: j.name, type: j.type }));
}

// Debug: inspeccionar un pago por nombre y ver por qué puede no aparecer en el listado
export async function debugPago(nombre: string): Promise<any> {
  // 1. Buscar el pago por nombre
  const pagos = await executeKw("account.payment", "search_read",
    [[["name", "=", nombre]]],
    { fields: ["id", "name", "partner_id", "date", "amount", "currency_id", "journal_id", "create_uid", "reconciled_invoice_ids", "payment_type", "partner_type", "state", "move_id"] }
  );
  if (!pagos || pagos.length === 0) return { error: `Pago ${nombre} no encontrado` };
  const pago = pagos[0];

  // 2. Buscar facturas conciliadas
  const invoiceIds: number[] = pago.reconciled_invoice_ids || [];
  let facturas: any[] = [];
  let facturasConPOS: any[] = [];

  if (invoiceIds.length > 0) {
    facturas = await executeKw("account.move", "search_read",
      [[["id", "in", invoiceIds]]],
      { fields: ["id", "name", "move_type", "invoice_date", "amount_total", "amount_residual", "journal_id", "pos_order_ids", "state"] }
    );

    // Para cada factura, ver si tiene órdenes POS con crédito
    for (const inv of facturas) {
      const posOrderIds: number[] = inv.pos_order_ids || [];
      let creditPayments: any[] = [];
      let allPosPayments: any[] = [];

      if (posOrderIds.length > 0) {
        allPosPayments = await executeKw("pos.payment", "search_read",
          [[["pos_order_id", "in", posOrderIds]]],
          { fields: ["id", "amount", "payment_method_id", "pos_order_id"] }
        );
        creditPayments = allPosPayments.filter((p: any) => {
          const mid = Array.isArray(p.payment_method_id) ? p.payment_method_id[0] : p.payment_method_id;
          return [14, 33].includes(mid);
        });
      }

      facturasConPOS.push({
        ...inv,
        posOrderIds,
        allPosPayments,
        creditPayments,
        tieneMetodoCredito: creditPayments.length > 0,
      });
    }
  }

  return {
    pago: {
      ...pago,
      partner_type: pago.partner_type,
      payment_type: pago.payment_type,
      state: pago.state,
    },
    diagnostico: {
      esInbound: pago.payment_type === "inbound",
      esCliente: pago.partner_type === "customer",
      estaPosteado: pago.state === "posted",
      tieneFacturasConciliadas: invoiceIds.length > 0,
      cantidadFacturas: invoiceIds.length,
    },
    facturas: facturasConPOS,
    razonPosibleExclusion: [
      pago.payment_type !== "inbound" ? "❌ payment_type no es 'inbound'" : "✅ payment_type = inbound",
      pago.partner_type !== "customer" ? "❌ partner_type no es 'customer'" : "✅ partner_type = customer",
      pago.state !== "posted" ? "❌ state no es 'posted'" : "✅ state = posted",
      invoiceIds.length === 0 ? "❌ No tiene facturas conciliadas (reconciled_invoice_ids vacío)" : "✅ Tiene facturas conciliadas",
      facturasConPOS.every((f: any) => !f.tieneMetodoCredito) ? "❌ Ninguna factura tiene método 'ventas a crédito' (IDs 14 o 33)" : "✅ Al menos una factura tiene método crédito",
      facturasConPOS.every((f: any) => f.posOrderIds.length === 0) ? "❌ Ninguna factura está vinculada a una orden POS" : "✅ Facturas vinculadas a POS",
    ],
  };
}

/**
 * Debug: Get raw account.payment data for a specific reference and optional date.
 * This helps diagnose why payment method summary might show incorrect amounts.
 */
export async function debugPaymentsByRef(ref: string, date?: string): Promise<any> {
  const filters: any[] = [
    ["ref", "=", ref],
    ["state", "=", "posted"],
  ];
  if (date) {
    filters.push(["date", "=", date]);
  }
  
  const payments = await executeKw(
    "account.payment",
    "search_read",
    [filters],
    { fields: ["id", "name", "ref", "partner_id", "date", "amount", "currency_id", "journal_id", "payment_type", "state", "amount_company_currency_signed", "move_id"] }
  );

  // For each payment, also get the move lines to see the actual journal entry amounts
  const results = [];
  for (const payment of payments || []) {
    let moveLines: any[] = [];
    if (payment.move_id) {
      const moveId = Array.isArray(payment.move_id) ? payment.move_id[0] : payment.move_id;
      moveLines = await executeKw(
        "account.move.line",
        "search_read",
        [[["move_id", "=", moveId]]],
        { fields: ["id", "name", "account_id", "debit", "credit", "amount_currency", "currency_id", "journal_id"] }
      ) || [];
    }
    results.push({
      payment: {
        id: payment.id,
        name: payment.name,
        ref: payment.ref,
        partner: payment.partner_id,
        date: payment.date,
        amount: payment.amount,
        currency_id: payment.currency_id,
        journal_id: payment.journal_id,
        payment_type: payment.payment_type,
        state: payment.state,
        amount_company_currency_signed: payment.amount_company_currency_signed,
      },
      moveLines: moveLines.map((l: any) => ({
        id: l.id,
        name: l.name,
        account: l.account_id,
        debit: l.debit,
        credit: l.credit,
        amount_currency: l.amount_currency,
        currency_id: l.currency_id,
        journal_id: l.journal_id,
      })),
    });
  }

  return { ref, date, count: results.length, payments: results };
}

// Pagos contables a facturas POS con método "ventas a crédito"
// Retorna: datos de factura + datos del pago + saldo restante + Bs
export async function getPagosCreditoPOS(
  fechaDesde?: string,
  fechaHasta?: string,
  usuarioFiltro?: string,
  metodoPagoFiltro?: string,
  metodoPOSFiltro?: string
): Promise<any[]> {
  // 1. Buscar pagos contables de clientes en el rango de fechas
  const domain: any[] = [
    ["partner_type", "=", "customer"],
    ["state", "=", "posted"],
  ];
  if (fechaDesde) domain.push(["date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["date", "<=", fechaHasta]);
  if (metodoPagoFiltro) domain.push(["journal_id.name", "ilike", metodoPagoFiltro]);

  const fields = [
    "id", "name", "partner_id", "date", "amount", "currency_id",
    "journal_id", "create_uid", "reconciled_invoice_ids", "payment_type"
  ];
  const pagos = await executeKw("account.payment", "search_read", [domain], { fields });

  const resultado: any[] = [];

  for (const pago of pagos || []) {
    // Filtrar por usuario
    const userName: string = pago.create_uid ? pago.create_uid[1] : "";
    if (usuarioFiltro && !userName.toLowerCase().includes(usuarioFiltro.toLowerCase())) continue;

    // Solo pagos inbound (cobro a clientes)
    if (pago.payment_type !== "inbound") continue;

    // Buscar facturas conciliadas con este pago
    const invoiceIds: number[] = pago.reconciled_invoice_ids || [];
    if (!invoiceIds.length) continue;

    // Obtener facturas conciliadas
    const invoices = await executeKw(
      "account.move",
      "search_read",
      [[["id", "in", invoiceIds], ["move_type", "in", ["out_invoice", "out_receipt"]]]],
      { fields: ["id", "name", "invoice_date", "amount_total", "amount_residual", "journal_id", "pos_order_ids"] }
    );

    for (const inv of invoices || []) {
      // Solo facturas que vienen de POS (tienen pos_order_ids)
      const posOrderIds: number[] = inv.pos_order_ids || [];
      if (!posOrderIds.length) continue;

      // Verificar que la orden POS tenía algún método de pago pendiente/crédito
      // Incluye: Venta a crédito (14, 33), Saldo a favor (25) y cualquier otro pay_later
      const posMethods = await executeKw(
        "pos.payment",
        "search_read",
        [[["pos_order_id", "in", posOrderIds]]],
        { fields: ["id", "amount", "payment_method_id"] }
      );
      if (!posMethods || posMethods.length === 0) continue;

      // Filtrar por método POS si se especifica
      if (metodoPOSFiltro) {
        const tieneMetodo = posMethods.some((m: any) =>
          m.payment_method_id && m.payment_method_id[1]?.toLowerCase().includes(metodoPOSFiltro.toLowerCase())
        );
        if (!tieneMetodo) continue;
      }

      // Calcular tasas
      const fechaFactura = inv.invoice_date || fechaDesde || new Date().toISOString().split("T")[0];
      const fechaPago = pago.date;
      const rateFactura = await getDayRate(fechaFactura);
      const ratePago = await getDayRate(fechaPago);

      const montoFacturaUSD = inv.amount_total || 0;
      const saldoFacturaUSD = inv.amount_residual || 0;
      const montoPagoUSD = pago.amount || 0;

      resultado.push({
        // Factura
        facturaId: inv.id,
        facturaNro: inv.name,
        facturaFecha: inv.invoice_date,
        facturaJournal: inv.journal_id ? inv.journal_id[1] : "",
        montoFacturaUSD,
        montoFacturaBs: Math.round(montoFacturaUSD * rateFactura * 100) / 100,
        tasaFactura: rateFactura,
        saldoFacturaUSD,
        saldoFacturaBs: Math.round(saldoFacturaUSD * rateFactura * 100) / 100,
        // Pago
        pagoId: pago.id,
        pagoNro: pago.name,
        pagoFecha: fechaPago,
        pagoJournal: pago.journal_id ? pago.journal_id[1] : "",
        montoPagoUSD,
        montoPagoBs: Math.round(montoPagoUSD * ratePago * 100) / 100,
        tasaPago: ratePago,
        // Cliente y usuario
        cliente: pago.partner_id ? pago.partner_id[1] : "",
        usuario: userName,
        // Método POS original
        metodoPOS: [...new Set(posMethods.map((m: any) => m.payment_method_id ? m.payment_method_id[1] : "").filter(Boolean))].join(", "),
        // Comparación fechas: mismo día = ok, diferente = destiempo
        mismodia: inv.invoice_date === fechaPago,
        diasDiferencia: Math.round((new Date(fechaPago).getTime() - new Date(inv.invoice_date).getTime()) / (1000 * 60 * 60 * 24)),
      });
    }
  }

  return resultado;
}

// =============================================================================
// CONCILIACIÓN DE PAGOS DIFERIDOS
// Pagos contables registrados a facturas POS donde el pago NO coincide con el
// día del cuadre. Especialmente relevante para "Saldo a Favor" (ID 25).
// =============================================================================
export async function getConciliacionPagosDiferidos(
  fechaDesde?: string,
  fechaHasta?: string,
  usuarioFiltro?: string,
  bancoFiltro?: string,
  metodoPOSFiltro?: string,
  soloDestiempo?: boolean
): Promise<any[]> {
  // 1. Pagos contables de clientes en el rango
  const domain: any[] = [
    ["partner_type", "=", "customer"],
    ["state", "=", "posted"],
    ["payment_type", "=", "inbound"],
  ];
  if (fechaDesde) domain.push(["date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["date", "<=", fechaHasta]);
  if (bancoFiltro) domain.push(["journal_id.name", "ilike", bancoFiltro]);

  const pagoFields = [
    "id", "name", "partner_id", "date", "amount", "currency_id",
    "journal_id", "create_uid", "reconciled_invoice_ids",
  ];
  const pagos = await executeKw("account.payment", "search_read", [domain], { fields: pagoFields });

  const resultado: any[] = [];

  for (const pago of pagos || []) {
    const userName: string = pago.create_uid ? pago.create_uid[1] : "";
    if (usuarioFiltro && !userName.toLowerCase().includes(usuarioFiltro.toLowerCase())) continue;

    const invoiceIds: number[] = pago.reconciled_invoice_ids || [];
    if (!invoiceIds.length) continue;

    // 2. Facturas conciliadas que vengan de POS
    const facturas = await executeKw(
      "account.move", "search_read",
      [[["id", "in", invoiceIds], ["move_type", "in", ["out_invoice", "out_receipt"]]]],
      { fields: ["id", "name", "invoice_date", "amount_total", "amount_residual", "journal_id", "pos_order_ids"] }
    );

    for (const inv of facturas || []) {
      const posOrderIds: number[] = inv.pos_order_ids || [];
      if (!posOrderIds.length) continue;

      // 3. Pagos POS de esas órdenes
      const posPagos = await executeKw(
        "pos.payment", "search_read",
        [[["pos_order_id", "in", posOrderIds]]],
        { fields: ["id", "amount", "payment_method_id", "pos_order_id"] }
      );
      if (!posPagos || posPagos.length === 0) continue;

      // Nombre y sesión de la orden POS
      const orders = await executeKw(
        "pos.order", "read", [posOrderIds],
        { fields: ["name", "session_id"] }
      );
      const orderInfo = orders?.[0];
      const sesionNombre = orderInfo?.session_id ? orderInfo.session_id[1] : "";
      const sesionId    = orderInfo?.session_id ? orderInfo.session_id[0] : null;

      // Métodos POS únicos
      const metodosPOS = [...new Set(
        posPagos.map((p: any) => p.payment_method_id ? p.payment_method_id[1] : "").filter(Boolean)
      )].join(", ");

      // Detectar si tiene "Saldo a Favor"
      const tieneSaldoFavor = posPagos.some((p: any) => {
        const mid = Array.isArray(p.payment_method_id) ? p.payment_method_id[0] : p.payment_method_id;
        return mid === METHOD_SALDO_FAVOR;
      });

      // Filtro por método POS
      if (metodoPOSFiltro && !metodosPOS.toLowerCase().includes(metodoPOSFiltro.toLowerCase())) continue;

      const fechaFactura = inv.invoice_date || "";
      const fechaPago    = pago.date || "";
      const diasDif      = fechaFactura && fechaPago
        ? Math.round((new Date(fechaPago).getTime() - new Date(fechaFactura).getTime()) / (1000 * 60 * 60 * 24))
        : 0;
      const mismodia = diasDif === 0;

      if (soloDestiempo && mismodia) continue;

      // Tasas por fecha
      const rateFactura = await getDayRate(fechaFactura || fechaDesde || new Date().toISOString().split("T")[0]);
      const ratePago    = await getDayRate(fechaPago || fechaDesde || new Date().toISOString().split("T")[0]);

      // Clasificación del tipo de diferimiento
      let tipoDiferimiento: string;
      if (mismodia && tieneSaldoFavor)       tipoDiferimiento = "saldo_favor_ok";
      else if (!mismodia && tieneSaldoFavor) tipoDiferimiento = "saldo_favor_diferido";
      else if (mismodia)                     tipoDiferimiento = "mismo_dia";
      else                                   tipoDiferimiento = "diferido";

      resultado.push({
        // Factura POS
        facturaId:      inv.id,
        facturaNro:     inv.name,
        facturaFecha:   fechaFactura,
        facturaJournal: inv.journal_id ? inv.journal_id[1] : "",
        montoFacturaUSD: inv.amount_total    || 0,
        montoFacturaBs:  Math.round((inv.amount_total    || 0) * rateFactura * 100) / 100,
        saldoFacturaUSD: inv.amount_residual || 0,
        saldoFacturaBs:  Math.round((inv.amount_residual || 0) * rateFactura * 100) / 100,
        tasaFactura:     rateFactura,
        // Sesión POS / Cuadre
        sesionId,
        sesionNombre,
        // Pago contable
        pagoId:      pago.id,
        pagoNro:     pago.name,
        pagoFecha:   fechaPago,
        pagoJournal: pago.journal_id ? pago.journal_id[1] : "",
        montoPagoUSD: pago.amount || 0,
        montoPagoBs:  Math.round((pago.amount || 0) * ratePago * 100) / 100,
        tasaPago:     ratePago,
        // Clasificación
        cliente:          pago.partner_id ? pago.partner_id[1] : "",
        usuario:          userName,
        metodosPOS,
        tieneSaldoFavor,
        mismodia,
        diasDiferencia:   diasDif,
        tipoDiferimiento,
      });
    }
  }

  // Ordenar: primero saldo_favor_diferido, luego diferido, luego mismo_dia
  resultado.sort((a, b) => {
    const order: Record<string, number> = { saldo_favor_diferido: 0, diferido: 1, saldo_favor_ok: 2, mismo_dia: 3 };
    return (order[a.tipoDiferimiento] ?? 9) - (order[b.tipoDiferimiento] ?? 9);
  });

  return resultado;
}

// Pagos a destiempo: pagos de clientes cuya fecha de pago es diferente a la fecha de la factura
export async function getPagosDestiempo(
  fechaDesde?: string,
  fechaHasta?: string,
  diario?: string,
  usuario?: string
): Promise<any[]> {
  // Buscar pagos de clientes registrados en contabilidad
  const journalFilter = diario && diario !== "todos" ? [diario] : FACTURA_JOURNALS;
  const domain: any[] = [
    ["partner_type", "=", "customer"],
    ["state", "=", "posted"],
  ];
  if (fechaDesde) domain.push(["date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["date", "<=", fechaHasta]);

  const fields = ["id", "name", "partner_id", "date", "amount", "journal_id", "create_uid", "reconciled_invoice_ids"];
  const pagos = await executeKw("account.payment", "search_read", [domain], { fields });

  const result: any[] = [];
  for (const pago of pagos || []) {
    // Filtrar por usuario si se especifica
    const userName = pago.create_uid ? pago.create_uid[1] : "";
    if (usuario && !userName.toLowerCase().includes(usuario.toLowerCase())) continue;

    // Buscar facturas conciliadas con este pago
    const invoiceIds: number[] = pago.reconciled_invoice_ids || [];
    if (!invoiceIds.length) continue;

    // Obtener fecha de las facturas
    const invoices = await executeKw("account.move", "search_read",
      [[["id", "in", invoiceIds]]],
      { fields: ["id", "name", "invoice_date", "journal_id"] }
    );

    for (const inv of invoices || []) {
      // Solo facturas de los diarios FAC
      const journalName = inv.journal_id ? inv.journal_id[1] : "";
      const isFacturaJournal = journalFilter.some((j: string) => journalName.includes(j));
      if (!isFacturaJournal) continue;

      const fechaFactura = inv.invoice_date;
      const fechaPago = pago.date;
      if (!fechaFactura || !fechaPago) continue;

      // Calcular días de retraso
      const diffMs = new Date(fechaPago).getTime() - new Date(fechaFactura).getTime();
      const diasRetraso = Math.round(diffMs / (1000 * 60 * 60 * 24));

      // Solo mostrar si el pago fue DESPUÉS de la fecha de factura (destiempo)
      if (diasRetraso <= 0) continue;

      const rate = await getDayRate(fechaPago);
      const montoBs = Math.round((pago.amount || 0) * rate * 100) / 100;

      result.push({
        id: pago.id,
        numero: inv.name,
        partner: pago.partner_id ? pago.partner_id[1] : "",
        fechaFactura,
        fechaPago,
        diasRetraso,
        montoUSD: pago.amount || 0,
        montoBs,
        tasa: rate,
        diario: pago.journal_id ? pago.journal_id[1] : "",
        usuario: userName,
      });
    }
  }

  return result;
}

async function getBankMovements(fechaDesde?: string, fechaHasta?: string): Promise<any[]> {
  const domain: any[] = [["journal_id.type", "=", "bank"]];
  if (fechaDesde) domain.push(["date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["date", "<=", fechaHasta]);
  const fields = ["id", "name", "date", "debit", "credit", "journal_id", "partner_id", "reconciled"];
  return executeKw("account.move.line", "search_read", [domain], { fields });
}

async function getAllInvoices(fechaDesde?: string, fechaHasta?: string): Promise<any[]> {
  const domain: any[] = [["move_type", "in", ["out_invoice", "out_receipt"]], ["state", "=", "posted"], ["amount_residual", ">", 0]];
  if (fechaDesde) domain.push(["invoice_date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["invoice_date", "<=", fechaHasta]);
  const fields = ["id", "name", "partner_id", "invoice_date", "amount_total", "amount_residual", "move_type", "journal_id"];
  return executeKw("account.move", "search_read", [domain], { fields });
}

async function getSupplierInvoices(fechaDesde?: string, fechaHasta?: string): Promise<any[]> {
  const domain: any[] = [["move_type", "=", "in_invoice"], ["state", "=", "posted"], ["amount_residual", ">", 0]];
  if (fechaDesde) domain.push(["invoice_date", ">=", fechaDesde]);
  if (fechaHasta) domain.push(["invoice_date", "<=", fechaHasta]);
  const fields = ["id", "name", "partner_id", "invoice_date", "amount_total", "amount_residual", "journal_id"];
  return executeKw("account.move", "search_read", [domain], { fields });
}

export async function getCuentasPorCobrar(fechaDesde?: string, fechaHasta?: string): Promise<CuentasResult> {
  const cacheKey = fechaDesde ? `cxc-${fechaDesde}-${fechaHasta}` : "cxc";
  const cache = getSessionCache();
  const cached = cache.get<CuentasResult>(cacheKey);
  if (cached) return cached;
  try {
    const date = fechaDesde || new Date().toISOString().split("T")[0];
    const rate = await getDayRate(date);
    const lines = await getCxCLines(fechaDesde, fechaHasta);
    console.log("[CxC] Lines:", lines.length);
    if (lines.length > 0) console.log("[CxC] Sample:", JSON.stringify(lines[0]));
    
    let totalPendiente = 0;
    let totalPendienteBs = 0;
    const partnerTotals: Record<string, {name: string, pendiente: number}> = {};
    
    for (const line of lines) {
      const partnerName = line.partner_id ? line.partner_id[1] : "Sin cliente";
      if (!partnerTotals[partnerName]) partnerTotals[partnerName] = { name: partnerName, pendiente: 0 };
      partnerTotals[partnerName].pendiente += line.amount_residual || 0;
    }
    
    const cuentas: Cuenta[] = [];
    for (const [name, data] of Object.entries(partnerTotals)) {
      totalPendiente += data.pendiente;
      totalPendienteBs += data.pendiente * rate;
      cuentas.push({
        id: name,
        name: data.name,
        partnerId: 0,
        partnerName: data.name,
        totalPendiente: data.pendiente,
        totalPendienteBs: Math.round(data.pendiente * rate * 100) / 100,
        totalAbonos: 0,
        currency: "USD",
        rate
      });
    }
    
    const result: CuentasResult = { totalPendiente, totalPendienteBs, totalAbonos: 0, cuentas, rate };
    cache.set(cacheKey, result);
    console.log("[CxC] Total:", totalPendiente, "Total Bs:", totalPendienteBs, "Cuentas:", cuentas.length);
    return result;
  } catch (err) {
    console.error("Error getting CxC:", err);
    return { totalPendiente: 0, totalAbonos: 0, cuentas: [] };
  }
}

export async function getCuentasPorPagar(fechaDesde?: string, fechaHasta?: string): Promise<CuentasResult> {
  const cacheKey = fechaDesde ? `cxp-${fechaDesde}-${fechaHasta}` : "cxp";
  const cache = getSessionCache();
  const cached = cache.get<CuentasResult>(cacheKey);
  if (cached) return cached;
  try {
    const date = fechaDesde || new Date().toISOString().split("T")[0];
    const rate = await getDayRate(date);
    const lines = await getCxPLines(fechaDesde, fechaHasta);
    console.log("[CxP] Lines:", lines.length);
    
    let totalPendiente = 0;
    let totalPendienteBs = 0;
    const partnerTotals: Record<string, {name: string, pendiente: number}> = {};
    
    for (const line of lines) {
      const partnerName = line.partner_id ? line.partner_id[1] : "Sin proveedor";
      if (!partnerTotals[partnerName]) partnerTotals[partnerName] = { name: partnerName, pendiente: 0 };
      partnerTotals[partnerName].pendiente += line.amount_residual || 0;
    }
    
    const cuentas: Cuenta[] = [];
    for (const [name, data] of Object.entries(partnerTotals)) {
      totalPendiente += data.pendiente;
      totalPendienteBs += data.pendiente * rate;
      cuentas.push({
        id: name,
        name: data.name,
        partnerId: 0,
        partnerName: data.name,
        totalPendiente: data.pendiente,
        totalPendienteBs: Math.round(data.pendiente * rate * 100) / 100,
        totalAbonos: 0,
        currency: "USD",
        rate
      });
    }
    
    const result: CuentasResult = { totalPendiente, totalPendienteBs, totalAbonos: 0, cuentas, rate };
    cache.set(cacheKey, result);
    console.log("[CxP] Total:", totalPendiente, "Total Bs:", totalPendienteBs, "Cuentas:", cuentas.length);
    return result;
  } catch (err) {
    console.error("Error getting CxP:", err);
    return { totalPendiente: 0, totalPendienteBs: 0, totalAbonos: 0, cuentas: [] };
  }
}

export async function getMovimientosCuentas(tipo: string, fechaDesde?: string, fechaHasta?: string): Promise<Movimiento[]> {
  try {
    if (tipo === "cxc") {
      const invoices = await getAllInvoices(fechaDesde, fechaHasta);
      const filtered = invoices.filter((m: any) => {
        if (fechaDesde && m.invoice_date < fechaDesde) return false;
        if (fechaHasta && m.invoice_date > fechaHasta) return false;
        return true;
      });
      return filtered.map((m: any) => ({
        id: String(m.id),
        documento: m.name || "",
        documentoAfectado: "",
        partnerName: m.partner_id ? m.partner_id[1] : "",
        fecha: m.invoice_date || "",
        monto: m.amount_total || 0,
        saldo: m.amount_residual || 0,
        estado: m.amount_residual > 0 ? "pendiente" : "pagado"
      }));
    } else {
      const bills = await getSupplierInvoices(fechaDesde, fechaHasta);
      const filtered = bills.filter((m: any) => {
        if (fechaDesde && m.invoice_date < fechaDesde) return false;
        if (fechaHasta && m.invoice_date > fechaHasta) return false;
        return true;
      });
      return filtered.map((m: any) => ({
        id: String(m.id),
        documento: m.name || "",
        documentoAfectado: "",
        partnerName: m.partner_id ? m.partner_id[1] : "",
        fecha: m.invoice_date || "",
        monto: m.amount_total || 0,
        saldo: m.amount_residual || 0,
        estado: m.amount_residual > 0 ? "pendiente" : "pagado"
      }));
    }
  } catch (err) {
    console.error("Error getting movimientos:", err);
    return [];
  }
}

export async function getBanco(): Promise<BancoData> {
  const cache = getSessionCache();
  const cached = cache.get<BancoData>("banco");
  if (cached) return cached;
  try {
    const lines = await getBankMovements();
    console.log("[Banco] Movs:", lines.length);
    
    let total = 0;
    let ingresos = 0;
    let egresos = 0;
    const movimientos: Movimiento[] = [];
    
    for (const line of lines) {
      const debit = line.debit || 0;
      const credit = line.credit || 0;
      if (debit > 0) {
        ingresos += debit;
        total += debit;
      } else if (credit > 0) {
        egresos += credit;
        total -= credit;
      }
      movimientos.push({
        id: String(line.id),
        documento: line.name || "",
        documentoAfectado: line.journal_id ? line.journal_id[1] : "",
        partnerName: line.partner_id ? line.partner_id[1] : "",
        fecha: line.date || "",
        monto: debit > 0 ? debit : -credit,
        saldo: total,
        estado: line.reconciled ? "conciliado" : "pendiente"
      });
    }
    
    const result: BancoData = { total, ingresos, egresos, movimientos: movimientos.slice(0, 100) };
    cache.set("banco", result);
    console.log("[Banco] Total:", total, "Ingresos:", ingresos, "Egresos:", egresos);
    return result;
  } catch (err) {
    console.error("Error getting banco:", err);
    return { total: 0, ingresos: 0, egresos: 0, movimientos: [] };
  }
}

export async function getConciliacionBancaria(): Promise<any> {
  const banco = await getBanco();
  return {
    movimientos: banco.movimientos,
    totalRegistrado: banco.total,
    totalConciliado: banco.movimientos.filter(m => m.estado === "conciliado").length,
    totalPendiente: banco.movimientos.filter(m => m.estado === "pendiente").length
  };
}
