# Estado de la tarea: Resolver error 500 al guardar cuadres

## Problema original
- Al agregar campos `totalMetodosPOS` y `totalJustificadoReal` al schema y formulario, el guardado de cuadres comenzó a dar error 500

## Solución aplicada
Se reversaron los cambios que causaban el error:

### Archivos modificados:

1. **client/src/pages/CuadreForm.tsx**
   - Eliminado el envío de `totalMetodosPOS` y `totalJustificadoReal` en el body del save

2. **shared/schema.ts**
   - Eliminados los campos opcionales `totalMetodosPOS` y `totalJustificadoReal` del `cuadreSchema`

3. **server/sheets.ts**
   - Eliminada la lectura de columnas 42 y 43 (totalMetodosPOS, totalJustificadoReal) en `rowToCuadre`
   - Eliminada la escritura de esos campos en `cuadreToRow`
   - Comentar las asignaciones en `createCuadre` y `updateCuadre`

4. **server/routes.ts**
   - Agregado logging más detallado en el error del PUT cuadre

## Verificación
- Build exitoso: `npm run build` completado sin errores
- TypeScript compila correctamente

## Estado actual
- El guardado de cuadres debería funcionar nuevamente
- El reporte seguirá mostrando los valores del formulario (usando fallback al campo original)
- El problema original de discrepancia entre reporte y formulario NO está resuelto - se necesita una solución diferente

## Siguiente paso
Hacer commit de estos cambios y deploy a Railway para verificar que el error 500 está resuelto.