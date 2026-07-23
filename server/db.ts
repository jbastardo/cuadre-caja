import pg, { Pool, PoolClient } from "pg";
import bcrypt from "bcryptjs";
import type {
  User,
  UserPublic,
  Cuadre,
  CuadreDetail,
  MetodoVerificado,
  Deduccion,
  AjusteManual,
  CreateCuadre,
  CreditSaleRow,
  RetentionRow,
  SaldoFavorRow,
  FiscalSummary,
  FiscalPayment,
} from "../shared/schema.js";
import { CUADRE_TOLERANCE_BS } from "../shared/schema.js";

// CRITICAL: pg returns NUMERIC as string by default, which breaks arithmetic
// (e.g., sum + "100.00" = "0100.00" string concat → NaN). Force float parsing.
pg.types.setTypeParser(1700, (val: string) => val === null ? null : parseFloat(val));
// Also parse INT8 (bigint) as number to avoid BigInt issues
pg.types.setTypeParser(20, (val: string) => val === null ? null : parseInt(val, 10));

// Safe number coercion: handles strings, undefined, NaN
function toNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return isNaN(n) ? 0 : n;
}

const SALT_ROUNDS = 10;

// ─── Connection Pool ─────────────────────────────────────────────────────────

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on("error", (err) => console.error("Unexpected DB pool error:", err));

export async function getPool() {
  return pool;
}

export async function testConnection(): Promise<boolean> {
  try {
    const client = await pool.connect();
    await client.query("SELECT 1");
    client.release();
    console.log("PostgreSQL connection OK");
    return true;
  } catch (err: any) {
    console.error("PostgreSQL connection FAILED:", err.message);
    return false;
  }
}

export async function closePool() {
  await pool.end();
}

// TEMPORAL: Hash existing plaintext passwords (remove after use)
export async function hashExistingPasswords(): Promise<number> {
  const users = await pool.query("SELECT id, password FROM usuarios");
  let updated = 0;
  
  for (const row of users.rows) {
    // Check if already hashed (bcrypt hashes start with $2b$)
    if (!row.password.startsWith('$2b$')) {
      const hashed = await bcrypt.hash(row.password, SALT_ROUNDS);
      await pool.query("UPDATE usuarios SET password = $1 WHERE id = $2", [hashed, row.id]);
      updated++;
    }
  }
  
  return updated;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function rowToUser(row: any): User {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    password: row.password,
    rol: row.rol,
    activo: row.activo,
  };
}

function rowToCuadre(row: any): Cuadre {
  return {
    id: row.id,
    fecha: row.fecha ? (typeof row.fecha === "string" ? row.fecha : row.fecha.toISOString().split("T")[0]) : "",
    caja: row.caja || "",
    maquinaFiscal: row.maquina_fiscal || "",
    sessionId: row.session_id || 0,
    sessionName: row.session_name || "",
    cajero: row.cajero || "",
    zNumero: row.z_numero || "",
    ventaBrutaZ: Number(row.venta_bruta_z) || 0,
    notasCreditoZ: Number(row.notas_credito_z) || 0,
    ventaNetaZ: Number(row.venta_neta_z) || 0,
    baseImponibleZ: Number(row.base_imponible_z) || 0,
    exentoZ: Number(row.exento_z) || 0,
    ivaZ: Number(row.iva_z) || 0,
    igtfZ: Number(row.igtf_z) || 0,
    primeraFacturaZ: row.primera_factura_z || "",
    ultimaFacturaZ: row.ultima_factura_z || "",
    primeraNCZ: row.primera_ncz || "",
    ultimaNCZ: row.ultima_ncz || "",
    tasaDia: Number(row.tasa_dia) || 0,
    totalOdooUSD: Number(row.total_odoo_usd) || 0,
    totalOdooBs: Number(row.total_odoo_bs) || 0,
    difCambiaria: Number(row.dif_cambiaria) || 0,
    totalMetodosReal: Number(row.total_metodos_real) || 0,
    totalDeducciones: Number(row.total_deducciones) || 0,
    totalJustificado: Number(row.total_justificado) || 0,
    diferencia: Number(row.diferencia) || 0,
    estado: (row.estado as "cuadrado" | "descuadrado" | "pendiente") || "pendiente",
    observaciones: row.observaciones || "",
    cerradoPor: row.cerrado_por || "",
    creadoEn: row.creado_en ? (typeof row.creado_en === "string" ? row.creado_en : row.creado_en.toISOString()) : "",
    cerradoEn: row.cerrado_en ? (typeof row.cerrado_en === "string" ? row.cerrado_en : row.cerrado_en.toISOString()) : "",
    totalRetencionesPOS: Number(row.total_retenciones_pos) || 0,
    totalRetencionesReal: Number(row.total_retenciones_real) || 0,
    totalCreditoPOS: Number(row.total_credito_pos) || 0,
    totalAbonosReal: Number(row.total_abonos_real) || 0,
    totalCxCPendiente: Number(row.total_cxc_pendiente) || 0,
    totalSaldoFavorPOS: Number(row.total_saldo_favor_pos) || 0,
    totalSaldoFavorReal: Number(row.total_saldo_favor_real) || 0,
    totalAjustesManuales: Number(row.total_ajustes_manuales) || 0,
    retencionesPorCobrar: Number(row.retenciones_por_cobrar) || 0,
    saldoFavorObs: row.saldo_favor_obs || "",
    totalMetodosPOS: Number(row.total_metodos_pos) || 0,
    totalJustificadoReal: Number(row.total_justificado_real) || 0,
    totalDirectoPOS: Number(row.total_directo_pos) || 0,
    observacionesNF: row.observaciones_nf || "",
    tipo: (row.tipo as "fiscal" | "nf") || "fiscal",
  };
}

// ─── Usuarios ────────────────────────────────────────────────────────────────

