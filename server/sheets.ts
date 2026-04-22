
import { google } from "googleapis";
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
import fs from "fs";
import path from "path";

const SPREADSHEET_ID = process.env.GOOGLE_SHEET_ID || "";

function getAuth() {
  let credentials: any = {};
  
  // Try loading from .env first (for Railway/production)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    try {
      credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (e) {
      console.error("WARNING: GOOGLE_SERVICE_ACCOUNT_JSON parse error:", e);
    }
  }
  
  // Fallback to local JSON file (for local development)
  if (!credentials.client_email) {
    const credPath = path.join(process.cwd(), "google-credentials.json");
    if (fs.existsSync(credPath)) {
      try {
        const fileContent = fs.readFileSync(credPath, "utf-8");
        credentials = JSON.parse(fileContent);
        console.log("Loaded Google credentials from google-credentials.json");
      } catch (e) {
        console.error("WARNING: Error reading google-credentials.json:", e);
      }
    }
  }
  
  if (!credentials.client_email) {
    console.error("WARNING: No Google credentials found - Google Sheets will fail");
  }
  
  return new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

function getSheets() {
  return google.sheets({ version: "v4", auth: getAuth() });
}

async function getSheetData(sheetName: string): Promise<string[][]> {
  const sheets = getSheets();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:AO`,
  });
  return (res.data.values || []) as string[][];
}

async function appendRow(sheetName: string, values: any[]): Promise<void> {
  const sheets = getSheets();
  await sheets.spreadsheets.values.append({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [values.map((v) => (v === undefined || v === null ? "" : String(v)))] },
  });
}

async function updateRow(sheetName: string, rowIndex: number, values: any[]): Promise<void> {
  const sheets = getSheets();
  const lastCol = values.length > 44 ? "AS" : values.length > 43 ? "AR" : values.length > 41 ? "AQ" : "AO";
  await sheets.spreadsheets.values.update({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A${rowIndex}:${lastCol}${rowIndex}`,
    valueInputOption: "RAW",
    requestBody: { values: [values.map((v) => (v === undefined || v === null ? "" : String(v)))] },
  });
}

async function deleteRow(sheetName: string, rowIndex: number): Promise<void> {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: SPREADSHEET_ID });
  const sheet = meta.data.sheets?.find((s) => s.properties?.title === sheetName);
  if (!sheet?.properties?.sheetId && sheet?.properties?.sheetId !== 0) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheet.properties.sheetId,
              dimension: "ROWS",
              startIndex: rowIndex - 1,
              endIndex: rowIndex,
            },
          },
        },
      ],
    },
  });
}

// ---- Users ----

function rowToUser(row: string[]): User {
  return {
    id: row[0] || "",
    nombre: row[1] || "",
    email: row[2] || "",
    password: row[3] || "",
    rol: (row[4] as "cajero" | "supervisor" | "admin") || "cajero",
    activo: row[5] !== "false",
  };
}

export async function getUsers(): Promise<UserPublic[]> {
  const rows = await getSheetData("Usuarios");
  return rows.slice(1).map((r) => {
    const u = rowToUser(r);
    const { password, ...pub } = u;
    return pub;
  });
}

export async function getUserByEmail(email: string): Promise<User | null> {
  const rows = await getSheetData("Usuarios");
  for (const row of rows.slice(1)) {
    if (row[2]?.toLowerCase() === email.toLowerCase()) {
      return rowToUser(row);
    }
  }
  return null;
}

export async function createUser(data: Omit<User, "id">): Promise<UserPublic> {
  const id = `USR-${Date.now()}`;
  await appendRow("Usuarios", [id, data.nombre, data.email, data.password, data.rol, String(data.activo)]);
  const { password, ...pub } = { id, ...data };
  return pub;
}

