import { pool } from "./db.js";

async function runMigration() {
  console.log("Starting migration: backfill snapshot Bs fields...\n");

  try {
    // Step 1: Add columns if they don't exist
    console.log("Step 1: Adding columns...");
    await pool.query(`ALTER TABLE retenciones_snapshot ADD COLUMN IF NOT EXISTS pos_total_bs NUMERIC(15,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE retenciones_snapshot ADD COLUMN IF NOT EXISTS retention_amount_bs NUMERIC(15,2) DEFAULT 0`);
    await pool.query(`ALTER TABLE credit_sales_snapshot ADD COLUMN IF NOT EXISTS residual_bs NUMERIC(15,2) DEFAULT 0`);
    console.log("  Columns added (or already exist).\n");

    // Step 2: Backfill retenciones_snapshot
    console.log("Step 2: Backfilling retenciones_snapshot...");
    const retResult = await pool.query(`
      UPDATE retenciones_snapshot rs
      SET
        pos_total_bs = ROUND(rs.pos_total_usd * c.tasa_dia, 2),
        retention_amount_bs = ROUND(rs.retention_amount * c.tasa_dia, 2)
      FROM cuadres c
      WHERE rs.cuadre_id = c.id
        AND (rs.pos_total_bs = 0 OR rs.retention_amount_bs = 0)
        AND c.tasa_dia > 0
    `);
    console.log(`  Updated ${retResult.rowCount} retention rows.\n`);

    // Step 3: Backfill credit_sales_snapshot
    console.log("Step 3: Backfilling credit_sales_snapshot...");
    const creditResult = await pool.query(`
      UPDATE credit_sales_snapshot cs
      SET residual_bs = ROUND(cs.residual * c.tasa_dia, 2)
      FROM cuadres c
      WHERE cs.cuadre_id = c.id
        AND cs.residual_bs = 0
        AND c.tasa_dia > 0
    `);
    console.log(`  Updated ${creditResult.rowCount} credit sale rows.\n`);

    // Verify results
    console.log("Verification:");
    const retStats = await pool.query(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE pos_total_bs > 0) as with_bs
      FROM retenciones_snapshot
    `);
    console.log(`  retenciones_snapshot: ${retStats.rows[0].total} total, ${retStats.rows[0].with_bs} with Bs`);

    const creditStats = await pool.query(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE residual_bs > 0) as with_bs
      FROM credit_sales_snapshot
    `);
    console.log(`  credit_sales_snapshot: ${creditStats.rows[0].total} total, ${creditStats.rows[0].with_bs} with Bs`);

    console.log("\nMigration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await pool.end();
  }
}

runMigration();
