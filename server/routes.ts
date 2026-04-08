import { Router, type Request, type Response } from "express";
import * as odoo from "./odoo.js";
import * as sheets from "./sheets.js";
import { createCuadreSchema, loginSchema, CreditSaleRow, RetentionRow, FiscalSummary } from "../shared/schema.js";

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
router.get("/api/health", (_req: Request, res: Response) => {
  const hasSheetId = !!process.env.CUADRECAJA_SPREADSHEET_ID;
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON || "";
  const hasOdoo = !!process.env.ODOO_URL && !!process.env.ODOO_USERNAME;
  const odooConfig = {
    url: process.env.ODOO_URL || "",
    db: process.env.ODOO_DB || "",
    username: process.env.ODOO_USERNAME || "",
    hasPassword: !!process.env.ODOO_PASSWORD
  };

  let googleJsonValid = false;
  let parseError = "none";

  try {
    if (raw) {
      const parsed = JSON.parse(raw);
      googleJsonValid = !!parsed.client_email && !!parsed.private_key;
    }
  } catch (e: any) {
    parseError = e.message;
  }

  res.json({
    status: "running",
    env: {
      sheets: hasSheetId,
      googleAuth: googleJsonValid,
      odoo: hasOdoo
    },
    odooConfig,
    parseError,
    cacheStats: odoo.getCacheStats(),
  });
});

// ---- Cache Management (Debug) ----
router.post("/api/cache/invalidate", (_req: Request, res: Response) => {
  odoo.invalidateCaches();
  res.json({ message: "Cache invalidated", cacheStats: odoo.getCacheStats() });
});

router.get("/api/cache/stats", (_req: Request, res: Response) => {
  res.json({ cacheStats: odoo.getCacheStats() });
});

// ---- Auth ----
router.post("/api/auth/login", async (req: Request, res: Response) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos requeridos" });

    const user = await sheets.getUserByEmail(parsed.data.email);
    if (!user || user.password !== parsed.data.password) {
      return res.status(401).json({ error: "Credenciales inválidas" });
    }
    if (!user.activo) return res.status(403).json({ error: "Usuario desactivado" });

    const { password, ...safeUser } = user;
    res.json(safeUser);
  } catch (err: any) {
    res.status(500).json({ error: "Error en login", details: err?.message });
  }
});

// ---- Odoo Endpoints ----
router.get("/api/odoo/rate", async (req: Request, res: Response) => {
  try {
    const date = query(req, "date") || new Date().toISOString().split("T")[0];
    const rate = await odoo.getDayRate(date);
    res.json({ date, rate });
  } catch (err: any) {
    console.error("Rate error:", err);
    res.status(500).json({ error: "Error al obtener tasa", details: err?.message });
  }
});

router.get("/api/odoo/sessions", async (req: Request, res: Response) => {
  try {
    const date = query(req, "date") || new Date().toISOString().split("T")[0];
    const [sessions, cuadres] = await Promise.all([
      odoo.getSessions(date),
      sheets.getCuadres({ fecha: date })
    ]);
    
    const cuadreMap = new Map(cuadres.map(c => [c.sessionId, c]));
    res.json(sessions.map((s: any) => ({
      ...s,
      cuadre: cuadreMap.get(s.id) || null
    })));
  } catch (err) {
    res.status(500).json({ error: "Error al obtener sesiones" });
  }
});

router.get("/api/odoo/session/:id/fiscal-summary", async (req: Request, res: Response) => {
  try {
    const summary = await odoo.getFiscalSummary(Number(param(req, "id")));
    res.json(summary);
  } catch (err: any) {
    res.status(500).json({ error: "Error al obtener resumen fiscal", details: err?.message });
  }
});

// Nota: Asegúrate de que odoo.ts exporte estas funciones
router.get("/api/odoo/session/:id/retentions", async (req: Request, res: Response) => {
  try {
    const data = await odoo.getSessionRetentions(Number(param(req, "id")));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Error en retenciones" });
  }
});

router.get("/api/odoo/session/:id", async (req: Request, res: Response) => {
  try {
    const session = await odoo.getSessionById(Number(param(req, "id")));
    if (!session) return res.status(404).json({ error: "Sesión no encontrada" });
    res.json(session);
  } catch (err: any) {
    console.error("Session error:", err);
    res.status(500).json({ error: "Error al obtener sesión", details: err?.message });
  }
});

