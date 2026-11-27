# AGENTS.md - Project Context for Claude Code

## Last Session - 2026-11-27

### Task: Alerta visual de Notas de Crédito de días anteriores en Sección 1 (Reporte Z)

**Problem**: Al auto-cargar el Reporte Z desde Odoo (`zNotasCreditoBs` basado en `account.move.foreign_total_billed`), las Notas de Crédito que revierten facturas de días anteriores vienen valoradas a la tasa histórica de la factura original, generando un monto menor al impreso en el Reporte Z físico (detectado en Caja 2 el 26/11 `-442,61 Bs` y el 27/11 `-1.970,89 Bs`).

**Solution implemented**:
1. `shared/schema.ts`: Agregado campo opcional `historicalNCs` en `FiscalSummary` y `createCuadreSchema.fiscalSummary`.
2. `server/odoo.ts` (`getFiscalSummary`): Detecta cada NC (`out_refund` de POS o directa) cuyo `foreign_total_billed` difiere en más de `1 Bs` respecto a `amount_total × rate` (tasa BCV del día), devolviendo el detalle en `historicalNCs`.
3. `client/src/pages/CuadreForm.tsx`: Resalta el campo `Notas de Crédito (Bs)` y muestra un banner ámbar de advertencia listando las NCs históricas con su monto en Odoo vs tasa del día, recordando sobrescribir el campo con el valor exacto del Reporte Z físico.

**Files modified**:
- `shared/schema.ts`
- `server/odoo.ts`
- `client/src/pages/CuadreForm.tsx`
- `AGENTS.md`

---

## Last Session - 2026-11-23 (Parte 2)

### Task: Corregir pérdida de `sessionId` en navegación a Reporte No Fiscal (`/cuadre-nf/report`) y reactividad de query params en hash

**Problem**: Al abrir "Reporte NF" desde `CuadreNFForm.tsx`, la pantalla mostraba `"Sin operaciones no fiscales en esta sesion."` a pesar de que Odoo sí devolvía operaciones no fiscales (ej. 23 recibos en Caja 2 y 25 en Caja 1 el `23/11/2026`). La causa era que el botón `"Reporte NF"` navegaba a `"/cuadre-nf/report"` sin incluir `?sessionId=${sessionId}` (antes funcionaba por accidente solo si quedaba un `?sessionId=` residual en `window.location.search`, que `cleanHashNavigate` ahora limpia correctamente). Además, al cambiar de sesión con `Anterior`/`Siguiente` dentro de `/cuadre-nf`, el componente no reaccionaba a cambios en el query string del hash.

**Solution implemented**:
1. `client/src/pages/CuadreNFForm.tsx`:
   - Corregida navegación de `"Reporte NF"` a ``navigate(`/cuadre-nf/report?sessionId=${sessionId}`)``.
   - Lectura reactiva de `sessionId` mediante `useSyncExternalStore` suscrito a `hashchange` y limpieza de estado del formulario al cambiar de sesión.
2. `client/src/pages/CuadreNFReport.tsx`:
   - Lectura reactiva de `sessionId` mediante `useSyncExternalStore` suscrito a `hashchange`.
   - Botón `Volver` ahora redirige a `"/"` si `sessionId` es `0` (evitando caer en `/cuadre-nf?sessionId=0`).

**Files modified**:
- `client/src/pages/CuadreNFForm.tsx`
- `client/src/pages/CuadreNFReport.tsx`
- `AGENTS.md`

---

## Last Session - 2026-11-23

### Task: Corregir duplicación de abonos por partner y doble conteo de retenciones pagadas por banco en `getCreditSales`

**Problem**: En el análisis del cuadre de Caja 2 del `17/11/2026` (`CQ-1795012726240`, diferencia `+6.406,88 Bs`) se detectaron dos bugs en `getCreditSales` (`server/odoo.ts`):
1. El filtro de pagos en `allPayments` solo comparaba `partner_id` y no `reconciled_invoice_ids`, provocando que cuando un mismo cliente tenía varias facturas a crédito el mismo día (ej. `IKSAN GTZ, C.A` con `00038174` y `00038203`), se sumaran todos sus pagos en cada factura.
2. Cuando un cliente pagaba el 100% de la factura por transferencia incluyendo la porción marcada como Retención de IVA en el POS (ej. `00038174` por `62.261,84 Bs` vs crédito POS `55.824,12 Bs`), `abonoAmount` / `abonoAmountBs` no se topaba a `creditAmountPOS`, provocando que la retención (`6.437,72 Bs`) se contara dos veces (en Sección 5 como Abono y en Sección 4 como Retención por cobrar).

