-- Migration: Backfill Bs fields in snapshot tables using stored tasa_dia
-- Date: 2026-07-10
-- Purpose: Historical cuadres stored USD-only in snapshots. This backfills
--          the Bs columns using each cuadre's own tasa_dia so the report
--          shows correct amounts regardless of today's rate.

-- ─── Step 1: Add columns if they don't exist ────────────────────────────────
ALTER TABLE retenciones_snapshot ADD COLUMN IF NOT EXISTS pos_total_bs NUMERIC(15,2) DEFAULT 0;
ALTER TABLE retenciones_snapshot ADD COLUMN IF NOT EXISTS retention_amount_bs NUMERIC(15,2) DEFAULT 0;
ALTER TABLE credit_sales_snapshot ADD COLUMN IF NOT EXISTS residual_bs NUMERIC(15,2) DEFAULT 0;

-- ─── Step 2: Backfill retenciones_snapshot ──────────────────────────────────
-- pos_total_bs = pos_total_usd * cuadre.tasa_dia
-- retention_amount_bs = retention_amount * cuadre.tasa_dia
UPDATE retenciones_snapshot rs
SET
  pos_total_bs = ROUND(rs.pos_total_usd * c.tasa_dia, 2),
  retention_amount_bs = ROUND(rs.retention_amount * c.tasa_dia, 2)
FROM cuadres c
WHERE rs.cuadre_id = c.id
  AND (rs.pos_total_bs = 0 OR rs.retention_amount_bs = 0)
  AND c.tasa_dia > 0;

-- ─── Step 3: Backfill credit_sales_snapshot ─────────────────────────────────
-- residual_bs = residual * cuadre.tasa_dia
UPDATE credit_sales_snapshot cs
SET residual_bs = ROUND(cs.residual * c.tasa_dia, 2)
FROM cuadres c
WHERE cs.cuadre_id = c.id
  AND cs.residual_bs = 0
  AND c.tasa_dia > 0;

-- ─── Summary ────────────────────────────────────────────────────────────────
-- Verify results
SELECT
  'retenciones_snapshot' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE pos_total_bs > 0) as rows_with_bs
FROM retenciones_snapshot
UNION ALL
SELECT
  'credit_sales_snapshot' as table_name,
  COUNT(*) as total_rows,
  COUNT(*) FILTER (WHERE residual_bs > 0) as rows_with_bs
FROM credit_sales_snapshot;