export async function updateUser(id: string, data: Partial<User>): Promise<UserPublic | null> {
  const rows = await getSheetData("Usuarios");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      const existing = rowToUser(rows[i]);
      const updated = { ...existing, ...data };
      await updateRow("Usuarios", i + 1, [
        updated.id,
        updated.nombre,
        updated.email,
        updated.password,
        updated.rol,
        String(updated.activo),
      ]);
      const { password, ...pub } = updated;
      return pub;
    }
  }
  return null;
}

// ---- Cuadres ----
// Column mapping (A-AO):
// A=id, B=fecha, C=caja, D=maquinaFiscal, E=sessionId, F=sessionName,
// G=cajero, H=zNumero, I=ventaBrutaZ, J=notasCreditoZ, K=ventaNetaZ,
// L=baseImponibleZ, M=exentoZ, N=ivaZ, O=igtfZ, P=primeraFacturaZ,
// Q=ultimaFacturaZ, R=tasaDia, S=totalOdooUSD, T=totalOdooBs,
// U=difCambiaria, V=totalMetodosReal, W=totalDeducciones, X=totalJustificado,
// Y=diferencia, Z=estado, AA=observaciones, AB=cerradoPor, AC=creadoEn, AD=cerradoEn,
// AE=totalRetencionesPOS, AF=totalRetencionesReal, AG=totalCreditoPOS,
// AH=totalAbonosReal, AI=totalCxCPendiente, AJ=totalSaldoFavorPOS,
// AK=totalSaldoFavorReal, AL=totalAjustesManuales, AM=primeraNCZ,
// AN=ultimaNCZ, AO=retencionesPorCobrar, AP=saldoFavorObs,
// AQ=totalMetodosPOS, AR=totalJustificadoReal, AS=totalDirectoPOS

function rowToCuadre(row: string[]): Cuadre {
  return {
    id: row[0] || "",
    fecha: row[1] || "",
    caja: row[2] || "",
    maquinaFiscal: row[3] || "",
    sessionId: Number(row[4]) || 0,
    sessionName: row[5] || "",
    cajero: row[6] || "",
    zNumero: row[7] || "",
    ventaBrutaZ: Number(row[8]) || 0,
    notasCreditoZ: Number(row[9]) || 0,
    ventaNetaZ: Number(row[10]) || 0,
    baseImponibleZ: Number(row[11]) || 0,
    exentoZ: Number(row[12]) || 0,
    ivaZ: Number(row[13]) || 0,
    igtfZ: Number(row[14]) || 0,
    primeraFacturaZ: row[15] || "",
    ultimaFacturaZ: row[16] || "",
    primeraNCZ: row[38] || "",
    ultimaNCZ: row[39] || "",
    tasaDia: Number(row[17]) || 0,
    totalOdooUSD: Number(row[18]) || 0,
    totalOdooBs: Number(row[19]) || 0,
    difCambiaria: Number(row[20]) || 0,
    totalMetodosReal: Number(row[21]) || 0,
    totalDeducciones: Number(row[22]) || 0,
    totalJustificado: Number(row[23]) || 0,
    diferencia: Number(row[24]) || 0,
    estado: (row[25] as "cuadrado" | "descuadrado" | "pendiente") || "pendiente",
    observaciones: row[26] || "",
    cerradoPor: row[27] || "",
    creadoEn: row[28] || "",
    cerradoEn: row[29] || "",
    totalRetencionesPOS: Number(row[30]) || 0,
    totalRetencionesReal: Number(row[31]) || 0,
    totalCreditoPOS: Number(row[32]) || 0,
    totalAbonosReal: Number(row[33]) || 0,
    totalCxCPendiente: Number(row[34]) || 0,
    totalSaldoFavorPOS: Number(row[35]) || 0,
    totalSaldoFavorReal: Number(row[36]) || 0,
    totalAjustesManuales: Number(row[37]) || 0,
    retencionesPorCobrar: Number(row[40]) || 0,
    saldoFavorObs: row[41] || "",
    totalMetodosPOS: Number(row[42]) || 0,
    totalJustificadoReal: Number(row[43]) || 0,
    totalDirectoPOS: Number(row[44]) || 0,
  };
}