router.get("/api/odoo/session/:id/credit-sales", async (req: Request, res: Response) => {
  try {
    const data = await odoo.getCreditSales(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    console.error("Credit sales error:", err);
    res.status(500).json({ error: "Error en ventas a crédito", details: err?.message });
  }
});

router.get("/api/odoo/session/:id/saldo-favor", async (req: Request, res: Response) => {
  try {
    const data = await odoo.getSaldoFavorDetail(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    console.error("Saldo favor error:", err);
    res.status(500).json({ error: "Error en saldo a favor", details: err?.message });
  }
});

router.get("/api/odoo/session/:id/non-fiscal", async (req: Request, res: Response) => {
  try {
    const data = await odoo.getNonFiscalSummary(Number(param(req, "id")));
    res.json(data);
  } catch (err: any) {
    console.error("Non-fiscal error:", err);
    res.status(500).json({ error: "Error en resumen no fiscal", details: err?.message });
  }
});

// ---- Cuadres CRUD ----
router.get("/api/cuadres", async (req: Request, res: Response) => {
  try {
    const filters = {
      fecha: query(req, "fecha"),
      caja: query(req, "caja"),
      estado: query(req, "estado"),
      cerrado: query(req, "cerrado")
    };
    const data = await sheets.getCuadres(filters);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener cuadres" });
  }
});

router.get("/api/cuadres/:id", async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const cuadre = await sheets.getCuadreById(id);
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

router.post("/api/cuadres", async (req: Request, res: Response) => {
  try {
    const parsed = createCuadreSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Datos inválidos" });

    const existing = await sheets.getCuadreBySessionId(parsed.data.sessionId);
    if (existing) return res.status(409).json({ error: "Ya existe un cuadre para esta sesión", cuadreId: existing.id });

    const newCuadre = await sheets.createCuadre(parsed.data);
    res.status(201).json(newCuadre);
  } catch (err) {
    res.status(500).json({ error: "Error al crear cuadre" });
  }
});

router.put("/api/cuadres/:id", async (req: Request, res: Response) => {
  try {
    const parsed = createCuadreSchema.safeParse(req.body);
    if (!parsed.success) {
      console.error("Validation error:", parsed.error);
      return res.status(400).json({ error: "Datos inválidos", details: parsed.error.message });
    }

    const updated = await sheets.updateCuadre(param(req, "id"), parsed.data);
    if (!updated) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(updated);
  } catch (err) {
    console.error("Update error:", err);
    res.status(500).json({ error: "Error al actualizar" });
  }
});

router.delete("/api/cuadres/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await sheets.deleteCuadre(param(req, "id"));
    if (!deleted) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Error al eliminar cuadre" });
  }
});

// ---- NF Cuadres ----
router.post("/api/cuadres/nf/:sessionId", async (req: Request, res: Response) => {
  try {
    const sessionId = Number(param(req, "sessionId"));
    const { metodos, observaciones } = req.body;

    // Check if cuadre exists for this session
    const existing = await sheets.getCuadreBySessionId(sessionId);
    if (existing) {
      // Update existing cuadre with NF data
      const updated = await sheets.updateCuadre(existing.id, {
        sessionId,
        metodos: metodos || [],
        observaciones: observaciones || "",
      });
      return res.json(updated);
    }

    // Create new cuadre with NF data
    const session = await odoo.getSessionById(sessionId);
    const fecha = session?.start_at?.split(" ")[0] || new Date().toISOString().split("T")[0];

    const newCuadre = await sheets.createCuadre({
      sessionId,
      fecha,
      metodos: metodos || [],
      observaciones: observaciones || "",
    });
    res.status(201).json(newCuadre);
  } catch (err: any) {
    res.status(500).json({ error: "Error al guardar cuadre NF", details: err?.message });
  }
});

router.put("/api/cuadres/nf/:id", async (req: Request, res: Response) => {
  try {
    const { metodos, observaciones } = req.body;

    const updated = await sheets.updateCuadre(param(req, "id"), {
      metodos: metodos || [],
      observaciones: observaciones || "",
    });
    if (!updated) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(updated);
  } catch (err: any) {
    res.status(500).json({ error: "Error al actualizar cuadre NF", details: err?.message });
  }
});

router.post("/api/cuadres/:id/close", async (req: Request, res: Response) => {
  try {
    const id = param(req, "id");
    const { cerradoPor } = req.body;
    const closed = await sheets.closeCuadre(id, cerradoPor);
    if (!closed) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(closed);
  } catch (err: any) {
    res.status(500).json({ error: "Error al cerrar sesión", details: err?.message });
  }
});

router.post("/api/cuadres/:id/reopen", async (req: Request, res: Response) => {
  try {
    const reopened = await sheets.reopenCuadre(param(req, "id"));
    if (!reopened) return res.status(404).json({ error: "Cuadre no encontrado" });
    res.json(reopened);
  } catch (err) {
    res.status(500).json({ error: "Error al reabrir cuadre" });
  }
});

// ---- Users ----
router.get("/api/users", async (_req: Request, res: Response) => {
  try {
    const users = await sheets.getUsers();
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: "Error al obtener usuarios" });
  }
});
