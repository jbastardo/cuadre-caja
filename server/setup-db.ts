/**
 * Setup script: Initialize PostgreSQL + migrate data from Google Sheets
 * 
 * Usage:
 *   npx tsx server/setup-db.ts
 * 
 * Requirements:
 *   - DATABASE_URL env var pointing to PostgreSQL
 *   - GOOGLE_SHEET_ID + GOOGLE_SERVICE_ACCOUNT_JSON for Sheets (optional, for migration)
 */

import "dotenv/config";
import * as db from "./db.js";
import * as sheets from "./sheets.js";
import { getMetodosByCuadre, getDeduccionesByCuadre, getAjustesByCuadre } from "./sheets.js";
import type { CreateCuadre } from "../shared/schema.js";

async function setup() {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Setup: PostgreSQL + Sheets Migration       ║");
  console.log("╚══════════════════════════════════════════════╝\n");

  // ─── Step 1: Test DB Connection ───────────────────────────────────────────
  console.log("[1/4] Testing PostgreSQL connection...");
  const dbOk = await db.testConnection();
  if (!dbOk) {
    console.error("❌ Cannot connect to PostgreSQL.");
    console.error("   Set DATABASE_URL in your .env or Railway variables.");
    process.exit(1);
  }
  console.log("✅ PostgreSQL connected.\n");

  // ─── Step 2: Apply Schema ─────────────────────────────────────────────────
  console.log("[2/4] Applying database schema...");
  const initResult = await db.initializeDb();
  console.log("   Schema:", initResult.initialized[0]);
  console.log("✅ Schema applied.\n");

  // ─── Step 3: Check Sheets ─────────────────────────────────────────────────
  console.log("[3/4] Checking Google Sheets access...");
  const hasSheetId = !!process.env.GOOGLE_SHEET_ID;
  const hasAuth = !!process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  
  if (!hasSheetId || !hasAuth) {
    console.log("⚠️  Sheets credentials not found. Skipping data migration.");
    console.log("   To migrate data, set:");
    console.log("   - GOOGLE_SHEET_ID");
    console.log("   - GOOGLE_SERVICE_ACCOUNT_JSON\n");
  } else {
    // ─── Step 4: Migrate Data ───────────────────────────────────────────────
    console.log("[4/4] Migrating data from Google Sheets...\n");

    // Users
    console.log("  ── Users ──");
    try {
      const sheetUsers = await sheets.getUsers();
      const dbUsers = await db.getUsers();
      const existingEmails = new Set(dbUsers.map(u => u.email));
      let migrated = 0;

      for (const u of sheetUsers) {
        if (!existingEmails.has(u.email)) {
          const fullUser = await sheets.getUserByEmail(u.email);
          if (fullUser) {
            await db.createUser({
              nombre: fullUser.nombre,
              email: fullUser.email,
              password: fullUser.password,
              rol: fullUser.rol,
              activo: fullUser.activo,
            });
            migrated++;
            console.log(`    ✓ ${u.nombre}`);
          }
        }
      }
      console.log(`  → ${migrated} users migrated\n`);
    } catch (err: any) {
      console.log(`  → Users error: ${err?.message || err}\n`);
    }

    // Cuadres
    console.log("  ── Cuadres ──");
    try {
      const sheetCuadres = await sheets.getCuadres();
      const dbCuadres = await db.getCuadres();
      const existingIds = new Set(dbCuadres.map(c => c.id));
      let migrated = 0;
      let errors = 0;

      for (const c of sheetCuadres) {
        if (existingIds.has(c.id)) continue;

        try {
          const metodos = await getMetodosByCuadre(c.id);
          const deducciones = await getDeduccionesByCuadre(c.id);
          const ajustesManuales = await getAjustesByCuadre(c.id);

          const createData: CreateCuadre = {
            fecha: c.fecha,
            caja: c.caja,
            maquinaFiscal: c.maquinaFiscal,
            sessionId: c.sessionId,
            sessionName: c.sessionName,
            cajero: c.cajero,
            zNumero: c.zNumero,
            ventaBrutaZ: c.ventaBrutaZ,
            notasCreditoZ: c.notasCreditoZ,
            ventaNetaZ: c.ventaNetaZ,
            baseImponibleZ: c.baseImponibleZ,
            exentoZ: c.exentoZ,
            ivaZ: c.ivaZ,
            igtfZ: c.igtfZ,
            primeraFacturaZ: c.primeraFacturaZ,
            ultimaFacturaZ: c.ultimaFacturaZ,
            primeraNCZ: c.primeraNCZ || "",
            ultimaNCZ: c.ultimaNCZ || "",
            tasaDia: c.tasaDia,
            totalOdooUSD: c.totalOdooUSD,
            totalOdooBs: c.totalOdooBs,
            difCambiaria: c.difCambiaria,
            metodos: metodos.map(m => ({
              metodoId: m.metodoId,
              metodoNombre: m.metodoNombre,
              montoPOS_USD: m.montoPOS_USD,
              montoPOS_Bs: m.montoPOS_Bs,
              montoReal: m.montoReal,
              montoReal_Bs: m.montoPOS_Bs,
              observacion: m.observacion,
            })),
            deducciones: deducciones.map(d => ({
              tipo: d.tipo,
              descripcion: d.descripcion,
              monto: d.monto,
              comprobante: d.comprobante,
            })),
            ajustesManuales: ajustesManuales.map(a => ({
              tipo: a.tipo,
              descripcion: a.descripcion,
              monto: a.monto,
              referencia: a.referencia,
            })),
            observaciones: c.observaciones,
            observacionesNF: c.observacionesNF || "",
            tipo: c.tipo || "fiscal",
            totalRetencionesPOS: c.totalRetencionesPOS || 0,
            totalRetencionesReal: c.totalRetencionesReal || 0,
            retencionesPorCobrar: c.retencionesPorCobrar || 0,
            totalCreditoPOS: c.totalCreditoPOS || 0,
            totalAbonosReal: c.totalAbonosReal || 0,
            totalCxCPendiente: c.totalCxCPendiente || 0,
            totalSaldoFavorPOS: c.totalSaldoFavorPOS || 0,
            totalSaldoFavorReal: c.totalSaldoFavorReal || 0,
            totalAjustesManuales: c.totalAjustesManuales || 0,
            saldoFavorObs: c.saldoFavorObs || "",
            totalMetodosPOS: c.totalMetodosPOS || 0,
            totalJustificadoReal: c.totalJustificadoReal || 0,
            totalDirectoPOS: c.totalDirectoPOS || 0,
          };

          await db.createCuadre(createData);
          migrated++;
          if (migrated % 10 === 0) console.log(`    ... ${migrated} cuadres`);
        } catch (err: any) {
          errors++;
          if (errors <= 3) console.log(`    ✗ ${c.id}: ${err?.message || err}`);
        }
      }
      console.log(`  → ${migrated} cuadres migrated, ${errors} errors\n`);
    } catch (err: any) {
      console.log(`  → Cuadres error: ${err?.message || err}\n`);
    }
  }

  // ─── Summary ──────────────────────────────────────────────────────────────
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║  Setup Complete ✅                          ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log("\nNext steps:");
  console.log("  1. Start the app: npm run dev");
  console.log("  2. Login: juan@onprotec.com / 9803");

  await db.closePool();
}

setup().catch(console.error);