function cuadreToRow(c: Cuadre): any[] {
  return [
    c.id,
    c.fecha,
    c.caja,
    c.maquinaFiscal,
    c.sessionId,
    c.sessionName,
    c.cajero,
    c.zNumero,
    c.ventaBrutaZ,
    c.notasCreditoZ,
    c.ventaNetaZ,
    c.baseImponibleZ,
    c.exentoZ,
    c.ivaZ,
    c.igtfZ,
    c.primeraFacturaZ,
    c.ultimaFacturaZ,
    c.tasaDia,
    c.totalOdooUSD,
    c.totalOdooBs,
    c.difCambiaria,
    c.totalMetodosReal,
    c.totalDeducciones,
    c.totalJustificado,
    c.diferencia,
    c.estado,
    c.observaciones,
    c.cerradoPor,
    c.creadoEn,
    c.cerradoEn,
    c.totalRetencionesPOS,
    c.totalRetencionesReal,
    c.totalCreditoPOS,
    c.totalAbonosReal,
    c.totalCxCPendiente,
    c.totalSaldoFavorPOS,
    c.totalSaldoFavorReal,
    c.totalAjustesManuales,
    c.primeraNCZ,
    c.ultimaNCZ,
    c.retencionesPorCobrar || 0,
    c.saldoFavorObs || "",
    c.totalMetodosPOS || 0,
    c.totalJustificadoReal || 0,
    c.totalDirectoPOS || 0,
  ];
  console.log("cuadreToRow - totalMetodosPOS:", c.totalMetodosPOS, "totalDirectoPOS:", c.totalDirectoPOS);
}

export async function getCuadres(filters?: { fecha?: string; caja?: string; estado?: string; cerrado?: string }): Promise<Cuadre[]> {
  const rows = await getSheetData("Cuadres");
  let cuadres = rows.slice(1).map(rowToCuadre);
  if (filters?.fecha) cuadres = cuadres.filter((c) => c.fecha === filters.fecha);
  if (filters?.caja) cuadres = cuadres.filter((c) => c.caja === filters.caja);
  if (filters?.estado) cuadres = cuadres.filter((c) => c.estado === filters.estado);
  if (filters?.cerrado) {
    const isCerrado = filters.cerrado === "si";
    cuadres = cuadres.filter((c) => (c.cerradoPor ? true : false) === isCerrado);
  }
  return cuadres;
}

export async function getCuadreById(id: string): Promise<CuadreDetail | null> {
  const rows = await getSheetData("Cuadres");
  let cuadre: Cuadre | null = null;
  for (const row of rows.slice(1)) {
    if (row[0] === id) {
      cuadre = rowToCuadre(row);
      break;
    }
  }
  if (!cuadre) return null;

  const metodos = await getMetodosByCuadre(id);
  const deducciones = await getDeduccionesByCuadre(id);
  const ajustesManuales = await getAjustesByCuadre(id);

  return { ...cuadre, metodos, deducciones, ajustesManuales };
}

export async function getCuadreBySessionId(sessionId: number): Promise<Cuadre | null> {
  const rows = await getSheetData("Cuadres");
  for (const row of rows.slice(1)) {
    if (Number(row[4]) === sessionId) {
      return rowToCuadre(row);
    }
  }
  return null;
}

