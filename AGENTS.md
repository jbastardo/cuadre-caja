# AGENTS.md - Project Context for Claude Code

## Last Session - 2026-04-17

### Task: Agregar retenciones a nota de crédito en Conciliación de Pagos Diferidos

**Problem**: En la sección 5 (Conciliación de Pagos Diferidos), cuando hay una nota de crédito aplicada a una factura que tiene retención, la retención también debe restarse para saldar el monto. Solo se tomaba en cuenta los pagos y no la porción retenida.

**Solution implemented**:
1. Modified `getConciliacionPagosDiferidos` in `server/odoo.ts`:
   - Added logic to find credit notes (out_refund) applied to the invoice via `reversed_entry_id`
   - Get retenciones (ISLR) from credit notes using METHOD_RETENCION_IVA (26)
   - Get retenciones from the original invoice
   - Sum both to get total retencion

2. Modified `client/src/pages/Cuentas.tsx`:
   - Added `retencionUSD` and `retencionBs` fields to interface
   - Added column in table for Retención $
   - Updated colSpan to account for new column

**Files modified**:
- server/odoo.ts (~line 2217-2249)
- client/src/pages/Cuentas.tsx (interface, table headers, table body)

**Commands run**:
- npm run build (client) - OK
- npx tsc --noEmit -p tsconfig.server.json (has pre-existing errors in routes.ts/sheets.ts)

## Previous context stored in CLAUDE.md