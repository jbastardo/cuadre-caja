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

---

## 2026-05-07 — Sección V: recalcular totales desde items (no desde DB del form)

### Problem
En la Sección V del reporte financiero (`CuadreReport.tsx`), los totales usaban valores pre-computados del formulario guardados en DB (`cuadre.totalRetencionesPOS`, `cuadre.totalCreditoPOS`, `cuadre.totalAbonosReal`, etc.) en vez de sumar los items que componen la sección. Esto causaba descuadres porque el formulario tiene una agrupación/orden diferente sin el enfoque financiero necesario.

Además:
- Faltaba incluir `totalCasheaReal` en la fórmula `totalReal` (el form lo incluye dentro de `directMetodos`, pero el reporte lo separa a su propia línea)
- Faltaban las deducciones manuales (`cuadre.deducciones`) en el cálculo
- La variable `totalPOS` estaba declarada pero nunca usada

### Solution
Reemplazar todas las variables que leían `cuadre.totalXxx` de DB con cálculos desde los arrays subyacentes:

| Variable antes (DB) | Ahora calculado desde |
|---|---|
| `totalRetPOS` | `retentions[]` — suma de `posTotalUSD × tasa` |
| `retPorCobrar` | `totalRetPOS - totalRetReal` (antes venía de DB) |
| `totalCreditoPOS` | `creditoMtds[]` — suma de `montoPOS_Bs` |
| `totalAbonos` | `creditSales[]` — suma de `abonoAmount`/`abonoAmountBs` convertido a Bs |
| `totalCxCPendiente` | `creditSales[]` — suma de `residual × tasa` |
| `totalSFavorPOS` | `cuadre.saldosFavor[]` — suma de `amountBs`/`amount × tasa` |
| `totalAjustes` | `cuadre.ajustesManuales[]` — suma de `monto` |
| `totalDeduccionesManuales` | `cuadre.deducciones[]` — suma de `monto` (NUEVO) |
| `totalPOS` | Eliminada (no se usaba) |

Se agregaron también a la fórmula `totalReal`:
- `totalCasheaReal` (el form lo incluye en directMetodos, el reporte lo tiene como línea separada)
- `totalDeduccionesManuales` (ítems manuales de delivery/diferencia)

Se actualizó la Sección V display para mostrar:
- POS side: `Delivery / Dif.` = `totalDeliveryPOS` (métodos con nombre delivery/diferencia)
- REAL side: `Delivery / Dif. (POS)` + `Deducciones manuales` como líneas separadas

**Fallback**: Cuando los arrays están vacíos (cuadres viejos sin datos hidratados), se usa el valor guardado en DB como respaldo.

### Files modified
- `client/src/pages/CuadreReport.tsx` (líneas 131-211: reemplazo completo de variables; línea 659-660: display deducciones; línea 201: +totalCasheaReal en fórmula)

### Commands run
- `npx vite build` (client) — fallo pre-existente en `main.tsx` (import `@/lib/queryClient`), no relacionado

## Previous context stored in CLAUDE.md