export async function createCuadre(data: CreateCuadre): Promise<CuadreDetail> {
  const id = `CQ-${Date.now()}`;
  const now = new Date().toISOString();

  const totalMetodosReal = (data.metodos || []).reduce((sum, m) => sum + (m.montoReal || 0), 0);
  const totalDeducciones = (data.deducciones || []).reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalAjustesManuales = (data.ajustesManuales || []).reduce((sum, a) => sum + (a.monto || 0), 0);

  const deliveryDifTotal = (data.metodos || [])
    .filter(
      (m) =>
        (m.metodoNombre || "").toLowerCase().includes("delivery") ||
        (m.metodoNombre || "").toLowerCase().includes("diferencia")
    )
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
  let estado: "cuadrado" | "pendiente";
  if (data.ventaNetaZ === 0) {
    estado = "cuadrado";
    console.log(`[createCuadre] NF cuadre detected, forcing estado=cuadrado`);
  } else {
    estado = Math.abs(diferencia) < 5.00 ? "cuadrado" : "pendiente";
  }
  console.log(`[createCuadre] id=${id} diferencia=${diferencia} estado=${estado}`);

  const cuadre: Cuadre = {
    id,
    fecha: data.fecha,
    caja: data.caja,
    maquinaFiscal: data.maquinaFiscal,
    sessionId: data.sessionId,
    sessionName: data.sessionName,
    cajero: data.cajero,
    zNumero: data.zNumero,
    ventaBrutaZ: data.ventaBrutaZ,
    notasCreditoZ: data.notasCreditoZ,
    ventaNetaZ: data.ventaNetaZ,
    baseImponibleZ: data.baseImponibleZ,
    exentoZ: data.exentoZ,
    ivaZ: data.ivaZ,
    igtfZ: data.igtfZ,
    primeraFacturaZ: data.primeraFacturaZ,
    ultimaFacturaZ: data.ultimaFacturaZ,
    tasaDia: data.tasaDia,
    totalOdooUSD: data.totalOdooUSD,
    totalOdooBs: data.totalOdooBs,
    difCambiaria: data.difCambiaria,
    totalMetodosReal: Math.round(totalMetodosReal * 100) / 100,
    totalDeducciones: Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
    totalJustificado: Math.round(totalJustificado * 100) / 100,
    diferencia,
    estado,
    observaciones: data.observaciones || "",
    cerradoPor: "",
    creadoEn: now,
    cerradoEn: "",
    totalRetencionesPOS: data.totalRetencionesPOS || 0,
    totalRetencionesReal: data.totalRetencionesReal || 0,
    totalCreditoPOS: data.totalCreditoPOS || 0,
    totalAbonosReal: data.totalAbonosReal || 0,
    totalCxCPendiente: data.totalCxCPendiente || 0,
    totalSaldoFavorPOS: data.totalSaldoFavorPOS || 0,
    totalSaldoFavorReal: data.totalSaldoFavorReal || 0,
    totalAjustesManuales: Math.round(totalAjustesManuales * 100) / 100,
    retencionesPorCobrar: data.retencionesPorCobrar || 0,
    saldoFavorObs: data.saldoFavorObs || "",
    totalMetodosPOS: data.totalMetodosPOS || 0,
    totalJustificadoReal: data.totalJustificadoReal || 0,
    totalDirectoPOS: data.totalDirectoPOS || 0,
  };

  await appendRow("Cuadres", cuadreToRow(cuadre));

  const metodos: MetodoVerificado[] = [];
  for (const m of data.metodos) {
    const mid = `MV-${Date.now()}-${m.metodoId}`;
    const montoPosBs = m.montoPOS_Bs || 0;
    const diff = Math.round(((m.montoReal || 0) - montoPosBs) * 100) / 100;
    await appendRow("MetodosVerificados", [
      mid,
      id,
      m.metodoId,
      m.metodoNombre,
      m.montoPOS_USD || 0,
      montoPosBs,
      m.montoReal || 0,
      diff,
      m.observacion || "",
    ]);
    metodos.push({
      id: mid,
      cuadreId: id,
      metodoId: m.metodoId,
      metodoNombre: m.metodoNombre,
      montoPOS_USD: m.montoPOS_USD || 0,
      montoPOS_Bs: montoPosBs,
      montoReal: m.montoReal || 0,
      diferencia: diff,
      observacion: m.observacion || "",
    });
  }

  const deducciones: Deduccion[] = [];
  for (const d of (data.deducciones || [])) {
    const did = `DD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await appendRow("Deducciones", [did, id, d.tipo, d.descripcion, d.monto, d.comprobante || ""]);
    deducciones.push({
      id: did,
      cuadreId: id,
      tipo: d.tipo,
      descripcion: d.descripcion,
      monto: d.monto,
      comprobante: d.comprobante || "",
    });
  }

  const ajustesManuales: AjusteManual[] = [];
  for (const a of data.ajustesManuales || []) {
    const aid = `AJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await appendRow("AjustesManuales", [aid, id, a.tipo, a.descripcion, a.monto, a.referencia || ""]);
    ajustesManuales.push({
      id: aid,
      cuadreId: id,
      tipo: a.tipo,
      descripcion: a.descripcion,
      monto: a.monto,
      referencia: a.referencia || "",
    });
  }

  return { ...cuadre, metodos, deducciones, ajustesManuales };
}

