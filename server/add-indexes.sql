-- Add indexes for performance optimization
-- Run with: psql $DATABASE_URL -f server/add-indexes.sql

-- Index for cuadres table
CREATE INDEX IF NOT EXISTS idx_cuadres_fecha ON cuadres(fecha DESC);
CREATE INDEX IF NOT EXISTS idx_cuadres_caja ON cuadres(caja);
CREATE INDEX IF NOT EXISTS idx_cuadres_estado ON cuadres(estado);
CREATE INDEX IF NOT EXISTS idx_cuadres_session_id ON cuadres(session_id);
CREATE INDEX IF NOT EXISTS idx_cuadres_cerrado ON cuadres(cerrado_por) WHERE cerrado_por != '';

-- Index for metodos_verificados
CREATE INDEX IF NOT EXISTS idx_metodos_cuadre_id ON metodos_verificados(cuadre_id);

-- Index for deducciones
CREATE INDEX IF NOT EXISTS idx_deducciones_cuadre_id ON deducciones(cuadre_id);

-- Index for ajustes_manuales
CREATE INDEX IF NOT EXISTS idx_ajustes_cuadre_id ON ajustes_manuales(cuadre_id);

-- Index for usuarios
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);
