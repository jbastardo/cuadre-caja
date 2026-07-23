# AGENTS.md - Project Context for Claude Code

## Last Session - 2026-07-23

### Task: Depuración de cuadre CQ-1784754974280 y corrección de bugs

**Problem**: El cuadre CQ-1784754974280 tenía varias discrepancias:
1. Bug en cálculo de `diferencia` por método en `metodos_verificados`: se calculaba `montoReal - montoUSD` (mezclando Bs con USD) en lugar de `montoReal - montoPOS_Bs`
2. Discrepancia de facturas: Z dice 53 facturas (66524-66576), pero Odoo solo encuentra 34 (17+17)
3. Diferencia cambiaria alta: 905.244,97 Bs

**Solution implemented**:
1. Corregido bug en `server/db.ts` líneas 353 y 489:
   - Cambiado `const diff = Math.round((montoReal - montoUSD) * 100) / 100;`
   - A `const diff = Math.round((montoReal - montoPosBs) * 100) / 100;`
   - Esto asegura que la diferencia se calcule en la misma unidad (Bs vs Bs)

2. Agregado endpoint de debug `GET /api/debug/fiscal-summary/:id` en `server/routes.ts`:
   - Expone función `debugFiscalSummary` en `server/odoo.ts`
   - Muestra todas las facturas encontradas por Odoo con detalles completos
   - Agrupa facturas por sesión (main vs companion)
   - Muestra facturas excluidas y razón de exclusión (journal, state, type)
   - Útil para diagnosticar discrepancias entre Z y Odoo

3. Corregido bug en `server/odoo.ts` función `getFiscalSummary` y `debugFiscalSummary`:
   - El código solo calculaba el journal de la PRIMERA sesión companion
   - Ahora calcula TODOS los journals de TODAS las sesiones relacionadas
   - Esto corrige la discrepancia donde Z decía 53 facturas y Odoo solo 34
   - Las 19 facturas faltantes estaban en journals de otras sesiones companion (FAC4 = journal 131)

4. Corregido diferencia cambiaria alta (905.244,97 Bs → 36.759,85 Bs):
   - La diferencia cambiaria alta se debía a que Odoo no incluía todas las facturas
   - Al corregir el bug de los journals, el totalOdooBs pasó de 2.916.407,05 a 3.784.892,17 Bs
   - La nueva diferencia cambiaria (36.759,85 Bs) coincide exactamente con el IGTF del Z
   - Cuadre actualizado manualmente con los nuevos valores del fiscal summary

**Files modified**:
- server/db.ts (líneas 353, 489: corrección de cálculo de diferencia)
- server/odoo.ts (agregada función `debugFiscalSummary` ~líneas 862-982, corregido `getFiscalSummary` para incluir todos los journals)
- server/routes.ts (agregado endpoint `/api/debug/fiscal-summary/:id` ~líneas 842-850)

**Commands run**:
- git push origin main - OK (commit 7c1f076)
- Cuadre CQ-1784754974280 actualizado con nuevos valores del fiscal summary

**Result**:
- Discrepancia de facturas resuelta: Z dice 53, Odoo ahora dice 53 ✓
- Diferencia cambiaria corregida: 905.244,97 Bs → 36.759,85 Bs (coincide con IGTF) ✓
- Bug de cálculo de diferencia por método corregido (Bs-USD → Bs-Bs) ✓

**Commands run**:
- git push origin main - OK (commit c4bb2f2)

**Pending investigation**:
- Usar endpoint de debug para diagnosticar por qué Z dice 53 facturas y Odoo solo 34
- Investigar diferencia cambiaria alta (905.244,97 Bs) - posiblemente relacionada con la discrepancia de facturas

---

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

---

## 2026-05-08 — Estado inconsistente: server SPECIAL_METHOD_IDS vs frontend SECTION3_EXCLUDED_IDS

### Problem
El estado del cuadre se veía diferente entre el formulario, el historial, el dashboard y el reporte. La inconsistencia se debía a que `server/db.ts` tenía `SPECIAL_METHOD_IDS` con ID 42 (Cashea) y filtraba por nombre "crédito" en `directMetodos`, mientras que el frontend (`CuadreForm.tsx`) no excluía ni ID 42 ni por nombre en su `directMetodos`. Esto causaba que `computeCuadreTotals` y `recalculateCuadreEstado` calcularan `totalMetodosReal` (y por ende `totalJustificado`, `diferencia`, `estado`) distinto al frontend.