export async function updateCuadre(
  id: string,
  data: CreateCuadre
): Promise<CuadreDetail | null> {
  const rows = await getSheetData("Cuadres");
  let rowIndex = -1;
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      rowIndex = i + 1;
      break;
    }
  }
  if (rowIndex === -1) return null;

  const existing = rowToCuadre(rows[rowIndex - 1]);

  const totalMetodosReal = (data.metodos || []).reduce((sum, m) => sum + (m.montoReal || 0), 0);
  const totalDeducciones = (data.deducciones || []).reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalAjustesManuales = (data.ajustesManuales || []).reduce((sum, a) => sum + (a.monto || 0), 0);

  const deliveryDifTotal = (data.metodos || [])
    .filter(
      (m) =>
        (m.metodoNombre || "").toLowerCase().includes("delivery") ||
        (m.metodoNombre || "").toLowerCase().includes("diferencia")
    )
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
  let estado: Cuadre["estado"];
  if (existing.estado === "cuadrado" || existing.cerradoPor) {
    estado = existing.estado;
  } else if (data.ventaNetaZ === 0) {
    estado = "cuadrado";
    console.log(`[updateCuadre] NF cuadre detected, forcing estado=cuadrado`);
  } else {
    estado = Math.abs(diferencia) < 5.00 ? "cuadrado" : "pendiente";
  }
  console.log(`[updateCuadre] id=${id} diferencia=${diferencia} estado=${estado}`);

  const cuadre: Cuadre = {
    id,
    fecha: data.fecha,
    caja: data.caja,
    maquinaFiscal: data.maquinaFiscal,
    sessionId: data.sessionId,
    sessionName: data.sessionName,
    cajero: data.cajero,
    zNumero: data.zNumero,
    ventaBrutaZ: data.ventaBrutaZ,
    notasCreditoZ: data.notasCreditoZ,
    ventaNetaZ: data.ventaNetaZ,
    baseImponibleZ: data.baseImponibleZ,
    exentoZ: data.exentoZ,
    ivaZ: data.ivaZ,
    igtfZ: data.igtfZ,
    primeraFacturaZ: data.primeraFacturaZ,
    ultimaFacturaZ: data.ultimaFacturaZ,
    tasaDia: data.tasaDia,
    totalOdooUSD: data.totalOdooUSD,
    totalOdooBs: data.totalOdooBs,
    difCambiaria: data.difCambiaria,
    totalMetodosReal: Math.round(totalMetodosReal * 100) / 100,
    totalDeducciones: Math.round((totalDeducciones + deliveryDifTotal) * 100) / 100,
    totalJustificado: Math.round(totalJustificado * 100) / 100,
    diferencia,
    estado,
    observaciones: data.observaciones || "",
    cerradoPor: existing.cerradoPor,
    creadoEn: existing.creadoEn,
    cerradoEn: existing.cerradoEn,
    totalRetencionesPOS: data.totalRetencionesPOS || 0,
    totalRetencionesReal: data.totalRetencionesReal || 0,
    totalCreditoPOS: data.totalCreditoPOS || 0,
    totalAbonosReal: data.totalAbonosReal || 0,
    totalCxCPendiente: data.totalCxCPendiente || 0,
    totalSaldoFavorPOS: data.totalSaldoFavorPOS || 0,
    totalSaldoFavorReal: data.totalSaldoFavorReal || 0,
    totalAjustesManuales: Math.round(totalAjustesManuales * 100) / 100,
    retencionesPorCobrar: data.retencionesPorCobrar || 0,
    saldoFavorObs: data.saldoFavorObs || "",
    totalMetodosPOS: data.totalMetodosPOS || 0,
    totalJustificadoReal: data.totalJustificadoReal || 0,
    totalDirectoPOS: data.totalDirectoPOS || 0,
  };
  console.log("updateCuadre - totalMetodosPOS:", cuadre.totalMetodosPOS, "totalDirectoPOS:", cuadre.totalDirectoPOS);

  await updateRow("Cuadres", rowIndex, cuadreToRow(cuadre));

  await deleteRelatedRows("MetodosVerificados", id);
  await deleteRelatedRows("Deducciones", id);
  await deleteRelatedRows("AjustesManuales", id);

  const metodos: MetodoVerificado[] = [];
  for (const m of data.metodos) {
    const mid = `MV-${Date.now()}-${m.metodoId}`;
    const montoPosBs = m.montoPOS_Bs || 0;
    const diff = Math.round(((m.montoReal || 0) - montoPosBs) * 100) / 100;
    await appendRow("MetodosVerificados", [
      mid,
      id,
      m.metodoId,
      m.metodoNombre,
      m.montoPOS_USD || 0,
      montoPosBs,
      m.montoReal || 0,
      diff,
      m.observacion || "",
    ]);
    metodos.push({
      id: mid,
      cuadreId: id,
      metodoId: m.metodoId,
      metodoNombre: m.metodoNombre,
      montoPOS_USD: m.montoPOS_USD || 0,
      montoPOS_Bs: montoPosBs,
      montoReal: m.montoReal || 0,
      diferencia: diff,
      observacion: m.observacion || "",
    });
  }

  const deducciones: Deduccion[] = [];
  for (const d of (data.deducciones || [])) {
    const did = `DD-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await appendRow("Deducciones", [did, id, d.tipo, d.descripcion, d.monto, d.comprobante || ""]);
    deducciones.push({
      id: did,
      cuadreId: id,
      tipo: d.tipo,
      descripcion: d.descripcion,
      monto: d.monto,
      comprobante: d.comprobante || "",
    });
  }

  const ajustesManuales: AjusteManual[] = [];
  for (const a of data.ajustesManuales || []) {
    const aid = `AJ-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await appendRow("AjustesManuales", [aid, id, a.tipo, a.descripcion, a.monto, a.referencia || ""]);
    ajustesManuales.push({
      id: aid,
      cuadreId: id,
      tipo: a.tipo,
      descripcion: a.descripcion,
      monto: a.monto,
      referencia: a.referencia || "",
    });
  }

  return { ...cuadre, metodos, deducciones, ajustesManuales };
}

