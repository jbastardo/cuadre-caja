/**
 * Migration script: Google Sheets → PostgreSQL
 * 
 * Usage:
 *   npx tsx server/migrate.ts
 * 
 * Requirements:
 *   - DATABASE_URL env var pointing to your PostgreSQL database
 *   - GOOGLE_SHEET_ID env var with the spreadsheet ID
 *   - GOOGLE_SERVICE_ACCOUNT_JSON or google-credentials.json for Sheets access
 * 
 * This script reads all cuadres, metodos, deducciones, ajustes, and usuarios
 * from Google Sheets and inserts them into PostgreSQL.
 */

import "dotenv/config";
import * as sheets from "./sheets.js";
import * as db from "./db.js";
import type { CreateCuadre, Cuadre, MetodoVerificado, Deduccion, AjusteManual } from "../shared/schema.js";

async function migrate() {
  console.log("=== Migration: Google Sheets → PostgreSQL ===\n");

  // Test DB connection
  const dbOk = await db.testConnection();
  if (!dbOk) {
    console.error("Cannot connect to PostgreSQL. Set DATABASE_URL env var.");
    process.exit(1);
  }

  // Initialize DB schema
  const initResult = await db.initializeDb();
  console.log("DB schema:", initResult.initialized);

  // ─── Migrate Users ────────────────────────────────────────────────────────
  console.log("\n--- Migrating Users ---");
  try {
    const sheetUsers = await sheets.getUsers();
    console.log(`Found ${sheetUsers.length} users in Sheets`);
    
    // Get existing users from DB to avoid duplicates
    const dbUsers = await db.getUsers();
    const existingEmails = new Set(dbUsers.map(u => u.email));
    
    let migrated = 0;
    for (const u of sheetUsers) {
      if (!existingEmails.has(u.email)) {
        // We need to get the full user with password from Sheets
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
          console.log(`  ✓ User: ${u.nombre} (${u.email})`);
        }
      } else {
        console.log(`  - User exists: ${u.email}`);
      }
    }
    console.log(`Users migrated: ${migrated}`);
  } catch (err: any) {
    console.error("User migration error:", err?.message || err);
  }

  // ─── Migrate Cuadres ──────────────────────────────────────────────────────
  console.log("\n--- Migrating Cuadres ---");
  try {
    const sheetCuadres = await sheets.getCuadres();
    console.log(`Found ${sheetCuadres.length} cuadres in Sheets`);

    // Get existing cuadres from DB to avoid duplicates
    const dbCuadres = await db.getCuadres();
    const existingIds = new Set(dbCuadres.map(c => c.id));

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const c of sheetCuadres) {
      if (existingIds.has(c.id)) {
        skipped++;
        continue;
      }

      try {
        // Get child rows from Sheets
        const metodos = await getSheetMetodos(c.id);
        const deducciones = await getSheetDeducciones(c.id);
        const ajustesManuales = await getSheetAjustes(c.id);

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

        const result = await db.createCuadre(createData);
        migrated++;
        console.log(`  ✓ Cuadre: ${c.id} (${c.fecha} - ${c.caja}) estado=${result.estado}`);
      } catch (err: any) {
        errors++;
        console.error(`  ✗ Error migrating ${c.id}: ${err?.message || err}`);
      }
    }

    console.log(`\nCuadres migrated: ${migrated}, skipped: ${skipped}, errors: ${errors}`);
  } catch (err: any) {
    console.error("Cuadre migration error:", err?.message || err);
  }

  console.log("\n=== Migration Complete ===");
  await db.closePool();
}

// Helper functions to read child tables from Sheets directly
async function getSheetMetodos(cuadreId: string): Promise<MetodoVerificado[]> {
  try {
    const rows = await sheets.getSheetData("MetodosVerificados");
    if (!rows) return [];
    return rows
      .slice(1)
      .filter((r: string[]) => r[1] === cuadreId)
      .map((r: string[]) => ({
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
  } catch {
    return [];
  }
}

async function getSheetDeducciones(cuadreId: string): Promise<Deduccion[]> {
  try {
    const rows = await sheets.getSheetData("Deducciones");
    if (!rows) return [];
    return rows
      .slice(1)
      .filter((r: string[]) => r[1] === cuadreId)
      .map((r: string[]) => ({
        id: r[0] || "",
        cuadreId: r[1] || "",
        tipo: r[2] || "",
        descripcion: r[3] || "",
        monto: Number(r[4]) || 0,
        comprobante: r[5] || "",
      }));
  } catch {
    return [];
  }
}

async function getSheetAjustes(cuadreId: string): Promise<AjusteManual[]> {
  try {
    const rows = await sheets.getSheetData("AjustesManuales");
    if (!rows) return [];
    return rows
      .slice(1)
      .filter((r: string[]) => r[1] === cuadreId)
      .map((r: string[]) => ({
        id: r[0] || "",
        cuadreId: r[1] || "",
        tipo: r[2] || "",
        descripcion: r[3] || "",
        monto: Number(r[4]) || 0,
        referencia: r[5] || "",
      }));
  } catch {
    return [];
  }
}

migrate().catch(console.error);