Además, el reporte (`CuadreReport.tsx`) usaba `cuadre.estado` (DB) para la etiqueta de estado pero `esCuadrado` (cálculo local) para el color, causando labels inconsistentes (ej. "Pendiente" en verde).

### Solution
**Server (`server/db.ts`)**:
- Remover ID 42 de `SPECIAL_METHOD_IDS` — ahora coincide exactamente con `SECTION3_EXCLUDED_IDS = {26, 14, 33, 25}` del frontend
- Remover función `isCreditoByName()` — el frontend no filtra directMetodos por nombre "crédito" (solo por SECTION3_EXCLUDED_IDS + delivery/diferencia)
- Remover `NOMBRE_OVERRIDE_IDS` — ya no era necesario sin isCreditoByName
- `directMetodos` filter ahora es: `!SPECIAL_METHOD_IDS.has(m.metodoId) && !isDeliveryOrDifName(m.metodoNombre)`

**Reporte (`CuadreReport.tsx`)**:
- Agregar `estadoVisible` calculado localmente con misma lógica que el form:
  `esCuadrado ? "cuadrado" : cerradoPor ? "descuadrado" : "pendiente"`
- Header usa `getStatusLabel(estadoVisible)` en vez de `getStatusLabel(cuadre.estado)`
- Result box también usa `estadoVisible` para el badge (✓/✗/△)

### Files modified
- `server/db.ts` (lines 256-270: SPECIAL_METHOD_IDS sin 42, removidas isCreditoByName y NOMBRE_OVERRIDE_IDS; lines 281-296 y 634-638: directMetodos filter sin isCreditoByName)
- `client/src/pages/CuadreReport.tsx` (lines 214-222: +estadoVisible; line 275: usa estadoVisible en header; line 721: result badge con pendiente)

### Commands run
- `git push origin HEAD:main` — OK

---

## 2026-05-08 — Estado inconsistente entre Dashboard, Historial y Formulario

### Problem
El Dashboard mostraba "Pendiente" (amarillo) y el Historial también mostraba "Pendiente", pero al entrar al cuadre en el formulario mostraba "Cuadrado" (verde). Esto ocurría porque:
- **Dashboard** (línea 226): leía `cuadre.estado` directamente de DB (valor desactualizado/estático)
- **Historial** (11 refs a `c.estado`): también leía `cuadre.estado` de DB
- **Formulario** (líneas 792-798): calculaba estado EN VIVO basado en `ventaNetaZ`, `diferencia < 5Bs`, y `cerradoPor`
- **Reporte**: tenía `estadoVisible` pero aún divergía en casos edge

El fix previo solo alineó server/frontend para cálculo de diferencia, pero no sincronizó cómo se **muestra** el estado en las 3 vistas principales.

### Solution
**Helper centralizado (`client/src/lib/utils.ts`)**:
- Crear `calculateEstado()` que replica EXACTAMENTE la lógica del formulario:
  ```ts
  if (ventaNetaZ === 0) return "cuadrado";
  if (Math.abs(diferencia) < 5) return "cuadrado";
  if (cuadre.cerradoPor) return "descuadrado";
  return "pendiente";
  ```

**Dashboard (`client/src/pages/Dashboard.tsx`)**:
- Reemplazar `cuadre?.estado` con `calculateEstado(cuadre)` en badge de estado (línea 226)

**Historial (`client/src/pages/CuadreList.tsx`)**:
- Reemplazar TODAS las 11 referencias a `c.estado` con `calculateEstado(c)`:
  - Calendario: `dayStatus()` (líneas 133-134), stats mensuales (líneas 124-126), chips de día (líneas 243, 251-252, 255), comparación de status (líneas 58, 113)
  - Lista: badge de estado (línea 317)

### Files modified
- `client/src/lib/utils.ts` (+calculateEstado helper, 24 líneas)
- `client/src/pages/Dashboard.tsx` (línea 226: calculateEstado en vez de cuadre.estado)
- `client/src/pages/CuadreList.tsx` (11 reemplazos de c.estado → calculateEstado(c))

### Commands run
- `git commit` + `git push origin HEAD:main` — commit 91fffd5

### Result
Ahora Dashboard, Historial, Reporte y Formulario muestran el MISMO estado calculado en vivo. Si el formulario dice "Cuadrado", todas las demás vistas también dicen "Cuadrado".

---

## Previous context stored in CLAUDE.md