**Solution implemented**:
1. `server/odoo.ts` (`getCreditSales`):
   - Filtrado de `allPayments` por `reconciled_invoice_ids.includes(moveId)` (con fallback por referencia/correlativo para pagos del mismo día aún sin conciliar).
   - Tope de `abonoAmount` y `abonoAmountBs` (y ajuste proporcional de `abonoByJournal`) contra `creditAmountPOS` cuando el abono bancario excede la porción a crédito del POS en facturas positivas, evitando el doble conteo con la Sección 4 de retenciones.
2. No se modificó `CQ-1795012726240` en BD (Michelle Maita realizará el ajuste manual directamente en el cuadre).

**Files modified**:
- `server/odoo.ts`
- `AGENTS.md`

**Commands run**:
- `npm run build` — OK
- Verificación `getCreditSales(4693)` contra Odoo (`totalCredBs: 352115.03`, `totalAbonosBs: 352113.37`, `diff: -1.66`) — OK

---

## Last Session - 2026-11-20

### Task: Auto-lectura de Reportes Z desde Odoo, corrección de ruteo hash y filtro de NCs por serial fiscal (17/11)

**Problem**: Al intentar realizar o revisar los cuadres del `17/11/2026`, el sistema presentaba tres fallos:
1. La Sección 1 (Datos del Reporte Z) no se pre-cargaba desde Odoo (`pos.session.report_z`, `account.move.mf_invoice_number`, `foreign_taxable_income`, `foreign_total_billed`, `pos.order.igtf_amount`), dejando el cuadre de Caja 2 (`CQ-1795012726240`) sin `zNumero` y al cuadre de Caja 1 (`sessionId: 4690`, Z `1578`) sin crear.
2. En `client/src/main.tsx`, `useHashLocation` devolvía la ruta con el query string incluido (ej. `"/cuadre/new?sessionId=4690"`), haciendo que `useRoute("/cuadre/new")` devolviera `false` y `<Route path="/cuadre/:id">` intentara cargar el cuadre `"new?sessionId=4690"` (404), impidiendo leer los datos de Odoo en cuadres nuevos.
3. En `server/odoo.ts` (`getFiscalSummary`), el fallback `directNCs` sobre el diario compartido `FAC4` (`journal_id = 131`) no inspeccionaba `mf_serial` ni `reversed_entry_id`, contaminando la sesión `4690` (Caja 1, `Z1F0019552`) con la NC `RFAC4/2026/0095` (`25.866,78 Bs`) perteneciente a Caja 2 (`Z7C7044514`).

**Solution implemented**:
1. `shared/schema.ts`: Agregados campos opcionales sugeridos del Reporte Z (`zReportNumber`, `zVentaBrutaBs`, `zNotasCreditoBs`, `zBaseImponibleBs`, `zExentoBs`, `zIvaBs`, `zIgtfBs`, `zPrimeraFactura`, `zUltimaFactura`, `zPrimeraNC`, `zUltimaNC`) en `FiscalSummary` y `createCuadreSchema.fiscalSummary`.
2. `server/odoo.ts`:
   - `getFiscalSummary` ahora lee `mf_serial`, `mf_invoice_number`, `mf_reportz`, `igtf_amount`, `foreign_taxable_income` y `report_z` de `pos.session` / `pos.order` / `account.move`.
   - Agregado filtrado por `mf_serial` (y `reversed_entry_id` en `directNCs`) para excluir documentos de otra máquina fiscal (evitando que `RFAC4/2026/0095` entre en Caja 1).
   - Calculados y devueltos los campos sugeridos del Reporte Z en `getFiscalSummary`.
3. `client/src/main.tsx` y `client/src/pages/CuadreForm.tsx`:
   - Implementado `useCleanHashLocation` que separa los query params del pathname para que `/cuadre/new` y `/cuadre-nf` siempre hagan match en `wouter`.
   - Agregada auto-carga de `zData` desde `fiscalSummary` para cuadres nuevos o cuadres existentes sin `zNumero`/montos Z, más el botón manual `"Cargar Z desde Odoo"` en la Sección 1.