export async function closeCuadre(id: string, cerradoPor: string): Promise<Cuadre | null> {
  const rows = await getSheetData("Cuadres");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      const cuadre = rowToCuadre(rows[i]);
      const now = new Date().toISOString();
      const estado: Cuadre["estado"] = Math.abs(cuadre.diferencia) < 0.01 ? "cuadrado" : "descuadrado";
      const updated: Cuadre = { ...cuadre, estado, cerradoPor, cerradoEn: now };
      await updateRow("Cuadres", i + 1, cuadreToRow(updated));
      return updated;
    }
  }
  return null;
}

export async function reopenCuadre(id: string): Promise<Cuadre | null> {
  const rows = await getSheetData("Cuadres");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      const cuadre = rowToCuadre(rows[i]);
      const updated: Cuadre = {
        ...cuadre,
        estado: "pendiente",
        cerradoPor: "",
        cerradoEn: "",
      };
      await updateRow("Cuadres", i + 1, cuadreToRow(updated));
      return updated;
    }
  }
  return null;
}

export async function deleteCuadre(id: string): Promise<boolean> {
  await deleteRelatedRows("MetodosVerificados", id);
  await deleteRelatedRows("Deducciones", id);
  await deleteRelatedRows("AjustesManuales", id);

  const rows = await getSheetData("Cuadres");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      await deleteRow("Cuadres", i + 1);
      return true;
    }
  }
  return false;
}