export async function getUsers(): Promise<UserPublic[]> {
  const { rows } = await pool.query("SELECT id, nombre, email, rol, activo FROM usuarios ORDER BY nombre");
  return rows;
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const { rows } = await pool.query("SELECT * FROM usuarios WHERE email = $1", [email]);
  return rows.length > 0 ? rowToUser(rows[0]) : null;
}

export async function createUser(data: Omit<User, "id">): Promise<UserPublic> {
  const id = `USR-${Date.now()}`;
  const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
  await pool.query(
    "INSERT INTO usuarios (id, nombre, email, password, rol, activo) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, data.nombre, data.email, hashedPassword, data.rol, data.activo]
  );
  const { password, ...pub } = { id, ...data };
  return pub;
}

export async function updateUser(id: string, data: Partial<User>): Promise<UserPublic | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (data.nombre !== undefined) { fields.push(`nombre=$${idx++}`); values.push(data.nombre); }
  if (data.email !== undefined) { fields.push(`email=$${idx++}`); values.push(data.email); }
  if (data.password !== undefined) {
    const hashedPassword = await bcrypt.hash(data.password, SALT_ROUNDS);
    fields.push(`password=$${idx++}`); values.push(hashedPassword);
  }
  if (data.rol !== undefined) { fields.push(`rol=$${idx++}`); values.push(data.rol); }
  if (data.activo !== undefined) { fields.push(`activo=$${idx++}`); values.push(data.activo); }

  if (fields.length === 0) return null;
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE usuarios SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, nombre, email, rol, activo`,
    values
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── Cuadres ─────────────────────────────────────────────────────────────────
export async function getCuadres(
  filters?: { fecha?: string; caja?: string; estado?: string; cerrado?: string },
  page: number = 1,
  limit: number = 50
): Promise<{ data: Cuadre[]; total: number; page: number; totalPages: number }> {
  const offset = (page - 1) * limit;
  const params: any[] = [];
  let pIdx = 1;

  let whereClause = "WHERE 1=1";
  if (filters?.fecha) { whereClause += ` AND fecha = $${pIdx++}`; params.push(filters.fecha); }
  if (filters?.caja) { whereClause += ` AND caja = $${pIdx++}`; params.push(filters.caja); }
  if (filters?.estado) { whereClause += ` AND estado = $${pIdx++}`; params.push(filters.estado); }
  if (filters?.cerrado) {
    if (filters.cerrado === "true") whereClause += ` AND cerrado_por != ''`;
    else if (filters.cerrado === "false") whereClause += ` AND cerrado_por = ''`;
  }

  // Get total count
  const countResult = await pool.query(`SELECT COUNT(*) FROM cuadres ${whereClause}`, params);
  const total = parseInt(countResult.rows[0].count);

  // Get paginated data
  const dataParams = [...params, limit, offset];
  const { rows } = await pool.query(
    `SELECT * FROM cuadres ${whereClause} ORDER BY fecha DESC, caja LIMIT $${pIdx++} OFFSET $${pIdx++}`,
    dataParams
  );

  return {
    data: rows.map(rowToCuadre),
    total,
    page,
    totalPages: Math.ceil(total / limit)
  };
}

export async function getCuadreById(id: string): Promise<CuadreDetail | null> {
  const { rows } = await pool.query("SELECT * FROM cuadres WHERE id = $1", [id]);
  if (rows.length === 0) return null;

  const cuadre = rowToCuadre(rows[0]);
  const [metodos, deducciones, ajustesManuales, creditSales, retenciones, saldosFavor, fiscalSummary] = await Promise.all([
    getMetodosByCuadre(id),
    getDeduccionesByCuadre(id),
    getAjustesByCuadre(id),
    getCreditSalesSnapshot(id),
    getRetencionesSnapshot(id),
    getSaldosFavorSnapshot(id),
    getFiscalSummarySnapshot(id),
  ]);

  return {
    ...cuadre,
    metodos,
    deducciones,
    ajustesManuales,
    creditSales,
    retenciones,
    saldosFavor,
    fiscalSummary: fiscalSummary || undefined,
  };
}

export async function getCuadreBySessionId(sessionId: number, tipo?: string): Promise<Cuadre | null> {
  let sql = "SELECT * FROM cuadres WHERE session_id = $1";
  const params: any[] = [sessionId];

  if (tipo) {
    sql += " AND tipo = $2";
    params.push(tipo);
  }

  sql += " ORDER BY creado_en DESC LIMIT 1";
  const { rows } = await pool.query(sql, params);
  return rows.length > 0 ? rowToCuadre(rows[0]) : null;
}

// Método IDs excluidos de totalMetodosReal porque tienen campo dedicado en el cuadre.
// Debe coincidir exactamente con SECTION3_EXCLUDED_IDS del frontend (CuadreForm.tsx).
// NOTA: ID 42 (PXC Cashea) NO se excluye — el frontend lo incluye en directMetodos.
// NOTA: ID 38 ("Venta a crédito" en Odoo) es en realidad P.Movil BNC (type=bank).
// Es un ingreso directo y DEBE incluirse en totalMetodosReal. No va aquí.
const SPECIAL_METHOD_IDS = new Set([
  26,       // Retención IVA   → campo totalRetencionesReal
  14, 33,   // Venta a crédito pay_later → campo totalCreditoPOS / totalAbonosReal
  25,       // Saldo a favor   → campo totalSaldoFavorReal
]);

function isDeliveryOrDifName(name: string): boolean {
  const n = (name || "").toLowerCase();
  return n.includes("delivery") || n.includes("diferencia");
}

async function computeCuadreTotals(data: CreateCuadre): Promise<{
  totalMetodosReal: number;
  totalDeducciones: number;
  totalAjustesManuales: number;
  deliveryDifTotal: number;
  totalJustificado: number;
  diferencia: number;
  estado: "cuadrado" | "descuadrado" | "pendiente";
}> {
  // Only sum DIRECT methods — special methods (retención, crédito, saldo a favor)
  // are already accounted for via their dedicated fields and must NOT be double-counted.
  // Mirrors exactly: CuadreForm.tsx directMetodos filter.
  const directMetodos = (data.metodos || []).filter(
    (m) => !SPECIAL_METHOD_IDS.has(m.metodoId)
        && !isDeliveryOrDifName(m.metodoNombre || "")
  );
  const totalMetodosReal = directMetodos.reduce((sum, m) => sum + toNum(m.montoReal), 0);

  const totalDeducciones = (data.deducciones || []).reduce((sum, d) => sum + toNum(d.monto), 0);
  const totalAjustesManuales = (data.ajustesManuales || []).reduce((sum, a) => sum + toNum(a.monto), 0);

  const deliveryDifTotal = (data.metodos || [])
    .filter((m) => isDeliveryOrDifName(m.metodoNombre || ""))
    .reduce((s, m) => s + toNum(m.montoPOS_Bs), 0);

  const ventaNetaZ = toNum(data.ventaNetaZ);
  const totalJustificado =
    totalMetodosReal +
    toNum(data.totalRetencionesReal) +
    toNum(data.retencionesPorCobrar) +
    toNum(data.totalAbonosReal) +
    Math.abs(toNum(data.totalCxCPendiente)) +
    toNum(data.totalSaldoFavorReal) +
    deliveryDifTotal +
    totalDeducciones +
    totalAjustesManuales;

  const diferencia = Math.round((totalJustificado - ventaNetaZ) * 100) / 100;
  const estado: "cuadrado" | "descuadrado" | "pendiente" =
    data.estado || (
      ventaNetaZ === 0
        ? "cuadrado"
        : Math.abs(diferencia) < CUADRE_TOLERANCE_BS
          ? "cuadrado"
          : "pendiente"
    );

  return { totalMetodosReal, totalDeducciones, totalAjustesManuales, deliveryDifTotal, totalJustificado, diferencia, estado };
}

export async function createCuadre(data: CreateCuadre): Promise<CuadreDetail> {
  const id = `CQ-${Date.now()}`;
  const now = new Date().toISOString();
  const { totalMetodosReal, totalDeducciones, totalAjustesManuales, deliveryDifTotal, totalJustificado, diferencia, estado } =
    await computeCuadreTotals(data);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO cuadres (
        id, fecha, caja, maquina_fiscal, session_id, session_name, cajero,
        z_numero, venta_bruta_z, notas_credito_z, venta_neta_z,
        base_imponible_z, exento_z, iva_z, igtf_z,
        primera_factura_z, ultima_factura_z, primera_ncz, ultima_ncz,
        tasa_dia, total_odoo_usd, total_odoo_bs, dif_cambiaria,
        total_metodos_real, total_deducciones, total_justificado, diferencia,
        estado, observaciones, observaciones_nf, tipo,
        total_retenciones_pos, total_retenciones_real, retenciones_por_cobrar,
        total_credito_pos, total_abonos_real, total_cxc_pendiente,
        total_saldo_favor_pos, total_saldo_favor_real, total_ajustes_manuales,
        saldo_favor_obs,
        total_metodos_pos, total_justificado_real, total_directo_pos,
        cerrado_por, creado_en, cerrado_en
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38,$39,$40,$41,$42,$43,$44,$45,$46,$47)`,
      [
        id, data.fecha, data.caja, data.maquinaFiscal, data.sessionId, data.sessionName, data.cajero,
        data.zNumero, toNum(data.ventaBrutaZ), toNum(data.notasCreditoZ), toNum(data.ventaNetaZ),
        toNum(data.baseImponibleZ), toNum(data.exentoZ), toNum(data.ivaZ), toNum(data.igtfZ),
        data.primeraFacturaZ, data.ultimaFacturaZ, data.primeraNCZ || "", data.ultimaNCZ || "",
        toNum(data.tasaDia), toNum(data.totalOdooUSD), toNum(data.totalOdooBs), toNum(data.difCambiaria),
        Math.round(totalMetodosReal * 100) / 100,
        Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
        Math.round(totalJustificado * 100) / 100,
        diferencia,
        estado,
        data.observaciones || "",
        data.observacionesNF || "",
        data.tipo || "fiscal",
        toNum(data.totalRetencionesPOS), toNum(data.totalRetencionesReal), toNum(data.retencionesPorCobrar),
        toNum(data.totalCreditoPOS), toNum(data.totalAbonosReal), toNum(data.totalCxCPendiente),
        toNum(data.totalSaldoFavorPOS), toNum(data.totalSaldoFavorReal),
        Math.round(totalAjustesManuales * 100) / 100,
        data.saldoFavorObs || "",
        toNum(data.totalMetodosPOS), toNum(data.totalJustificadoReal), toNum(data.totalDirectoPOS),
        "", now, null,
      ]
    );

    const metodos: MetodoVerificado[] = [];
    let mIdx = 0;
    for (const m of data.metodos) {
      const mid = `MV-${Date.now()}-${mIdx++}-${m.metodoId}`;
      const montoPosBs = toNum((m as any).montoReal_Bs) || toNum(m.montoPOS_Bs);
      const montoUSD = toNum(m.montoPOS_USD);
      const montoReal = toNum(m.montoReal);
      const diff = Math.round((montoReal - montoPosBs) * 100) / 100;
      await client.query(
        "INSERT INTO metodos_verificados (id, cuadre_id, metodo_id, metodo_nombre, monto_pos_usd, monto_pos_bs, monto_real, diferencia, observacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [mid, id, m.metodoId, m.metodoNombre, montoUSD, montoPosBs, montoReal, diff, m.observacion || ""]
      );
      metodos.push({ id: mid, cuadreId: id, metodoId: m.metodoId, metodoNombre: m.metodoNombre, montoPOS_USD: montoUSD, montoPOS_Bs: montoPosBs, montoReal, diferencia: diff, observacion: m.observacion || "" });
    }

    const deducciones: Deduccion[] = [];
    let dIdx = 0;
    for (const d of data.deducciones || []) {
      const did = `DD-${Date.now()}-${dIdx++}-${Math.random().toString(36).slice(2, 6)}`;
      const monto = toNum(d.monto);
      await client.query(
        "INSERT INTO deducciones (id, cuadre_id, tipo, descripcion, monto, comprobante) VALUES ($1,$2,$3,$4,$5,$6)",
        [did, id, d.tipo, d.descripcion, monto, d.comprobante || ""]
      );
      deducciones.push({ id: did, cuadreId: id, tipo: d.tipo, descripcion: d.descripcion, monto, comprobante: d.comprobante || "" });
    }

    const ajustesManuales: AjusteManual[] = [];
    let aIdx = 0;
    for (const a of data.ajustesManuales || []) {
      const aid = `AJ-${Date.now()}-${aIdx++}-${Math.random().toString(36).slice(2, 6)}`;
      const monto = toNum(a.monto);
      await client.query(
        "INSERT INTO ajustes_manuales (id, cuadre_id, tipo, descripcion, monto, referencia) VALUES ($1,$2,$3,$4,$5,$6)",
        [aid, id, a.tipo, a.descripcion, monto, a.referencia || ""]
      );
      ajustesManuales.push({ id: aid, cuadreId: id, tipo: a.tipo, descripcion: a.descripcion, monto, referencia: a.referencia || "" });
    }

    // Save snapshots for historical consistency
    await saveCreditSalesSnapshot(client, id, (data as any).creditSales || []);
    await saveRetencionesSnapshot(client, id, (data as any).retenciones || []);
    await saveSaldosFavorSnapshot(client, id, (data as any).saldosFavor || []);
    await saveFiscalSummarySnapshot(client, id, (data as any).fiscalSummary);

    await client.query("COMMIT");
    return {
      id, fecha: data.fecha, caja: data.caja, maquinaFiscal: data.maquinaFiscal,
      sessionId: data.sessionId, sessionName: data.sessionName, cajero: data.cajero,
      zNumero: data.zNumero, ventaBrutaZ: data.ventaBrutaZ, notasCreditoZ: data.notasCreditoZ,
      ventaNetaZ: data.ventaNetaZ, baseImponibleZ: data.baseImponibleZ, exentoZ: data.exentoZ,
      ivaZ: data.ivaZ, igtfZ: data.igtfZ, primeraFacturaZ: data.primeraFacturaZ,
      ultimaFacturaZ: data.ultimaFacturaZ, primeraNCZ: data.primeraNCZ || "", ultimaNCZ: data.ultimaNCZ || "",
      tasaDia: data.tasaDia, totalOdooUSD: data.totalOdooUSD, totalOdooBs: data.totalOdooBs,
      difCambiaria: data.difCambiaria,
      totalMetodosReal: Math.round(totalMetodosReal * 100) / 100,
      totalDeducciones: Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
      totalJustificado: Math.round(totalJustificado * 100) / 100,
      diferencia, estado,
      observaciones: data.observaciones || "", observacionesNF: data.observacionesNF || "",
      tipo: data.tipo || "fiscal",
      cerradoPor: "", creadoEn: now, cerradoEn: "",
      totalRetencionesPOS: data.totalRetencionesPOS || 0, totalRetencionesReal: data.totalRetencionesReal || 0,
      retencionesPorCobrar: data.retencionesPorCobrar || 0,
      totalCreditoPOS: data.totalCreditoPOS || 0, totalAbonosReal: data.totalAbonosReal || 0,
      totalCxCPendiente: data.totalCxCPendiente || 0,
      totalSaldoFavorPOS: data.totalSaldoFavorPOS || 0, totalSaldoFavorReal: data.totalSaldoFavorReal || 0,
      totalAjustesManuales: Math.round(totalAjustesManuales * 100) / 100,
      saldoFavorObs: data.saldoFavorObs || "",
      totalMetodosPOS: data.totalMetodosPOS || 0, totalJustificadoReal: data.totalJustificadoReal || 0,
      totalDirectoPOS: data.totalDirectoPOS || 0,
      metodos, deducciones, ajustesManuales,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateCuadre(id: string, data: CreateCuadre): Promise<CuadreDetail | null> {
  const { rows: existingRows } = await pool.query("SELECT * FROM cuadres WHERE id = $1", [id]);
  if (existingRows.length === 0) return null;
  const existing = rowToCuadre(existingRows[0]);

  // Compute totals (sums items) but let form's estado take precedence
  const { totalMetodosReal, totalDeducciones, totalAjustesManuales, deliveryDifTotal, totalJustificado, diferencia, estado: computedEstado } =
    await computeCuadreTotals(data);

  let estado: Cuadre["estado"] = computedEstado;
  if (existing.cerradoPor) {
    estado = existing.estado; // preserve on close
  } else if (data.estado) {
    estado = data.estado; // form-calculated estado takes priority
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `UPDATE cuadres SET
        fecha=$1, caja=$2, maquina_fiscal=$3, session_id=$4, session_name=$5, cajero=$6,
        z_numero=$7, venta_bruta_z=$8, notas_credito_z=$9, venta_neta_z=$10,
        base_imponible_z=$11, exento_z=$12, iva_z=$13, igtf_z=$14,
        primera_factura_z=$15, ultima_factura_z=$16, primera_ncz=$17, ultima_ncz=$18,
        tasa_dia=$19, total_odoo_usd=$20, total_odoo_bs=$21, dif_cambiaria=$22,
        total_metodos_real=$23, total_deducciones=$24, total_justificado=$25, diferencia=$26,
        estado=$27, observaciones=$28, observaciones_nf=$29, tipo=$30,
        total_retenciones_pos=$31, total_retenciones_real=$32, retenciones_por_cobrar=$33,
        total_credito_pos=$34, total_abonos_real=$35, total_cxc_pendiente=$36,
        total_saldo_favor_pos=$37, total_saldo_favor_real=$38, total_ajustes_manuales=$39,
        saldo_favor_obs=$40,
        total_metodos_pos=$41, total_justificado_real=$42, total_directo_pos=$43
      WHERE id=$44`,
      [
        data.fecha, data.caja, data.maquinaFiscal, data.sessionId, data.sessionName, data.cajero,
        data.zNumero, toNum(data.ventaBrutaZ), toNum(data.notasCreditoZ), toNum(data.ventaNetaZ),
        toNum(data.baseImponibleZ), toNum(data.exentoZ), toNum(data.ivaZ), toNum(data.igtfZ),
        data.primeraFacturaZ, data.ultimaFacturaZ, data.primeraNCZ || "", data.ultimaNCZ || "",
        toNum(data.tasaDia), toNum(data.totalOdooUSD), toNum(data.totalOdooBs), toNum(data.difCambiaria),
        Math.round(totalMetodosReal * 100) / 100,
        Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
        Math.round(totalJustificado * 100) / 100,
        diferencia, estado,
        data.observaciones || "", data.observacionesNF || "", data.tipo || existing.tipo || "fiscal",
        toNum(data.totalRetencionesPOS), toNum(data.totalRetencionesReal), toNum(data.retencionesPorCobrar),
        toNum(data.totalCreditoPOS), toNum(data.totalAbonosReal), toNum(data.totalCxCPendiente),
        toNum(data.totalSaldoFavorPOS), toNum(data.totalSaldoFavorReal),
        Math.round(totalAjustesManuales * 100) / 100,
        data.saldoFavorObs || "",
        toNum(data.totalMetodosPOS), toNum(data.totalJustificadoReal), toNum(data.totalDirectoPOS),
        id,
      ]
    );

    // Only delete and recreate metodos_verificados if new data is explicitly provided.
    // An empty or missing array means "no change" — preserve existing records.
    const metodos: MetodoVerificado[] = [];
    if (data.metodos && data.metodos.length > 0) {
      await client.query("DELETE FROM metodos_verificados WHERE cuadre_id = $1", [id]);
      let mIdx = 0;
      for (const m of data.metodos) {
        const mid = `MV-${Date.now()}-${mIdx++}-${m.metodoId}`;
        const montoPosBs = toNum((m as any).montoReal_Bs) || toNum(m.montoPOS_Bs);
        const montoUSD = toNum(m.montoPOS_USD);
        const montoReal = toNum(m.montoReal);
        const diff = Math.round((montoReal - montoPosBs) * 100) / 100;
        await client.query(
          "INSERT INTO metodos_verificados (id, cuadre_id, metodo_id, metodo_nombre, monto_pos_usd, monto_pos_bs, monto_real, diferencia, observacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          [mid, id, m.metodoId, m.metodoNombre, montoUSD, montoPosBs, montoReal, diff, m.observacion || ""]
        );
        metodos.push({ id: mid, cuadreId: id, metodoId: m.metodoId, metodoNombre: m.metodoNombre, montoPOS_USD: montoUSD, montoPOS_Bs: montoPosBs, montoReal, diferencia: diff, observacion: m.observacion || "" });
      }
    }

    // Only delete and recreate deducciones if new data is explicitly provided.
    const deducciones: Deduccion[] = [];
    if (data.deducciones && data.deducciones.length > 0) {
      await client.query("DELETE FROM deducciones WHERE cuadre_id = $1", [id]);
      let dIdx = 0;
      for (const d of data.deducciones) {
        const did = `DD-${Date.now()}-${dIdx++}-${Math.random().toString(36).slice(2, 6)}`;
        const monto = toNum(d.monto);
        await client.query(
          "INSERT INTO deducciones (id, cuadre_id, tipo, descripcion, monto, comprobante) VALUES ($1,$2,$3,$4,$5,$6)",
          [did, id, d.tipo, d.descripcion, monto, d.comprobante || ""]
        );
        deducciones.push({ id: did, cuadreId: id, tipo: d.tipo, descripcion: d.descripcion, monto, comprobante: d.comprobante || "" });
      }
    }

    // Only delete and recreate ajustes_manuales if new data is explicitly provided.
    const ajustesManuales: AjusteManual[] = [];
    if (data.ajustesManuales && data.ajustesManuales.length > 0) {
      await client.query("DELETE FROM ajustes_manuales WHERE cuadre_id = $1", [id]);
      let aIdx = 0;
      for (const a of data.ajustesManuales) {
        const aid = `AJ-${Date.now()}-${aIdx++}-${Math.random().toString(36).slice(2, 6)}`;
        const monto = toNum(a.monto);
        await client.query(
          "INSERT INTO ajustes_manuales (id, cuadre_id, tipo, descripcion, monto, referencia) VALUES ($1,$2,$3,$4,$5,$6)",
          [aid, id, a.tipo, a.descripcion, monto, a.referencia || ""]
        );
        ajustesManuales.push({ id: aid, cuadreId: id, tipo: a.tipo, descripcion: a.descripcion, monto, referencia: a.referencia || "" });
      }
    }

    // Save snapshots for historical consistency (only if provided)
    const anyData = data as any;
    if (anyData.creditSales) await saveCreditSalesSnapshot(client, id, anyData.creditSales);
    if (anyData.retenciones) await saveRetencionesSnapshot(client, id, anyData.retenciones);
    if (anyData.saldosFavor) await saveSaldosFavorSnapshot(client, id, anyData.saldosFavor);
    if (anyData.fiscalSummary) await saveFiscalSummarySnapshot(client, id, anyData.fiscalSummary);

    await client.query("COMMIT");
    return { ...existing,
      fecha: data.fecha, caja: data.caja, maquinaFiscal: data.maquinaFiscal,
      sessionId: data.sessionId, sessionName: data.sessionName, cajero: data.cajero,
      zNumero: data.zNumero, ventaBrutaZ: data.ventaBrutaZ, notasCreditoZ: data.notasCreditoZ,
      ventaNetaZ: data.ventaNetaZ, baseImponibleZ: data.baseImponibleZ, exentoZ: data.exentoZ,
      ivaZ: data.ivaZ, igtfZ: data.igtfZ, primeraFacturaZ: data.primeraFacturaZ,
      ultimaFacturaZ: data.ultimaFacturaZ, primeraNCZ: data.primeraNCZ || "", ultimaNCZ: data.ultimaNCZ || "",
      tasaDia: data.tasaDia, totalOdooUSD: data.totalOdooUSD, totalOdooBs: data.totalOdooBs,
      difCambiaria: data.difCambiaria,
      totalMetodosReal: Math.round(totalMetodosReal * 100) / 100,
      totalDeducciones: Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
      totalJustificado: Math.round(totalJustificado * 100) / 100,
      diferencia, estado,
      observaciones: data.observaciones || "", observacionesNF: data.observacionesNF || "",
      tipo: data.tipo || existing.tipo || "fiscal",
      totalRetencionesPOS: data.totalRetencionesPOS || 0, totalRetencionesReal: data.totalRetencionesReal || 0,
      retencionesPorCobrar: data.retencionesPorCobrar || 0,
      totalCreditoPOS: data.totalCreditoPOS || 0, totalAbonosReal: data.totalAbonosReal || 0,
      totalCxCPendiente: data.totalCxCPendiente || 0,
      totalSaldoFavorPOS: data.totalSaldoFavorPOS || 0, totalSaldoFavorReal: data.totalSaldoFavorReal || 0,
      totalAjustesManuales: Math.round(totalAjustesManuales * 100) / 100,
      saldoFavorObs: data.saldoFavorObs || "",
      totalMetodosPOS: data.totalMetodosPOS || 0, totalJustificadoReal: data.totalJustificadoReal || 0,
      totalDirectoPOS: data.totalDirectoPOS || 0,
      metodos, deducciones, ajustesManuales,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closeCuadre(id: string, cerradoPor: string): Promise<Cuadre | null> {
  const { rows } = await pool.query("SELECT * FROM cuadres WHERE id = $1", [id]);
  if (rows.length === 0) return null;
  const cuadre = rowToCuadre(rows[0]);
  const now = new Date().toISOString();
  const estado: Cuadre["estado"] = (cuadre.tipo === "nf" || cuadre.ventaNetaZ === 0)
    ? "cuadrado"
    : Math.abs(cuadre.diferencia) < CUADRE_TOLERANCE_BS ? "cuadrado" : "descuadrado";

  const { rows: updated } = await pool.query(
    "UPDATE cuadres SET estado=$1, cerrado_por=$2, cerrado_en=$3 WHERE id=$4 RETURNING *",
    [estado, cerradoPor, now, id]
  );
  return updated.length > 0 ? rowToCuadre(updated[0]) : null;
}

export async function reopenCuadre(id: string): Promise<Cuadre | null> {
  const { rows } = await pool.query(
    "UPDATE cuadres SET estado='pendiente', cerrado_por='', cerrado_en=NULL WHERE id=$1 RETURNING *",
    [id]
  );
  return rows.length > 0 ? rowToCuadre(rows[0]) : null;
}

export async function deleteCuadre(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM cuadres WHERE id = $1", [id]);
  return rowCount !== null && rowCount > 0;
}

export async function recalculateCuadreFiscalFields(id: string, fiscalSummary: FiscalSummary): Promise<Cuadre | null> {
  const { rows: existingRows } = await pool.query("SELECT * FROM cuadres WHERE id = $1", [id]);
  if (existingRows.length === 0) return null;
  const existing = rowToCuadre(existingRows[0]);

  const newTotalOdooUSD = Math.round(fiscalSummary.totalUSD * 100) / 100;
  const newTotalOdooBs = Math.round(fiscalSummary.totalVES * 100) / 100;
  const newRate = Math.round(fiscalSummary.rate * 100) / 100;
  const newDifCambiaria = Math.round((existing.ventaNetaZ - newTotalOdooBs) * 100) / 100;

  // Update totals that depend on fiscal summary
  const newTotalRetPOS = Math.round(fiscalSummary.totalRetencionesPOS * newRate * 100) / 100;
  const newTotalCreditoPOS = Math.round(fiscalSummary.totalCreditoPOS * newRate * 100) / 100;
  const newTotalSaldoFavorPOS = Math.round(fiscalSummary.totalSaldoFavorPOS * newRate * 100) / 100;

  const { rows } = await pool.query(
    `UPDATE cuadres SET
      tasa_dia=$1, total_odoo_usd=$2, total_odoo_bs=$3, dif_cambiaria=$4,
      total_retenciones_pos=$5, total_credito_pos=$6, total_saldo_favor_pos=$7
    WHERE id=$8 RETURNING *`,
    [newRate, newTotalOdooUSD, newTotalOdooBs, newDifCambiaria,
     newTotalRetPOS, newTotalCreditoPOS, newTotalSaldoFavorPOS, id]
  );

  // Also update fiscal summary snapshot
  await saveFiscalSummarySnapshot(pool as any, id, fiscalSummary);

  return rows.length > 0 ? rowToCuadre(rows[0]) : null;
}


export async function updateCuadreEstado(id: string, estado: "cuadrado" | "pendiente" | "descuadrado"): Promise<Cuadre | null> {
  const { rows } = await pool.query(
    "UPDATE cuadres SET estado=$1 WHERE id=$2 RETURNING *",
    [estado, id]
  );
  return rows.length > 0 ? rowToCuadre(rows[0]) : null;
}

export async function recalculateCuadreEstado(id: string): Promise<Cuadre | null> {
  const cuadre = await getCuadreById(id);
  if (!cuadre) return null;

  const metodos = cuadre.metodos || [];
  const deducciones = cuadre.deducciones || [];
  const ajustesManuales = cuadre.ajustesManuales || [];

  // Same exclusion logic as computeCuadreTotals and frontend directMetodos filter.
  const directMetodos = metodos.filter(
    (m) => !SPECIAL_METHOD_IDS.has(m.metodoId)
        && !isDeliveryOrDifName(m.metodoNombre || "")
  );
  const totalMetodosReal = directMetodos.reduce((sum, m) => sum + toNum(m.montoReal), 0);
  const totalDeducciones = deducciones.reduce((sum, d) => sum + toNum(d.monto), 0);
  const totalAjustesManuales = ajustesManuales.reduce((sum, a) => sum + toNum(a.monto), 0);

  const deliveryDifTotal = metodos
    .filter((m) => isDeliveryOrDifName(m.metodoNombre || ""))
    .reduce((sum, m) => sum + toNum(m.montoPOS_Bs), 0);

  const totalJustificado =
    totalMetodosReal +
    toNum(cuadre.totalRetencionesReal) +
    toNum(cuadre.retencionesPorCobrar) +
    toNum(cuadre.totalAbonosReal) +
    Math.abs(toNum(cuadre.totalCxCPendiente)) +
    toNum(cuadre.totalSaldoFavorReal) +
    deliveryDifTotal +
    totalDeducciones +
    totalAjustesManuales;

  const diferencia = Math.round((totalJustificado - cuadre.ventaNetaZ) * 100) / 100;
  const newEstado: "cuadrado" | "pendiente" =
    cuadre.ventaNetaZ === 0
      ? "cuadrado"
      : Math.abs(diferencia) < CUADRE_TOLERANCE_BS
      ? "cuadrado"
      : "pendiente";

  if (cuadre.estado === newEstado) return cuadre;
  return updateCuadreEstado(id, newEstado);
}

// ─── Child Tables ────────────────────────────────────────────────────────────

async function getMetodosByCuadre(cuadreId: string): Promise<MetodoVerificado[]> {
  const { rows } = await pool.query(
    "SELECT id, cuadre_id as \"cuadreId\", metodo_id as \"metodoId\", metodo_nombre as \"metodoNombre\", monto_pos_usd as \"montoPOS_USD\", monto_pos_bs as \"montoPOS_Bs\", monto_real as \"montoReal\", diferencia, observacion FROM metodos_verificados WHERE cuadre_id = $1",
    [cuadreId]
  );
  return rows;
}

async function getDeduccionesByCuadre(cuadreId: string): Promise<Deduccion[]> {
  const { rows } = await pool.query(
    "SELECT id, cuadre_id as \"cuadreId\", tipo, descripcion, monto, comprobante FROM deducciones WHERE cuadre_id = $1",
    [cuadreId]
  );
  return rows;
}

async function getAjustesByCuadre(cuadreId: string): Promise<AjusteManual[]> {
  const { rows } = await pool.query(
    "SELECT id, cuadre_id as \"cuadreId\", tipo, descripcion, monto, referencia FROM ajustes_manuales WHERE cuadre_id = $1",
    [cuadreId]
  );
  return rows;
}

// ─── Snapshot Tables ─────────────────────────────────────────────────────────

async function saveCreditSalesSnapshot(client: PoolClient, cuadreId: string, rows: CreditSaleRow[]): Promise<void> {
  await client.query("DELETE FROM credit_sales_snapshot WHERE cuadre_id = $1", [cuadreId]);
  let idx = 0;
  for (const r of rows) {
    const id = `CS-${Date.now()}-${idx++}`;
    await client.query(
      `INSERT INTO credit_sales_snapshot (id, cuadre_id, invoice_number, partner, invoice_total,
        credit_amount_pos, retention_amount_pos, abono_amount, abono_amount_bs, abono_journal,
        abono_by_journal, residual, residual_bs, payment_state, payment_total_bs, payment_total_usd,
        excedente_bs, excedente_usd, excedente_concepto, genera_saldo_favor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [id, cuadreId, r.invoiceNumber, r.partner, r.invoiceTotal, r.creditAmountPOS,
        r.retentionAmountPOS, r.abonoAmount, r.abonoAmountBs, r.abonoJournal,
        JSON.stringify(r.abonoByJournal || {}), r.residual, r.residualBs, r.paymentState,
        r.paymentTotalBs, r.paymentTotalUsd, r.excedenteBs, r.excedenteUsd,
        r.excedenteConcepto, r.generaSaldoFavor]
    );
  }
}

async function saveRetencionesSnapshot(client: PoolClient, cuadreId: string, rows: RetentionRow[]): Promise<void> {
  await client.query("DELETE FROM retenciones_snapshot WHERE cuadre_id = $1", [cuadreId]);
  let idx = 0;
  for (const r of rows) {
    const id = `RS-${Date.now()}-${idx++}`;
    await client.query(
      `INSERT INTO retenciones_snapshot (id, cuadre_id, invoice_number, partner, pos_total_usd,
        pos_total_bs, retention_amount, retention_amount_bs, rivac_entry_name, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [id, cuadreId, r.invoiceNumber, r.partner, r.posTotalUSD, r.posTotalBs,
        r.retentionAmount, r.retentionAmountBs, r.rivacEntryName, r.status]
    );
  }
}

async function saveSaldosFavorSnapshot(client: PoolClient, cuadreId: string, rows: SaldoFavorRow[]): Promise<void> {
  await client.query("DELETE FROM saldos_favor_snapshot WHERE cuadre_id = $1", [cuadreId]);
  let idx = 0;
  for (const r of rows) {
    const id = `SF-${Date.now()}-${idx++}`;
    await client.query(
      `INSERT INTO saldos_favor_snapshot (id, cuadre_id, order_name, partner, invoice_number, amount, amount_bs)
      VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, cuadreId, r.orderName, r.partner, r.invoiceNumber, r.amount, r.amountBs]
    );
  }
}

async function saveFiscalSummarySnapshot(client: PoolClient, cuadreId: string, fs: FiscalSummary | undefined): Promise<void> {
  await client.query("DELETE FROM fiscal_summary_snapshot WHERE cuadre_id = $1", [cuadreId]);
  if (!fs) return;
  const id = `FS-${Date.now()}`;
  await client.query(
    `INSERT INTO fiscal_summary_snapshot (id, cuadre_id, journal_id, journal_code, invoice_count,
      nc_count, total_usd, total_tax_usd, total_ves, rate, total_retenciones_pos, total_credito_pos,
      total_saldo_favor_pos, first_invoice, last_invoice, first_nc, last_nc, companion_session_name,
      payments, main_first_invoice, main_last_invoice, main_invoice_count, main_first_nc, main_last_nc,
      main_nc_count, companion_first_invoice, companion_last_invoice, companion_invoice_count,
      companion_first_nc, companion_last_nc, companion_nc_count, companion_journal_code,
      main_journal_code, main_caja_name, companion_caja_name)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)`,
    [id, cuadreId, fs.journalId, fs.journalCode, fs.invoiceCount, fs.ncCount,
      fs.totalUSD, fs.totalTaxUSD, fs.totalVES, fs.rate, fs.totalRetencionesPOS,
      fs.totalCreditoPOS, fs.totalSaldoFavorPOS, fs.firstInvoice, fs.lastInvoice,
      fs.firstNC, fs.lastNC, fs.companionSessionName, JSON.stringify(fs.payments || []),
      fs.mainFirstInvoice, fs.mainLastInvoice, fs.mainInvoiceCount, fs.mainFirstNC,
      fs.mainLastNC, fs.mainNcCount, fs.companionFirstInvoice, fs.companionLastInvoice,
      fs.companionInvoiceCount, fs.companionFirstNC, fs.companionLastNC, fs.companionNcCount,
      fs.companionJournalCode, fs.mainJournalCode, fs.mainCajaName, fs.companionCajaName]
  );
}

async function getCreditSalesSnapshot(cuadreId: string): Promise<CreditSaleRow[]> {
  const { rows } = await pool.query(
    `SELECT invoice_number as "invoiceNumber", partner, invoice_total as "invoiceTotal",
      credit_amount_pos as "creditAmountPOS", retention_amount_pos as "retentionAmountPOS",
      abono_amount as "abonoAmount", abono_amount_bs as "abonoAmountBs",
      abono_journal as "abonoJournal", abono_by_journal as "abonoByJournal",
      residual, residual_bs as "residualBs", payment_state as "paymentState", payment_total_bs as "paymentTotalBs",
      payment_total_usd as "paymentTotalUsd", excedente_bs as "excedenteBs",
      excedente_usd as "excedenteUsd", excedente_concepto as "excedenteConcepto",
      genera_saldo_favor as "generaSaldoFavor"
    FROM credit_sales_snapshot WHERE cuadre_id = $1 ORDER BY invoice_number`,
    [cuadreId]
  );
  return rows.map((r: any) => ({
    ...r,
    abonoByJournal: typeof r.abonoByJournal === "string" ? JSON.parse(r.abonoByJournal) : r.abonoByJournal || {},
  }));
}

async function getRetencionesSnapshot(cuadreId: string): Promise<RetentionRow[]> {
  const { rows } = await pool.query(
    `SELECT invoice_number as "invoiceNumber", partner, pos_total_usd as "posTotalUSD",
      pos_total_bs as "posTotalBs", retention_amount as "retentionAmount",
      retention_amount_bs as "retentionAmountBs", rivac_entry_name as "rivacEntryName", status
    FROM retenciones_snapshot WHERE cuadre_id = $1 ORDER BY invoice_number`,
    [cuadreId]
  );
  return rows;
}

async function getSaldosFavorSnapshot(cuadreId: string): Promise<SaldoFavorRow[]> {
  const { rows } = await pool.query(
    `SELECT order_name as "orderName", partner, invoice_number as "invoiceNumber", amount, amount_bs as "amountBs"
    FROM saldos_favor_snapshot WHERE cuadre_id = $1 ORDER BY order_name`,
    [cuadreId]
  );
  return rows;
}

async function getFiscalSummarySnapshot(cuadreId: string): Promise<FiscalSummary | null> {
  const { rows } = await pool.query(
    `SELECT journal_id as "journalId", journal_code as "journalCode", invoice_count as "invoiceCount",
      nc_count as "ncCount", total_usd as "totalUSD", total_tax_usd as "totalTaxUSD",
      total_ves as "totalVES", rate, total_retenciones_pos as "totalRetencionesPOS",
      total_credito_pos as "totalCreditoPOS", total_saldo_favor_pos as "totalSaldoFavorPOS",
      first_invoice as "firstInvoice", last_invoice as "lastInvoice", first_nc as "firstNC",
      last_nc as "lastNC", companion_session_name as "companionSessionName", payments,
      main_first_invoice as "mainFirstInvoice", main_last_invoice as "mainLastInvoice",
      main_invoice_count as "mainInvoiceCount", main_first_nc as "mainFirstNC",
      main_last_nc as "mainLastNC", main_nc_count as "mainNcCount",
      companion_first_invoice as "companionFirstInvoice", companion_last_invoice as "companionLastInvoice",
      companion_invoice_count as "companionInvoiceCount", companion_first_nc as "companionFirstNC",
      companion_last_nc as "companionLastNC", companion_nc_count as "companionNcCount",
      companion_journal_code as "companionJournalCode", main_journal_code as "mainJournalCode",
      main_caja_name as "mainCajaName", companion_caja_name as "companionCajaName"
    FROM fiscal_summary_snapshot WHERE cuadre_id = $1`,
    [cuadreId]
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    ...r,
    payments: typeof r.payments === "string" ? JSON.parse(r.payments) : r.payments || [],
  } as FiscalSummary;
}

// ─── Initialize (run schema) ─────────────────────────────────────────────────

export async function initializeDb(): Promise<{ initialized: string[] }> {
  const initialized: string[] = [];
  try {
    const fs = await import("fs");
    const path = await import("path");
    const schemaPath = path.join(process.cwd(), "server", "schema.sql");
    const schema = fs.readFileSync(schemaPath, "utf-8");
    await pool.query(schema);
    initialized.push("Schema applied successfully");
  } catch (err: any) {
    initialized.push(`Schema init: ${err?.message || err}`);
  }
  return { initialized };
}
