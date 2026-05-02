import { Router, type Request, type Response } from "express";
import * as odoo from "./odoo.js";
import * as db from "./db.js";
import { createCuadreSchema, loginSchema, CreditSaleRow, RetentionRow, FiscalSummary } from "../shared/schema.js";
import crypto from "crypto";
import bcrypt from "bcryptjs";

// Enable trust proxy for Railway
const app = Router() as any;
if (process.env.NODE_ENV === "production") {
  // This will be set on the actual express app
}

// Pool will be initialized after module loads
let pool: any = null;
async function getPoolClient() {
  if (!pool) {
    pool = await db.getPool();
  }
  return pool;
}

// Rate limiting removed - will add after fixing trust proxy

// Helpers para tipado y extracción de parámetros
function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}

function query(req: Request, name: string): string | undefined {
  const v = req.query[name];
  return typeof v === "string" ? v : undefined;
}

export const router = Router();

// ---- Health Check ----
router.get("/api/health", async (_req: Request, res: Response) => {
  const dbUrl = !!process.env.DATABASE_URL;
  const odooUrl = process.env.ODOO_URL || "not set";
  const odooUser = process.env.ODOO_USERNAME || "not set";
  const odooPass = !!process.env.ODOO_PASSWORD;
  const nodeEnv = process.env.NODE_ENV || "not set";

  let dbOk = false;
  let dbError = "";
  try {
    const client = await db.pool.connect();
    const result = await client.query("SELECT COUNT(*) as cnt FROM usuarios");
    dbOk = true;
    client.release();
    const userCount = result.rows[0]?.cnt || 0;
    return res.json({
      status: "running",
      nodeEnv,
      db: { connected: dbOk, users: userCount },
      odoo: { url: odooUrl, user: odooUser, hasPassword: odooPass },
      env: { DATABASE_URL: dbUrl }
    });
  } catch (err: any) {
    dbError = err.message;
    return res.json({
      status: "running",
      nodeEnv,
      db: { connected: false, error: dbError },
      odoo: { url: odooUrl, user: odooUser, hasPassword: odooPass },
      env: { DATABASE_URL: dbUrl }
    });
  }
});

// ---- Cache Management (Debug) ----
router.post("/api/cache/invalidate", (_req: Request, res: Response) => {
  odoo.invalidateCaches();
  res.json({ message: "Cache invalidated", cacheStats: odoo.getCacheStats() });
});

router.get("/api/cache/stats", (_req: Request, res: Response) => {
  res.json({ cacheStats: odoo.getCacheStats() });
});

// ---- Input Sanitization ----
function sanitizeString(str: string): string {
  if (typeof str !== 'string') return str;
  return str.trim().replace(/[<>]/g, ''); // Basic XSS prevention
}

function sanitizeBody(body: any): any {
  if (typeof body !== 'object' || body === null) return body;
  
  const sanitized = { ...body };
  for (const key of Object.keys(sanitized)) {
    if (typeof sanitized[key] === 'string') {
      sanitized[key] = sanitizeString(sanitized[key]);
    } else if (Array.isArray(sanitized[key])) {
      sanitized[key] = sanitized[key].map((item: any) => 
        typeof item === 'object' ? sanitizeBody(item) : 
        typeof item === 'string' ? sanitizeString(item) : item
      );
    }
  }
  return sanitized;
}

// ---- Auth Middleware ----
function requireAuth(req: Request, res: Response, next: Function) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: "No autorizado" });
  }
  // Simple token check - in production use JWT
  const userEmail = req.headers['x-user-email'] as string;
  if (!userEmail) {
    return res.status(401).json({ error: "No autorizado" });
  }
  (req as any).userEmail = userEmail;
  
  // Sanitize input
  req.body = sanitizeBody(req.body);
  
  next();
}