export async function updateCuadreEstado(id: string, estado: "cuadrado" | "pendiente" | "descuadrado"): Promise<Cuadre | null> {
  const rows = await getSheetData("Cuadres");
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] === id) {
      const cuadre = rowToCuadre(rows[i]);
      console.log(`[updateCuadreEstado] id=${id} oldEstado=${cuadre.estado} newEstado=${estado}`);
      const updated: Cuadre = { ...cuadre, estado };
      await updateRow("Cuadres", i + 1, cuadreToRow(updated));
      return updated;
    }
  }
  return null;
}

export async function recalculateCuadreEstado(id: string): Promise<Cuadre | null> {
  const cuadre = await getCuadreById(id);
  if (!cuadre) return null;

  const metodos = cuadre.metodos || [];
  const deducciones = cuadre.deducciones || [];
  const ajustesManuales = cuadre.ajustesManuales || [];

  const totalMetodosReal = metodos.reduce((sum, m) => sum + (m.montoReal_Bs || m.montoReal || 0), 0);
  const totalDeducciones = deducciones.reduce((sum, d) => sum + (d.monto || 0), 0);
  const totalAjustesManuales = ajustesManuales.reduce((sum, a) => sum + (a.monto || 0), 0);

  const deliveryDifTotal = metodos
    .filter((m) =>
      (m.metodoNombre || "").toLowerCase().includes("delivery") ||
      (m.metodoNombre || "").toLowerCase().includes("diferencia")
    )
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
      : Math.abs(diferencia) < 5.00
      ? "cuadrado"
      : "pendiente";

  console.log(`[recalculateCuadreEstado] id=${id} oldEstado=${cuadre.estado} newEstado=${newEstado} diferencia=${diferencia}`);

  if (cuadre.estado === newEstado) {
    console.log(`[recalculateCuadreEstado] estado unchanged, returning existing`);
    return cuadre;
  }

  return updateCuadreEstado(id, newEstado);
}

// ---- MetodosVerificados ----
// Columns: A=id, B=cuadreId, C=metodoId, D=metodoNombre, E=montoPOS_USD, F=montoPOS_Bs, G=montoReal, H=diferencia, I=observacion
async function getMetodosByCuadre(cuadreId: string): Promise<MetodoVerificado[]> {
  const rows = await getSheetData("MetodosVerificados");
  return rows
    .slice(1)
    .filter((r) => r[1] === cuadreId)
    .map((r) => ({
      id: r[0] || "",
      cuadreId: r[1] || "",
      metodoId: Number(r[2]) || 0,
      metodoNombre: r[3] || "",
      montoPOS_USD: Number(r[4]) || 0,
      montoPOS_Bs: Number(r[5]) || 0,
      montoReal: Number(r[6]) || 0,
      diferencia: Number(r[7]) || 0,
      observacion: r[8] || "",
    }));
}

// ---- Deducciones ----
async function getDeduccionesByCuadre(cuadreId: string): Promise<Deduccion[]> {
  const rows = await getSheetData("Deducciones");
  return rows
    .slice(1)
    .filter((r) => r[1] === cuadreId)
    .map((r) => ({
      id: r[0] || "",
      cuadreId: r[1] || "",
      tipo: r[2] || "",
      descripcion: r[3] || "",
      monto: Number(r[4]) || 0,
      comprobante: r[5] || "",
    }));
}