4. Regularizados en producción los cuadres del `17/11/2026`:
   - Actualizado `CQ-1795012726240` (Caja 2, `sessionId: 4693`) con `zNumero: "189"`.
   - Creado `CQ-1795201776608` (Caja 1, `sessionId: 4690`) con los datos completos de su Reporte Z `#1578`.

**Files modified**:
- `shared/schema.ts`
- `server/odoo.ts`
- `client/src/main.tsx`
- `client/src/pages/CuadreForm.tsx`
- `AGENTS.md`

**Commands run**:
- `npm run build` — OK
- Verificación `getFiscalSummary(4690)`, `getFiscalSummary(4693)`, `getFiscalSummary(4688)` contra Odoo — OK

---

## Last Session - 2026-09-22

### Task: Corregir duplicación de pagos POS en el cálculo de Abonos

**Problem**: El cuadre CQ-1790028420029 mostraba un sobrante falso de casi 400.000 Bs (el cajero forzó el cuadre con un ajuste manual de -403.150,20 Bs dejando una diferencia de -4.002,80 Bs). Al analizar los datos, descubrimos que para la factura 00035601 (Tu Tiendita Express 2023), el cliente pagó 516,91 USD por punto de venta al momento de facturar, dejando solo una deuda a crédito de 47,08 USD. 
El backend en `server/odoo.ts` usaba `search_read` en `account.payment` para todos los pagos del partner de ese día y sumaba esos 516,91 USD como un "Abono", a pesar de que el dinero ya estaba contabilizado en `totalMetodosReal` del cajero (pagos de POS). Esto duplicaba el monto pagado inflando el `totalJustificado` artificialmente por el valor exacto pagado en el punto de venta.

**Solution implemented**:
1. Modificado el loop de procesamiento de pagos (`account.payment`) en `server/odoo.ts` (función `getCreditSales`) para descartar pagos cuyo `ref` o `name` incluyan palabras clave de órdenes POS ("tpv", "caja-") o que coincidan con la referencia de una orden POS de esa misma sesión (`pos_reference` o `name`).
2. De esta forma los pagos originados desde la sesión POS son omitidos en la suma de "Abonos" evitando la duplicación de ingresos.

**Files modified**:
- server/odoo.ts (exclusión de pagos POS en abonos)

**Commands run**:
- git push origin main - OK (commit dbdfddc)

---## Last Session - 2026-09-08

### Task: Corregir duplicación de retenciones en cálculo de abonos

**Problem**: El cuadre CQ-1788286479986 mostraba un sobrante de 38.257,11 Bs. Al analizar los datos de Odoo vs Z, se descubrió que el `totalAbonosReal` reportaba pagos por 490.366,30 Bs para ventas a crédito cuyo monto en POS fue de 452.178,23 Bs.
Esto ocurría porque al calcular el `abonoAmountBs` de una factura pagada en Odoo, la función agregaba TODOS los pagos entrantes a la factura sin filtrar el diario (journal_id). Cuando un cliente pagaba con transferencia y retenía IVA, la retención se registraba como un pago con el diario "Retenciones de IVA Clientes". Este pago se sumaba a `totalAbonosReal` y, dado que la retención también se declara en el RIVAC (`totalRetencionesReal`), el monto de la retención se sumaba DOS VECES al `totalJustificado`, inflando artificialmente el cuadre y provocando un sobrante falso. Además, el `creditAmountPOS` (la deuda original registrada por el POS) ya excluía el monto de retención, por lo que este no debía sumarse al abono de todas formas.

**Solution implemented**:
1. Modificado el loop de procesamiento de pagos en `server/odoo.ts` para extraer el nombre del diario y omitir el pago si el nombre contiene la palabra "retenci" (insensible a mayúsculas/minúsculas).
2. Esto asegura que solo el dinero real pagado por transferencia/efectivo se considere como Abono, eliminando el conteo doble en `totalJustificado` y cuadrando correctamente.

**Files modified**:
- server/odoo.ts (líneas 1751-1761: exclusión de retenciones en abonos)

**Commands run**:
- git push origin main - OK (commit 4b96d9e)

---

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