# Estado: Implementación CxC/CxP - Corrección de sintaxis Odoo

## Progreso

Se limpió el código duplicado en `server/odoo.ts` y se corrigió la sintaxis de search_read:

### Cambios realizados:

1. **Eliminadas funciones duplicadas** (líneas 1801-1871 original):
   - Eliminadas 3 definiciones duplicadas de `getCxCLines`
   - Eliminadas 3 definiciones duplicadas de `getCxPLines`
   - Eliminadas 3 definiciones duplicadas de `getBankMovements`

2. **Corregida sintaxis search_read**:
   - Cambiado de: `executeKw("model", "search_read", [domain, { fields, limit }])`
   - A: `executeKw("model", "search_read", [domain, fields])`
   - Afecta: `getAllInvoices`, `getSupplierInvoices`, `getBankMovements`, `searchPartnersByType`

3. **Actualizado getCxCLines**:
   - Ahora filtra por cuentas 1122001 y 1122007 (CxC comercial y Cashea)
   - Incluye campos: move_id, account_id, journal_id

4. **Corregido getMovimientosCuentas**:
   - Usa `getAllInvoices(fechaDesde, fechaHasta)` para CxC
   - Usa `getSupplierInvoices(fechaDesde, fechaHasta)` para CxP

## Estado actual
- Cambios en `server/odoo.ts` listos para commit
-listo para hacer commit y push (no hay otros cambios en git status)