// ---- AjustesManuales ----
// Columns: A=id, B=cuadreId, C=tipo, D=descripcion, E=monto, F=referencia
async function getAjustesByCuadre(cuadreId: string): Promise<AjusteManual[]> {
  const rows = await getSheetData("AjustesManuales");
  return rows
    .slice(1)
    .filter((r) => r[1] === cuadreId)
    .map((r) => ({
      id: r[0] || "",
      cuadreId: r[1] || "",
      tipo: r[2] || "",
      descripcion: r[3] || "",
      monto: Number(r[4]) || 0,
      referencia: r[5] || "",
    }));
}

// ---- Init ----
export async function initializeSheets(): Promise<{ initialized: string[] }> {
  const sheetsClient = getSheets();
  const initialized: string[] = [];

  const sheetConfigs = [
    {
      name: "Usuarios",
      headers: ["id", "nombre", "email", "password", "rol", "activo"],
      seedData: [["USR-001", "Juan Carlos Bastardo", "juan@onprotec.com", "9803", "admin", "true"]],
    },
    {
      name: "Cuadres",
      headers: [
        "id",
        "fecha",
        "caja",
        "maquinaFiscal",
        "sessionId",
        "sessionName",
        "cajero",
        "zNumero",
        "ventaBrutaZ",
        "notasCreditoZ",
        "ventaNetaZ",
        "baseImponibleZ",
        "exentoZ",
        "ivaZ",
        "igtfZ",
        "primeraFacturaZ",
        "ultimaFacturaZ",
        "tasaDia",
        "totalOdooUSD",
        "totalOdooBs",
        "difCambiaria",
        "totalMetodosReal",
        "totalDeducciones",
        "totalJustificado",
        "diferencia",
        "estado",
        "observaciones",
        "cerradoPor",
        "creadoEn",
        "cerradoEn",
        "totalRetencionesPOS",
        "totalRetencionesReal",
        "totalCreditoPOS",
        "totalAbonosReal",
        "totalCxCPendiente",
        "totalSaldoFavorPOS",
        "totalSaldoFavorReal",
        "totalAjustesManuales",
        "primeraNCZ",
        "ultimaNCZ",
        "retencionesPorCobrar",
        "saldoFavorObs",
      ],
      seedData: [],
    },
    {
      name: "MetodosVerificados",
      headers: [
        "id",
        "cuadreId",
        "metodoId",
        "metodoNombre",
        "montoPOS_USD",
        "montoPOS_Bs",
        "montoReal",
        "diferencia",
        "observacion",
      ],
      seedData: [],
    },
    {
      name: "Deducciones",
      headers: ["id", "cuadreId", "tipo", "descripcion", "monto", "comprobante"],
      seedData: [],
    },
    {
      name: "AjustesManuales",
      headers: ["id", "cuadreId", "tipo", "descripcion", "monto", "referencia"],
      seedData: [],
    },
  ];

  for (const config of sheetConfigs) {
    try {
      const existing = await sheetsClient.spreadsheets.values.get({
        spreadsheetId: SPREADSHEET_ID,
        range: `${config.name}!A1:A1`,
      });
      if (existing.data.values && existing.data.values.length > 0) {
        initialized.push(`${config.name}: already has data, skipped`);
        continue;
      }
    } catch {
      // Sheet might not exist or be empty, continue
    }

    const rows = [config.headers, ...config.seedData];
    await sheetsClient.spreadsheets.values.update({
      spreadsheetId: SPREADSHEET_ID,
      range: `${config.name}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rows },
    });
    initialized.push(`${config.name}: headers + ${config.seedData.length} rows written`);
  }

  return { initialized };
}

// ---- Helpers ----
async function deleteRelatedRows(sheetName: string, cuadreId: string): Promise<void> {
  let rows: string[][];
  try {
    rows = await getSheetData(sheetName);
  } catch {
    return;
  }

  const indicesToDelete: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][1] === cuadreId) {
      indicesToDelete.push(i + 1);
    }
  }

  for (const idx of indicesToDelete.reverse()) {
    await deleteRow(sheetName, idx);
  }
}
