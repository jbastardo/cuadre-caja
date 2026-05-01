import { Pool, PoolClient } from "pg";
import type {
  User,
  UserPublic,
  Cuadre,
  CuadreDetail,
  MetodoVerificado,
  Deduccion,
  AjusteManual,
  CreateCuadre,
} from "../shared/schema.js";
import { CUADRE_TOLERANCE_BS } from "../shared/schema.js";

// ─── Connection Pool ─────────────────────────────────────────────────────────

const pool = new Pool({
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
  await pool.query(
    "INSERT INTO usuarios (id, nombre, email, password, rol, activo) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, data.nombre, data.email, data.password, data.rol, data.activo]
  );
  const { password, ...pub } = { id, ...data };
  return pub;
}

export async function updateUser(id: string, data: Partial<User>): Promise<UserPublic | null> {
  const fields: string[] = [];
  const values: any[] = [];
  let idx = 1;
  for (const [key, val] of Object.entries(data)) {
    if (val !== undefined) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }
  if (fields.length === 0) return null;
  values.push(id);
  const { rows } = await pool.query(
    `UPDATE usuarios SET ${fields.join(", ")} WHERE id = $${idx} RETURNING id, nombre, email, rol, activo`,
    values
  );
  return rows.length > 0 ? rows[0] : null;
}

// ─── Cuadres ─────────────────────────────────────────────────────────────────

export async function getCuadres(filters?: { fecha?: string; caja?: string; estado?: string; cerrado?: string }): Promise<Cuadre[]> {
  let sql = "SELECT * FROM cuadres WHERE 1=1";
  const params: any[] = [];
  let pIdx = 1;

  if (filters?.fecha) { sql += ` AND fecha = $${pIdx++}`; params.push(filters.fecha); }
  if (filters?.caja) { sql += ` AND caja = $${pIdx++}`; params.push(filters.caja); }
  if (filters?.estado) { sql += ` AND estado = $${pIdx++}`; params.push(filters.estado); }
  if (filters?.cerrado) {
    const isCerrado = filters.cerrado === "si";
    sql += isCerrado ? ` AND cerrado_por IS NOT NULL AND cerrado_por != ''` : ` AND (cerrado_por IS NULL OR cerrado_por = '')`;
  }

  sql += " ORDER BY fecha DESC, creado_en DESC";
  const { rows } = await pool.query(sql, params);
  return rows.map(rowToCuadre);
}

export async function getCuadreById(id: string): Promise<CuadreDetail | null> {
  const { rows } = await pool.query("SELECT * FROM cuadres WHERE id = $1", [id]);
  if (rows.length === 0) return null;

  const cuadre = rowToCuadre(rows[0]);
  const [metodos, deducciones, ajustesManuales] = await Promise.all([
    getMetodosByCuadre(id),
    getDeduccionesByCuadre(id),
    getAjustesByCuadre(id),
  ]);

  return { ...cuadre, metodos, deducciones, ajustesManuales };
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

async function computeCuadreTotals(data: CreateCuadre): Promise<{
  totalMetodosReal: number;
  totalDeducciones: number;
  totalAjustesManuales: number;
  deliveryDifTotal: number;
  totalJustificado: number;
  diferencia: number;
  estado: "cuadrado" | "pendiente";
}> {
  const totalMetodosReal = (data.metodos || []).reduce((sum, m) => sum + (m.montoReal || 0), 0);
  const totalDeducciones = (data.deducciones || []).reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalAjustesManuales = (data.ajustesManuales || []).reduce((sum, a) => sum + (a.monto || 0), 0);

  const deliveryDifTotal = (data.metodos || [])
    .filter((m) => (m.metodoNombre || "").toLowerCase().includes("delivery") || (m.metodoNombre || "").toLowerCase().includes("diferencia"))
    .reduce((s, m) => s + (m.montoPOS_Bs || 0), 0);

  const totalJustificado =
    totalMetodosReal +
    (data.totalRetencionesReal || 0) +
    (data.retencionesPorCobrar || 0) +
    (data.totalAbonosReal || 0) +
    (data.totalCxCPendiente || 0) +
    (data.totalSaldoFavorReal || 0) +
    deliveryDifTotal +
    totalDeducciones +
    totalAjustesManuales;

  const diferencia = Math.round((totalJustificado - data.ventaNetaZ) * 100) / 100;
  const estado: "cuadrado" | "pendiente" =
    data.ventaNetaZ === 0
      ? "cuadrado"
      : Math.abs(diferencia) < CUADRE_TOLERANCE_BS
      ? "cuadrado"
      : "pendiente";

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
        data.zNumero, data.ventaBrutaZ, data.notasCreditoZ, data.ventaNetaZ,
        data.baseImponibleZ, data.exentoZ, data.ivaZ, data.igtfZ,
        data.primeraFacturaZ, data.ultimaFacturaZ, data.primeraNCZ || "", data.ultimaNCZ || "",
        data.tasaDia, data.totalOdooUSD, data.totalOdooBs, data.difCambiaria,
        Math.round(totalMetodosReal * 100) / 100,
        Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
        Math.round(totalJustificado * 100) / 100,
        diferencia,
        estado,
        data.observaciones || "",
        data.observacionesNF || "",
        data.tipo || "fiscal",
        data.totalRetencionesPOS || 0, data.totalRetencionesReal || 0, data.retencionesPorCobrar || 0,
        data.totalCreditoPOS || 0, data.totalAbonosReal || 0, data.totalCxCPendiente || 0,
        data.totalSaldoFavorPOS || 0, data.totalSaldoFavorReal || 0,
        Math.round(totalAjustesManuales * 100) / 100,
        data.saldoFavorObs || "",
        data.totalMetodosPOS || 0, data.totalJustificadoReal || 0, data.totalDirectoPOS || 0,
        "", now, null,
      ]
    );

    const metodos: MetodoVerificado[] = [];
    for (const m of data.metodos) {
      const mid = `MV-${Date.now()}-${m.metodoId}`;
      const montoPosBs = m.montoReal_Bs || m.montoPOS_Bs || 0;
      const diff = Math.round(((m.montoReal || 0) - (m.montoPOS_USD || 0)) * 100) / 100;
      await client.query(
        "INSERT INTO metodos_verificados (id, cuadre_id, metodo_id, metodo_nombre, monto_pos_usd, monto_pos_bs, monto_real, diferencia, observacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [mid, id, m.metodoId, m.metodoNombre, m.montoPOS_USD || 0, montoPosBs, m.montoReal || 0, diff, m.observacion || ""]
      );
      metodos.push({ id: mid, cuadreId: id, metodoId: m.metodoId, metodoNombre: m.metodoNombre, montoPOS_USD: m.montoPOS_USD || 0, montoPOS_Bs: montoPosBs, montoReal: m.montoReal || 0, diferencia: diff, observacion: m.observacion || "" });
    }

    const deducciones: Deduccion[] = [];
    for (const d of data.deducciones || []) {
      const did = `DD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        "INSERT INTO deducciones (id, cuadre_id, tipo, descripcion, monto, comprobante) VALUES ($1,$2,$3,$4,$5,$6)",
        [did, id, d.tipo, d.descripcion, d.monto, d.comprobante || ""]
      );
      deducciones.push({ id: did, cuadreId: id, tipo: d.tipo, descripcion: d.descripcion, monto: d.monto, comprobante: d.comprobante || "" });
    }

    const ajustesManuales: AjusteManual[] = [];
    for (const a of data.ajustesManuales || []) {
      const aid = `AJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        "INSERT INTO ajustes_manuales (id, cuadre_id, tipo, descripcion, monto, referencia) VALUES ($1,$2,$3,$4,$5,$6)",
        [aid, id, a.tipo, a.descripcion, a.monto, a.referencia || ""]
      );
      ajustesManuales.push({ id: aid, cuadreId: id, tipo: a.tipo, descripcion: a.descripcion, monto: a.monto, referencia: a.referencia || "" });
    }

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

  const { totalMetodosReal, totalDeducciones, totalAjustesManuales, deliveryDifTotal, totalJustificado, diferencia } =
    await computeCuadreTotals(data);

  let estado: Cuadre["estado"];
  if (existing.cerradoPor) {
    estado = existing.estado;
  } else if (data.ventaNetaZ === 0) {
    estado = "cuadrado";
  } else {
    estado = Math.abs(diferencia) < CUADRE_TOLERANCE_BS ? "cuadrado" : "pendiente";
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
        data.zNumero, data.ventaBrutaZ, data.notasCreditoZ, data.ventaNetaZ,
        data.baseImponibleZ, data.exentoZ, data.ivaZ, data.igtfZ,
        data.primeraFacturaZ, data.ultimaFacturaZ, data.primeraNCZ || "", data.ultimaNCZ || "",
        data.tasaDia, data.totalOdooUSD, data.totalOdooBs, data.difCambiaria,
        Math.round(totalMetodosReal * 100) / 100,
        Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
        Math.round(totalJustificado * 100) / 100,
        diferencia, estado,
        data.observaciones || "", data.observacionesNF || "", data.tipo || existing.tipo || "fiscal",
        data.totalRetencionesPOS || 0, data.totalRetencionesReal || 0, data.retencionesPorCobrar || 0,
        data.totalCreditoPOS || 0, data.totalAbonosReal || 0, data.totalCxCPendiente || 0,
        data.totalSaldoFavorPOS || 0, data.totalSaldoFavorReal || 0,
        Math.round(totalAjustesManuales * 100) / 100,
        data.saldoFavorObs || "",
        data.totalMetodosPOS || 0, data.totalJustificadoReal || 0, data.totalDirectoPOS || 0,
        id,
      ]
    );

    await client.query("DELETE FROM metodos_verificados WHERE cuadre_id = $1", [id]);
    await client.query("DELETE FROM deducciones WHERE cuadre_id = $1", [id]);
    await client.query("DELETE FROM ajustes_manuales WHERE cuadre_id = $1", [id]);

    const metodos: MetodoVerificado[] = [];
    for (const m of data.metodos) {
      const mid = `MV-${Date.now()}-${m.metodoId}`;
      const montoPosBs = m.montoReal_Bs || m.montoPOS_Bs || 0;
      const diff = Math.round(((m.montoReal || 0) - (m.montoPOS_USD || 0)) * 100) / 100;
      await client.query(
        "INSERT INTO metodos_verificados (id, cuadre_id, metodo_id, metodo_nombre, monto_pos_usd, monto_pos_bs, monto_real, diferencia, observacion) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        [mid, id, m.metodoId, m.metodoNombre, m.montoPOS_USD || 0, montoPosBs, m.montoReal || 0, diff, m.observacion || ""]
      );
      metodos.push({ id: mid, cuadreId: id, metodoId: m.metodoId, metodoNombre: m.metodoNombre, montoPOS_USD: m.montoPOS_USD || 0, montoPOS_Bs: montoPosBs, montoReal: m.montoReal || 0, diferencia: diff, observacion: m.observacion || "" });
    }

    const deducciones: Deduccion[] = [];
    for (const d of data.deducciones || []) {
      const did = `DD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        "INSERT INTO deducciones (id, cuadre_id, tipo, descripcion, monto, comprobante) VALUES ($1,$2,$3,$4,$5,$6)",
        [did, id, d.tipo, d.descripcion, d.monto, d.comprobante || ""]
      );
      deducciones.push({ id: did, cuadreId: id, tipo: d.tipo, descripcion: d.descripcion, monto: d.monto, comprobante: d.comprobante || "" });
    }

    const ajustesManuales: AjusteManual[] = [];
    for (const a of data.ajustesManuales || []) {
      const aid = `AJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      await client.query(
        "INSERT INTO ajustes_manuales (id, cuadre_id, tipo, descripcion, monto, referencia) VALUES ($1,$2,$3,$4,$5,$6)",
        [aid, id, a.tipo, a.descripcion, a.monto, a.referencia || ""]
      );
      ajustesManuales.push({ id: aid, cuadreId: id, tipo: a.tipo, descripcion: a.descripcion, monto: a.monto, referencia: a.referencia || "" });
    }

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
    "UPDATE cuadres SET estado='pendiente', cerrado_por='', cerrado_en='' WHERE id=$1 RETURNING *",
    [id]
  );
  return rows.length > 0 ? rowToCuadre(rows[0]) : null;
}

export async function deleteCuadre(id: string): Promise<boolean> {
  const { rowCount } = await pool.query("DELETE FROM cuadres WHERE id = $1", [id]);
  return rowCount !== null && rowCount > 0;
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

  const totalMetodosReal = metodos.reduce((sum, m) => sum + (m.montoPOS_Bs || m.montoReal || 0), 0);
  const totalDeducciones = deducciones.reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalAjustesManuales = ajustesManuales.reduce((sum, a) => sum + (a.monto || 0), 0);

  const deliveryDifTotal = metodos
    .filter((m) => (m.metodoNombre || "").toLowerCase().includes("delivery") || (m.metodoNombre || "").toLowerCase().includes("diferencia"))
    .reduce((sum, m) => sum + (m.montoPOS_Bs || 0), 0);

  const totalJustificado =
    totalMetodosReal +
    (cuadre.totalRetencionesReal || 0) +
    (cuadre.retencionesPorCobrar || 0) +
    (cuadre.totalAbonosReal || 0) +
    (cuadre.totalCxCPendiente || 0) +
    (cuadre.totalSaldoFavorReal || 0) +
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