// Temporary endpoint to add indexes (remove after use)
router.post("/api/admin/add-indexes", requireAuth, async (_req: Request, res: Response) => {
  try {
    const indexes = [
      "CREATE INDEX IF NOT EXISTS idx_cuadres_fecha ON cuadres(fecha DESC)",
      "CREATE INDEX IF NOT EXISTS idx_cuadres_caja ON cuadres(caja)",
      "CREATE INDEX IF NOT EXISTS idx_cuadres_estado ON cuadres(estado)",
      "CREATE INDEX IF NOT EXISTS idx_cuadres_session_id ON cuadres(session_id)",
      "CREATE INDEX IF NOT EXISTS idx_metodos_cuadre_id ON metodos_verificados(cuadre_id)",
      "CREATE INDEX IF NOT EXISTS idx_deducciones_cuadre_id ON deducciones(cuadre_id)",
      "CREATE INDEX IF NOT EXISTS idx_ajustes_cuadre_id ON ajustes_manuales(cuadre_id)",
      "CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email)"
    ];
    
    for (const sql of indexes) {
      await pool.query(sql);
    }
    
    res.json({ success: true, message: "Indexes created" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ---- Auth ----
router.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      const errors = parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`);
      return res.status(400).json({ error: "Datos inválidos", details: errors });
    }

    const user = await db.getUserByEmail(parsed.data.email);
    if (!user) return res.status(401).json({ error: "Email o contraseña incorrectos" });
    
    const passwordMatch = user.password.startsWith("$2")
      ? await bcrypt.compare(parsed.data.password, user.password)
      : user.password === parsed.data.password;
    if (!passwordMatch) {
      return res.status(401).json({ error: "Email o contraseña incorrectos" });
    }
    
    // Auto-upgrade plaintext passwords to bcrypt
    if (!user.password.startsWith("$2")) {
      await db.updateUser(user.id, { password: parsed.data.password });
    }
    
    if (!user.activo) return res.status(403).json({ error: "Su cuenta está desactivada. Contacte al administrador" });

    const { password, ...safeUser } = user;
    res.json(safeUser);
  } catch (err: any) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Error interno del servidor. Intente más tarde" });
  }
});

// Cambio de contraseña
router.post("/api/auth/change-password", async (req: Request, res: Response) => {
  try {
    const { email, passwordActual, passwordNueva } = req.body;
    if (!email || !passwordActual || !passwordNueva) {
      return res.status(400).json({ error: "Todos los campos son requeridos" });
    }
    if (passwordNueva.length < 4) {
      return res.status(400).json({ error: "La contraseña nueva debe tener al menos 4 caracteres" });
    }
    const user = await db.getUserByEmail(email);
    if (!user) return res.status(401).json({ error: "Contraseña actual incorrecta" });
    const currentMatch = user.password.startsWith("$2")
      ? await bcrypt.compare(passwordActual, user.password)
      : user.password === passwordActual;
    if (!currentMatch) {
      return res.status(401).json({ error: "Contraseña actual incorrecta" });
    }
    await db.updateUser(user.id, { password: passwordNueva });
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ---- Odoo Endpoints ----
router.get("/api/odoo/rate", requireAuth, async (req: Request, res: Response) => {
  try {
    const date = query(req, "date") || new Date().toISOString().split("T")[0];
    const rate = await odoo.getDayRate(date);
    res.json({ date, rate });
  } catch (err: any) {
    console.error("Rate error:", err);
    res.status(500).json({ error: "Error al obtener tasa", details: err?.message });
  }
});

router.get("/api/odoo/sessions", requireAuth, async (req: Request, res: Response) => {
  try {
    const date = query(req, "date") || new Date().toISOString().split("T")[0];
    const [sessions, cuadres] = await Promise.all([
      odoo.getSessions(date),
      db.getCuadres({ fecha: date })
    ]);
    
    const cuadreMap = new Map<number, any>();
    const cuadreNFMap = new Map<number, any>();
    for (const c of cuadres) {
      if (c.tipo === "nf") {
        cuadreNFMap.set(c.sessionId, c);
      } else {
        cuadreMap.set(c.sessionId, c);
      }
    }
    res.json(sessions.map((s: any) => ({
      ...s,
      cuadre: cuadreMap.get(s.id) || null,
      cuadreNF: cuadreNFMap.get(s.id) || null,
    })));
  } catch (err) {
    res.status(500).json({ error: "Error al obtener sesiones" });
  }
});

router.get("/api/odoo/session/:id/fiscal-summary", requireAuth, async (req: Request, res: Response) => {
  try {
    const summary = await odoo.getFiscalSummary(Number(param(req, "id")));
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: "Error al obtener resumen fiscal", details: err?.message });
  }
});

// Nota: Asegúrate de que odoo.ts exporte estas funciones
router.get("/api/odoo/session/:id/retentions", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await odoo.getSessionRetentions(Number(param(req, "id")));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Error en retenciones" });
  }
});

router.get("/api/odoo/session/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const session = await odoo.getSessionById(Number(param(req, "id")));
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });
    res.json(session);
  } catch (err: any) {
    console.error("Session error:", err);
    res.status(500).json({ error: "Error al obtener sesión", details: err?.message });
  }
});

router.get("/api/odoo/session/:id/credit-sales", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await odoo.getCreditSales(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    console.error("Credit sales error:", err);
    res.status(500).json({ error: "Error en ventas a crédito", details: err?.message });
  }
});

router.get("/api/odoo/session/:id/saldo-favor", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await odoo.getSaldoFavorDetail(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    console.error("Saldo favor error:", err);
    res.status(500).json({ error: "Error en saldo a favor", details: err?.message });
  }
});

router.get("/api/odoo/session/:id/non-fiscal", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await odoo.getNonFiscalSummary(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    console.error("Non-fiscal error:", err);
    res.status(500).json({ error: "Error en resumen no fiscal", details: err?.message });
  }
});

// ---- Cuadres CRUD ----
router.get("/api/cuadres", requireAuth, async (req: Request, res: Response) => {
  try {
    const filters = {
      fecha: query(req, "fecha"),
      caja: query(req, "caja"),
      estado: query(req, "estado"),
      cerrado: query(req, "cerrado")
    };
    const page = parseInt(query(req, "page") || "1");
    const limit = parseInt(query(req, "limit") || "50");
    const data = await db.getCuadres(filters, page, limit);
    res.json(data);
  } catch (err: any) {
    console.error("Error getting cuadres:", err);
    res.status(500).json({ error: "No se pudieron cargar los cuadres. Intente más tarde" });
  }
});

router.get("/api/cuadres/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const cuadre = await db.getCuadreById(id);
    if (!cuadre) return res.status(404).json({ error: "Cuadre no encontrado" });

    // Get serial machine from Odoo session
    let serialMachine = "";
    try {
      const session = await odoo.getSessionById(cuadre.sessionId);
      serialMachine = session?.serial_machine || "";
    } catch (e) {
      console.warn("Fallo al obtener session para serial:", id);
    }

    // Hidratación de datos desde Odoo (Opcional/Resiliente)
    let extraData: {
      creditSales: CreditSaleRow[];
      saldosFavor: never[];
      retenciones: RetentionRow[];
      fiscalSummary: FiscalSummary | null;
    } = { creditSales: [], saldosFavor: [], retenciones: [], fiscalSummary: null };
    try {
      const [credit, ret, fiscal] = await Promise.all([
        odoo.getCreditSales(cuadre.sessionId),
        odoo.getSessionRetentions(cuadre.sessionId),
        odoo.getFiscalSummary(cuadre.sessionId)
      ]);
      extraData = { creditSales: credit, saldosFavor: [], retenciones: ret, fiscalSummary: fiscal };
    } catch (e) {
      console.warn("Fallo hidratación de Odoo para cuadre:", id);
    }

    res.json({ ...cuadre, serialMachine, ...extraData });
  } catch (err) {
    res.status(500).json({ error: "Error al obtener detalle de cuadre" });
  }
});

router.post("/api/cuadres", requireAuth, async (req: Request, res: Response) => {
  // Fast fix: coerce numeric strings to numbers
  const body = req.body;
  const numFields = [
    'tasaDia', 'ventaBrutaZ', 'notasCreditoZ', 'ventaNetaZ', 'baseImponibleZ',
    'exentoZ', 'ivaZ', 'igtfZ', 'totalOdooUSD', 'totalOdooBs', 'difCambiaria',
    'totalRetencionesPOS', 'totalRetencionesReal', 'retencionesPorCobrar',
    'totalCreditoPOS', 'totalAbonosReal', 'totalCxCPendiente',
    'totalSaldoFavorPOS', 'totalSaldoFavorReal', 'totalAjustesManuales',
    'totalMetodosPOS', 'totalJustificadoReal', 'totalDirectoPOS'
  ];
  numFields.forEach(f => { if (body[f] !== undefined && typeof body[f] === 'string') body[f] = Number(body[f]); });
  if (body.metodos) body.metodos.forEach((m: any) => {
    ['metodoId', 'montoPOS_USD', 'montoPOS_Bs', 'montoReal'].forEach(f => {
      if (m[f] !== undefined && typeof m[f] === 'string') m[f] = Number(m[f]);
    });
  });
  if (body.deducciones) body.deducciones.forEach((d: any) => {
    if (d.monto !== undefined && typeof d.monto === 'string') d.monto = Number(d.monto);
  });
  if (body.ajustesManuales) body.ajustesManuales.forEach((a: any) => {
    if (a.monto !== undefined && typeof a.monto === 'string') a.monto = Number(a.monto);
  });

  try {
    const parsed = createCuadreSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Validation error details:", parsed.error.issues);
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
    }

    const existing = await db.getCuadreBySessionId(parsed.data.sessionId, "fiscal");
    if (existing) return res.status(409).json({ error: "Ya existe un cuadre fiscal para esta sesión", cuadreId: existing.id });

    const newCuadre = await db.createCuadre(parsed.data);
    res.status(201).json(newCuadre);
  } catch (err) {
    res.status(500).json({ error: "Error al crear cuadre" });
  }
});

router.put("/api/cuadres/:id", requireAuth, async (req: Request, res: Response) => {
  // Fast fix: coerce numeric strings to numbers
  const body = req.body;
  const numFields = [
    'tasaDia', 'ventaBrutaZ', 'notasCreditoZ', 'ventaNetaZ', 'baseImponibleZ',
    'exentoZ', 'ivaZ', 'igtfZ', 'totalOdooUSD', 'totalOdooBs', 'difCambiaria',
    'totalRetencionesPOS', 'totalRetencionesReal', 'retencionesPorCobrar',
    'totalCreditoPOS', 'totalAbonosReal', 'totalCxCPendiente',
    'totalSaldoFavorPOS', 'totalSaldoFavorReal', 'totalAjustesManuales',
    'totalMetodosPOS', 'totalJustificadoReal', 'totalDirectoPOS'
  ];
  numFields.forEach(f => { if (body[f] !== undefined && typeof body[f] === 'string') body[f] = Number(body[f]); });
  if (body.metodos) body.metodos.forEach((m: any) => {
    ['metodoId', 'montoPOS_USD', 'montoPOS_Bs', 'montoReal'].forEach(f => {
      if (m[f] !== undefined && typeof m[f] === 'string') m[f] = Number(m[f]);
    });
  });
  if (body.deducciones) body.deducciones.forEach((d: any) => {
    if (d.monto !== undefined && typeof d.monto === 'string') d.monto = Number(d.monto);
  });
  if (body.ajustesManuales) body.ajustesManuales.forEach((a: any) => {
    if (a.monto !== undefined && typeof a.monto === 'string') a.monto = Number(a.monto);
  });

  try {
    const parsed = createCuadreSchema.safeParse(body);
    if (!parsed.success) {
      console.error("Validation error details:", parsed.error.issues);
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.issues });
    }

    // Preserve observacionesNF from existing cuadre if not sent
    const existing = await db.getCuadreById(param(req, "id"));
    if (!existing) return res.status(404).json({ error: "Cuadre no encontrado" });
    const data = { ...parsed.data, observacionesNF: existing.observacionesNF || "", tipo: existing.tipo || "fiscal" };

    console.log("Saving cuadre - observaciones:", data.observaciones?.substring(0, 30), "observacionesNF:", data.observacionesNF?.substring(0, 30), "notasCreditoZ:", data.notasCreditoZ, "primeraNCZ:", data.primeraNCZ, "ultimaNCZ:", data.ultimaNCZ);

    const updated = await db.updateCuadre(param(req, "id"), data);
    if (!updated) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(updated);
  } catch (err: any) {
    console.error("Update error:", err.message || err);
    res.status(500).json({ error: "Error al actualizar", details: err.message });
  }
});

router.delete("/api/cuadres/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const deleted = await db.deleteCuadre(param(req, "id"));
    if (!deleted) return res.status(404).json({ error: "El cuadre no existe o ya fue eliminado" });
    res.json({ success: true, message: "Cuadre eliminado correctamente" });
  } catch (err: any) {
    console.error("Delete error:", err);
    res.status(500).json({ error: "No se pudo eliminar el cuadre. Intente más tarde" });
  }
});

router.patch("/api/cuadres/:id/estado", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { estado } = req.body as { estado: "cuadrado" | "pendiente" | "descuadrado" };
    if (!estado || !["cuadrado", "pendiente", "descuadrado"].includes(estado)) {
      return res.status(400).json({ error: "Estado inválido" });
    }
    console.log(`[PATCH /cuadres/:id/estado] id=${id} estado=${estado}`);
    const updated = await db.updateCuadreEstado(id, estado);
    if (!updated) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(updated);
  } catch (err: any) {
    console.error("[PATCH estado] Error:", err.message);
    res.status(500).json({ error: "Error al actualizar estado", details: err.message });
  }
});

router.post("/api/cuadres/:id/recalculate", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    console.log(`[POST /cuadres/:id/recalculate] id=${id}`);
    const updated = await db.recalculateCuadreEstado(id);
    if (!updated) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(updated);
  } catch (err: any) {
    console.error("[POST recalculate] Error:", err.message);
    res.status(500).json({ error: "Error al recalcular estado", details: err.message });
  }
});

// ---- NF Cuadres ----
router.post("/api/cuadres/nf/:sessionId", requireAuth, async (req: Request, res: Response) => {
  try {
    const sessionId = Number(param(req, "sessionId"));
    const { metodos, observacionesNF, ajustesManuales } = req.body;

    console.log("[NF POST] sessionId:", sessionId, "metodos:", metodos?.length, "observacionesNF:", observacionesNF, "ajustes:", ajustesManuales?.length);

    // Check if NF cuadre already exists for this session
    const existing = await db.getCuadreBySessionId(sessionId, "nf");
    if (existing) {
      // Update existing NF cuadre
      console.log("[NF POST] Updating existing NF cuadre:", existing.id);
      const merged = {
        ...existing,
        sessionId: existing.sessionId,
        sessionName: existing.sessionName,
        fecha: existing.fecha,
        caja: existing.caja,
        cajero: existing.cajero,
        maquinaFiscal: existing.maquinaFiscal,
        tipo: "nf" as const,
        metodos: metodos || [],
        observacionesNF: observacionesNF ?? existing.observacionesNF ?? "",
        ajustesManuales: ajustesManuales || [],
        deducciones: [],
      } as any;
      const updated = await db.updateCuadre(existing.id, merged);
      return res.json(updated);
    }

    // Create new NF cuadre
    const session = await odoo.getSessionById(sessionId);
    const fecha = session?.start_at?.split(" ")[0] || new Date().toISOString().split("T")[0];

    console.log("[NF POST] Creating new NF cuadre, session:", session);

    const newCuadre = await db.createCuadre({
      sessionId,
      sessionName: session?.name || "",
      fecha,
      caja: session?.config_id?.[1] || "",
      cajero: session?.user_id?.[1] || "",
      maquinaFiscal: session?.serial_machine || "",
      tipo: "nf",
      tasaDia: 0,
      zNumero: "",
      ventaBrutaZ: 0,
      notasCreditoZ: 0,
      ventaNetaZ: 0,
      baseImponibleZ: 0,
      exentoZ: 0,
      ivaZ: 0,
      igtfZ: 0,
      primeraFacturaZ: "",
      ultimaFacturaZ: "",
      primeraNCZ: "",
      ultimaNCZ: "",
      totalOdooUSD: 0,
      totalOdooBs: 0,
      difCambiaria: 0,
      metodos: metodos || [],
      observaciones: "",
      observacionesNF: observacionesNF || "",
      ajustesManuales: ajustesManuales || [],
      // Optional fields with defaults
      totalRetencionesPOS: 0,
      totalRetencionesReal: 0,
      retencionesPorCobrar: 0,
      totalCreditoPOS: 0,
      totalAbonosReal: 0,
      totalCxCPendiente: 0,
      totalSaldoFavorPOS: 0,
      totalSaldoFavorReal: 0,
      totalAjustesManuales: 0,
      totalMetodosPOS: 0,
      totalJustificadoReal: 0,
      totalDirectoPOS: 0,
    } as any);
    res.status(201).json(newCuadre);
  } catch (err: any) {
    console.error("[NF POST] Error:", err.message);
    res.status(500).json({ error: "Error al guardar cuadre NF", details: err?.message });
  }
});

router.put("/api/cuadres/nf/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { metodos, observacionesNF, ajustesManuales } = req.body;

    console.log("[NF PUT] id:", id, "metodos:", metodos?.length, "ajustes:", ajustesManuales?.length);

    const existing = await db.getCuadreById(id);
    if (!existing) return res.status(404).json({ error: "Cuadre no encontrado" });

    const merged = {
      ...existing,
      sessionId: existing.sessionId,
      sessionName: existing.sessionName,
      fecha: existing.fecha,
      caja: existing.caja,
      cajero: existing.cajero,
      maquinaFiscal: existing.maquinaFiscal,
      zNumero: existing.zNumero,
      ventaBrutaZ: existing.ventaBrutaZ,
      notasCreditoZ: existing.notasCreditoZ,
      baseImponibleZ: existing.baseImponibleZ,
      exentoZ: existing.exentoZ,
      ivaZ: existing.ivaZ,
      igtfZ: existing.igtfZ,
      primeraFacturaZ: existing.primeraFacturaZ,
      ultimaFacturaZ: existing.ultimaFacturaZ,
      primeraNCZ: existing.primeraNCZ || "",
      ultimaNCZ: existing.ultimaNCZ || "",
      tasaDia: existing.tasaDia,
      totalOdooUSD: existing.totalOdooUSD,
      totalOdooBs: existing.totalOdooBs,
      difCambiaria: existing.difCambiaria,
      metodos: metodos || [],
      observaciones: existing.observaciones ?? "",
      observacionesNF: observacionesNF ?? existing.observacionesNF ?? "",
      ajustesManuales: ajustesManuales || [],
      totalRetencionesPOS: existing.totalRetencionesPOS,
      totalRetencionesReal: existing.totalRetencionesReal,
      retencionesPorCobrar: existing.retencionesPorCobrar,
      totalCreditoPOS: existing.totalCreditoPOS,
      totalAbonosReal: existing.totalAbonosReal,
      totalCxCPendiente: existing.totalCxCPendiente,
      totalSaldoFavorPOS: existing.totalSaldoFavorPOS,
      totalSaldoFavorReal: existing.totalSaldoFavorReal,
      totalMetodosPOS: existing.totalMetodosPOS,
      totalJustificadoReal: existing.totalJustificadoReal,
      totalDirectoPOS: existing.totalDirectoPOS,
      deducciones: [],
      tipo: "nf" as const,
    } as any;

    const updated = await db.updateCuadre(id, merged);
    if (!updated) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(updated);
  } catch (err: any) {
    console.error("[NF PUT] Error:", err.message);
    res.status(500).json({ error: "Error al actualizar cuadre NF", details: err?.message });
  }
});

router.post("/api/cuadres/:id/close", requireAuth, async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { cerradoPor } = req.body;
    const closed = await db.closeCuadre(id, cerradoPor);
    if (!closed) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(closed);
  } catch (err: any) {
    res.status(500).json({ error: "Error al cerrar sesión", details: err?.message });
  }
});

router.post("/api/cuadres/:id/reopen", requireAuth, async (req: Request, res: Response) => {
  try {
    const reopened = await db.reopenCuadre(param(req, "id"));
    if (!reopened) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(reopened);
  } catch (err) {
    res.status(500).json({ error: "Error al reabrir cuadre" });
  }
});

// ---- Users ----
router.get("/api/users", requireAuth, async (_req: Request, res: Response) => {
  try {
    const users = await db.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});

// ---- CxC/CxP ----
const cuentasStore: Map<string, any> = new Map();
const abonosStore: Map<string, any[]> = new Map();

// =============================================================================
// CONCILIACIÓN DE PAGOS DIFERIDOS
// =============================================================================
router.get("/api/conciliacion/pagos-diferidos", requireAuth, async (req: Request, res: Response) => {
  try {
    const fechaDesde    = query(req, "fechaDesde");
    const fechaHasta    = query(req, "fechaHasta");
    const usuario       = query(req, "usuario");
    const banco         = query(req, "banco");
    const metodoPOS     = query(req, "metodoPOS");
    const soloDestiempo = query(req, "soloDestiempo") === "1";

    const pagos = await odoo.getConciliacionPagosDiferidos(
      fechaDesde, fechaHasta, usuario, banco, metodoPOS, soloDestiempo
    );

    // Totales globales
    const totalPagosUSD   = Math.round(pagos.reduce((s: number, p: any) => s + p.montoPagoUSD, 0) * 100) / 100;
    const totalPagosBs    = Math.round(pagos.reduce((s: number, p: any) => s + p.montoPagoBs,  0) * 100) / 100;
    const totalSaldoUSD   = Math.round(pagos.reduce((s: number, p: any) => s + p.saldoFacturaUSD, 0) * 100) / 100;
    const totalSaldoBs    = Math.round(pagos.reduce((s: number, p: any) => s + p.saldoFacturaBs,  0) * 100) / 100;

    // Totales por tipo
    const porTipo: Record<string, { cantidad: number; totalUSD: number; totalBs: number }> = {};
    for (const p of pagos) {
      if (!porTipo[p.tipoDiferimiento]) porTipo[p.tipoDiferimiento] = { cantidad: 0, totalUSD: 0, totalBs: 0 };
      porTipo[p.tipoDiferimiento].cantidad++;
      porTipo[p.tipoDiferimiento].totalUSD += p.montoPagoUSD;
      porTipo[p.tipoDiferimiento].totalBs  += p.montoPagoBs;
    }
    for (const k of Object.keys(porTipo)) {
      porTipo[k].totalUSD = Math.round(porTipo[k].totalUSD * 100) / 100;
      porTipo[k].totalBs  = Math.round(porTipo[k].totalBs  * 100) / 100;
    }

    res.json({
      pagos,
      cantidad: pagos.length,
      totalPagosUSD, totalPagosBs,
      totalSaldoUSD, totalSaldoBs,
      porTipo,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Nuevo endpoint principal: lista de facturas CxC y CxP con filtros y Bs
router.get("/api/cuentas/facturas", requireAuth, async (req: Request, res: Response) => {
  try {
    const tipo = query(req, "tipo") || "cxc"; // "cxc" | "cxp"
    const fechaDesde = query(req, "fechaDesde");
    const fechaHasta = query(req, "fechaHasta");
    const diario = query(req, "diario");   // FAC01, FAC02, FAC4
    const banco = query(req, "banco");
    const estado = query(req, "estado");   // "pendiente" | "pagado" | undefined = todos

    let facturas: any[];
    if (tipo === "cxp") {
      facturas = await odoo.getCxPFacturas(fechaDesde, fechaHasta, banco);
    } else {
      facturas = await odoo.getCxCFacturas(fechaDesde, fechaHasta, diario, banco);
    }

    // Filtro por estado
    if (estado && estado !== "todos") {
      facturas = facturas.filter(f => f.estado === estado);
    }

    const totalUSD = facturas.reduce((s, f) => s + (f.montoUSD || 0), 0);
    const saldoUSD = facturas.reduce((s, f) => s + (f.saldoUSD || 0), 0);
    const totalBs  = facturas.reduce((s, f) => s + (f.montoBs  || 0), 0);
    const saldoBs  = facturas.reduce((s, f) => s + (f.saldoBs  || 0), 0);

    res.json({ facturas, totalUSD, saldoUSD, totalBs, saldoBs, cantidad: facturas.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/cuentas/balance", requireAuth, async (req: Request, res: Response) => {
  try {
    const fechaDesde = query(req, "fechaDesde");
    const fechaHasta = query(req, "fechaHasta");
    const [cxc, cxp] = await Promise.all([
      odoo.getCxCFacturas(fechaDesde, fechaHasta),
      odoo.getCxPFacturas(fechaDesde, fechaHasta)
    ]);

    const calcTotals = (list: any[]) => ({
      cantidad: list.length,
      totalUSD: Math.round(list.reduce((s, f) => s + f.montoUSD, 0) * 100) / 100,
      saldoUSD: Math.round(list.reduce((s, f) => s + f.saldoUSD, 0) * 100) / 100,
      totalBs:  Math.round(list.reduce((s, f) => s + f.montoBs,  0) * 100) / 100,
      saldoBs:  Math.round(list.reduce((s, f) => s + f.saldoBs,  0) * 100) / 100,
      pendiente: list.filter(f => f.estado === "pendiente").length,
      pagado:    list.filter(f => f.estado === "pagado").length,
    });

    res.json({ cxc: calcTotals(cxc), cxp: calcTotals(cxp) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/cuentas/pagos-credito", requireAuth, async (req: Request, res: Response) => {
  try {
    const fechaDesde = query(req, "fechaDesde");
    const fechaHasta = query(req, "fechaHasta");
    const usuario = query(req, "usuario");
    const metodoPago = query(req, "metodoPago");
    const metodoPOS = query(req, "metodoPOS");
    const soloDestiempo = query(req, "soloDestiempo") === "1";

    let pagos = await odoo.getPagosCreditoPOS(fechaDesde, fechaHasta, usuario, metodoPago, metodoPOS);

    // Filtro: solo pagos a destiempo (pago != fecha factura)
    if (soloDestiempo) {
      pagos = pagos.filter((p: any) => !p.mismodia);
    }

    const totalFacturasUSD = Math.round(pagos.reduce((s: number, p: any) => s + p.montoFacturaUSD, 0) * 100) / 100;
    const totalFacturasBs  = Math.round(pagos.reduce((s: number, p: any) => s + p.montoFacturaBs,  0) * 100) / 100;
    const totalPagosUSD    = Math.round(pagos.reduce((s: number, p: any) => s + p.montoPagoUSD,    0) * 100) / 100;
    const totalPagosBs     = Math.round(pagos.reduce((s: number, p: any) => s + p.montoPagoBs,     0) * 100) / 100;
    const totalSaldoUSD    = Math.round(pagos.reduce((s: number, p: any) => s + p.saldoFacturaUSD, 0) * 100) / 100;
    const totalSaldoBs     = Math.round(pagos.reduce((s: number, p: any) => s + p.saldoFacturaBs,  0) * 100) / 100;
    const cantidadDestiempo = pagos.filter((p: any) => !p.mismodia).length;
    const cantidadMismodia  = pagos.filter((p: any) => p.mismodia).length;

    res.json({
      pagos, cantidad: pagos.length,
      cantidadDestiempo, cantidadMismodia,
      totalFacturasUSD, totalFacturasBs,
      totalPagosUSD, totalPagosBs,
      totalSaldoUSD, totalSaldoBs,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/cuentas/destiempo", requireAuth, async (req: Request, res: Response) => {
  try {
    const fechaDesde = query(req, "fechaDesde");
    const fechaHasta = query(req, "fechaHasta");
    const diario = query(req, "diario");
    const usuario = query(req, "usuario");
    const pagos = await odoo.getPagosDestiempo(fechaDesde, fechaHasta, diario, usuario);
    const totalUSD = Math.round(pagos.reduce((s, p) => s + p.montoUSD, 0) * 100) / 100;
    const totalBs  = Math.round(pagos.reduce((s, p) => s + p.montoBs,  0) * 100) / 100;
    res.json({ pagos, totalUSD, totalBs, cantidad: pagos.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Endpoint para obtener listas de filtros dinámicos
router.get("/api/cuentas/filtros", requireAuth, async (_req: Request, res: Response) => {
  try {
    const [metodosPOS, bancos] = await Promise.all([
      odoo.getMetodosPOS(),
      odoo.getBancosDisponibles(),
    ]);
    res.json({ metodosPOS, bancos });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: credit sales with raw Odoo payment data
router.get("/api/debug/credit-sales/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const data = await odoo.getCreditSalesDebug(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: raw account.payment data for a specific reference
router.get("/api/debug/pagos-ref", async (req: Request, res: Response) => {
  try {
    const ref = query(req, "ref") || "";
    const date = query(req, "date") || "";
    if (!ref) return res.status(400).json({ error: "ref is required" });
    // Search account.payment by ref
    const payments = await odoo.debugPaymentsByRef(ref, date);
    res.json(payments);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Debug endpoint: inspeccionar un pago específico por nombre
router.get("/api/debug/pago", requireAuth, async (req: Request, res: Response) => {
  try {
    const nombre = query(req, "nombre") || "BANBS/2026/0832";
    const pago = await odoo.debugPago(nombre);
    res.json(pago);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/cuentas/movimientos", requireAuth, async (req: Request, res: Response) => {
  try {
    const tipo = query(req, "tipo") || "cxc";
    const fechaDesde = query(req, "fechaDesde");
    const fechaHasta = query(req, "fechaHasta");

    const movimientos = await odoo.getMovimientosCuentas(tipo, fechaDesde, fechaHasta);
    res.json(movimientos);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/cuentas/abonos", requireAuth, async (req: Request, res: Response) => {
  try {
    const { cuentaId, monto, fecha, notas } = req.body;
    if (!cuentaId || !monto || !fecha) {
      return res.status(400).json({ error: "Faltan datos requeridos" });
    }

    const abono = {
      id: crypto.randomUUID(),
      cuentaId,
      monto,
      fecha,
      notas: notas || "",
      createdAt: new Date().toISOString()
    };

    const existentes = abonosStore.get(cuentaId) || [];
    existentes.push(abono);
    abonosStore.set(cuentaId, existentes);

    res.json({ success: true, abono });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/cuentas/conciliacion", requireAuth, async (_req: Request, res: Response) => {
  try {
    const conciliacion = await odoo.getConciliacionBancaria();
    res.json(conciliacion);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


