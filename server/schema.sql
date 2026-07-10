-- Cuadre de Caja — PostgreSQL Schema
-- Run this in Railway PostgreSQL console or via psql

-- ─── Usuarios ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS usuarios (
  id       VARCHAR(50)  PRIMARY KEY,
  nombre   VARCHAR(255) NOT NULL,
  email    VARCHAR(255) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  rol      VARCHAR(20)  NOT NULL DEFAULT 'cajero'
    CHECK (rol IN ('cajero', 'supervisor', 'admin')),
  activo   BOOLEAN      NOT NULL DEFAULT TRUE
);
CREATE INDEX IF NOT EXISTS idx_usuarios_email ON usuarios(email);

-- ─── Cuadres ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cuadres (
  id                    VARCHAR(50)  PRIMARY KEY,
  fecha                 DATE         NOT NULL,
  caja                  VARCHAR(100),
  maquina_fiscal        VARCHAR(100),
  session_id            INT          NOT NULL,
  session_name          VARCHAR(255),
  cajero                VARCHAR(255),
  z_numero              VARCHAR(50),
  venta_bruta_z         NUMERIC(15,2) DEFAULT 0,
  notas_credito_z       NUMERIC(15,2) DEFAULT 0,
  venta_neta_z          NUMERIC(15,2) DEFAULT 0,
  base_imponible_z      NUMERIC(15,2) DEFAULT 0,
  exento_z              NUMERIC(15,2) DEFAULT 0,
  iva_z                 NUMERIC(15,2) DEFAULT 0,
  igtf_z                NUMERIC(15,2) DEFAULT 0,
  primera_factura_z     VARCHAR(50),
  ultima_factura_z      VARCHAR(50),
  primera_ncz           VARCHAR(50),
  ultima_ncz            VARCHAR(50),
  tasa_dia              NUMERIC(15,2) DEFAULT 0,
  total_odoo_usd        NUMERIC(15,2) DEFAULT 0,
  total_odoo_bs         NUMERIC(15,2) DEFAULT 0,
  dif_cambiaria         NUMERIC(15,2) DEFAULT 0,
  total_metodos_real    NUMERIC(15,2) DEFAULT 0,
  total_deducciones     NUMERIC(15,2) DEFAULT 0,
  total_justificado     NUMERIC(15,2) DEFAULT 0,
  diferencia            NUMERIC(15,2) DEFAULT 0,
  estado                VARCHAR(20)  NOT NULL DEFAULT 'pendiente'
    CHECK (estado IN ('cuadrado', 'descuadrado', 'pendiente')),
  observaciones         TEXT,
  observaciones_nf      TEXT,
  tipo                  VARCHAR(10)  NOT NULL DEFAULT 'fiscal'
    CHECK (tipo IN ('fiscal', 'nf')),
  saldo_favor_obs       TEXT,
  cerrado_por           VARCHAR(255),
  creado_en             TIMESTAMPTZ,
  cerrado_en            TIMESTAMPTZ,
  total_retenciones_pos NUMERIC(15,2) DEFAULT 0,
  total_retenciones_real NUMERIC(15,2) DEFAULT 0,
  retenciones_por_cobrar NUMERIC(15,2) DEFAULT 0,
  total_credito_pos     NUMERIC(15,2) DEFAULT 0,
  total_abonos_real     NUMERIC(15,2) DEFAULT 0,
  total_cxc_pendiente   NUMERIC(15,2) DEFAULT 0,
  total_saldo_favor_pos NUMERIC(15,2) DEFAULT 0,
  total_saldo_favor_real NUMERIC(15,2) DEFAULT 0,
  total_ajustes_manuales NUMERIC(15,2) DEFAULT 0,
  total_metodos_pos     NUMERIC(15,2) DEFAULT 0,
  total_justificado_real NUMERIC(15,2) DEFAULT 0,
  total_directo_pos     NUMERIC(15,2) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cuadres_fecha      ON cuadres(fecha);
CREATE INDEX IF NOT EXISTS idx_cuadres_estado     ON cuadres(estado);
CREATE INDEX IF NOT EXISTS idx_cuadres_session_id ON cuadres(session_id);
CREATE INDEX IF NOT EXISTS idx_cuadres_tipo       ON cuadres(tipo);
CREATE INDEX IF NOT EXISTS idx_cuadres_cerrado    ON cuadres(cerrado_por);

-- ─── MetodosVerificados ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS metodos_verificados (
  id            VARCHAR(50)  PRIMARY KEY,
  cuadre_id     VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  metodo_id     INT,
  metodo_nombre VARCHAR(255),
  monto_pos_usd NUMERIC(15,2) DEFAULT 0,
  monto_pos_bs  NUMERIC(15,2) DEFAULT 0,
  monto_real    NUMERIC(15,2) DEFAULT 0,
  diferencia    NUMERIC(15,2) DEFAULT 0,
  observacion   TEXT
);
CREATE INDEX IF NOT EXISTS idx_mv_cuadre_id ON metodos_verificados(cuadre_id);

-- ─── Deducciones ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deducciones (
  id           VARCHAR(50)  PRIMARY KEY,
  cuadre_id    VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  tipo         VARCHAR(100),
  descripcion  TEXT,
  monto        NUMERIC(15,2) DEFAULT 0,
  comprobante  VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_dd_cuadre_id ON deducciones(cuadre_id);

-- ─── AjustesManuales ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ajustes_manuales (
  id          VARCHAR(50)  PRIMARY KEY,
  cuadre_id   VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  tipo        VARCHAR(100),
  descripcion TEXT,
  monto       NUMERIC(15,2) DEFAULT 0,
  referencia  VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_am_cuadre_id ON ajustes_manuales(cuadre_id);

-- ─── Credit Sales Snapshot ──────────────────────────────────────────────────
-- Stores credit sales data at save time to prevent drift from Odoo changes
CREATE TABLE IF NOT EXISTS credit_sales_snapshot (
  id                VARCHAR(50)  PRIMARY KEY,
  cuadre_id         VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  invoice_number    VARCHAR(50),
  partner           VARCHAR(255),
  invoice_total     NUMERIC(15,2) DEFAULT 0,
  credit_amount_pos NUMERIC(15,2) DEFAULT 0,
  retention_amount_pos NUMERIC(15,2) DEFAULT 0,
  abono_amount      NUMERIC(15,2) DEFAULT 0,
  abono_amount_bs   NUMERIC(15,2) DEFAULT 0,
  abono_journal     VARCHAR(255),
  abono_by_journal  TEXT,          -- JSON string
  residual          NUMERIC(15,2) DEFAULT 0,
  payment_state     VARCHAR(50),
  payment_total_bs  NUMERIC(15,2) DEFAULT 0,
  payment_total_usd NUMERIC(15,2) DEFAULT 0,
  excedente_bs      NUMERIC(15,2) DEFAULT 0,
  excedente_usd     NUMERIC(15,2) DEFAULT 0,
  excedente_concepto VARCHAR(100),
  genera_saldo_favor BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_cs_cuadre_id ON credit_sales_snapshot(cuadre_id);

-- ─── Retenciones Snapshot ───────────────────────────────────────────────────
-- Stores retention data at save time to prevent drift from Odoo changes
CREATE TABLE IF NOT EXISTS retenciones_snapshot (
  id                VARCHAR(50)  PRIMARY KEY,
  cuadre_id         VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  invoice_number    VARCHAR(50),
  partner           VARCHAR(255),
  pos_total_usd     NUMERIC(15,2) DEFAULT 0,
  pos_total_bs      NUMERIC(15,2) DEFAULT 0,
  retention_amount  NUMERIC(15,2) DEFAULT 0,
  retention_amount_bs NUMERIC(15,2) DEFAULT 0,
  rivac_entry_name  VARCHAR(255),
  status            VARCHAR(20) DEFAULT 'pending'
);
CREATE INDEX IF NOT EXISTS idx_rs_cuadre_id ON retenciones_snapshot(cuadre_id);

-- ─── Saldos Favor Snapshot ──────────────────────────────────────────────────
-- Stores saldo a favor data at save time
CREATE TABLE IF NOT EXISTS saldos_favor_snapshot (
  id                VARCHAR(50)  PRIMARY KEY,
  cuadre_id         VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  order_name        VARCHAR(50),
  partner           VARCHAR(255),
  invoice_number    VARCHAR(50),
  amount            NUMERIC(15,2) DEFAULT 0,
  amount_bs         NUMERIC(15,2) DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sf_cuadre_id ON saldos_favor_snapshot(cuadre_id);

-- ─── Fiscal Summary Snapshot ────────────────────────────────────────────────
-- Stores fiscal summary totals at save time
CREATE TABLE IF NOT EXISTS fiscal_summary_snapshot (
  id                    VARCHAR(50)  PRIMARY KEY,
  cuadre_id             VARCHAR(50)  NOT NULL REFERENCES cuadres(id) ON DELETE CASCADE,
  journal_id            INT,
  journal_code          VARCHAR(50),
  invoice_count         INT DEFAULT 0,
  nc_count              INT DEFAULT 0,
  total_usd             NUMERIC(15,2) DEFAULT 0,
  total_tax_usd         NUMERIC(15,2) DEFAULT 0,
  total_ves             NUMERIC(15,2) DEFAULT 0,
  rate                  NUMERIC(15,4) DEFAULT 0,
  total_retenciones_pos NUMERIC(15,2) DEFAULT 0,
  total_credito_pos     NUMERIC(15,2) DEFAULT 0,
  total_saldo_favor_pos NUMERIC(15,2) DEFAULT 0,
  first_invoice         VARCHAR(50),
  last_invoice          VARCHAR(50),
  first_nc              VARCHAR(50),
  last_nc               VARCHAR(50),
  companion_session_name VARCHAR(255),
  payments              TEXT,          -- JSON string of FiscalPayment[]
  main_first_invoice    VARCHAR(50),
  main_last_invoice     VARCHAR(50),
  main_invoice_count    INT,
  main_first_nc         VARCHAR(50),
  main_last_nc          VARCHAR(50),
  main_nc_count         INT,
  companion_first_invoice VARCHAR(50),
  companion_last_invoice  VARCHAR(50),
  companion_invoice_count INT,
  companion_first_nc    VARCHAR(50),
  companion_last_nc     VARCHAR(50),
  companion_nc_count    INT,
  companion_journal_code VARCHAR(50),
  main_journal_code     VARCHAR(50),
  main_caja_name        VARCHAR(255),
  companion_caja_name   VARCHAR(255)
);
CREATE INDEX IF NOT EXISTS idx_fs_cuadre_id ON fiscal_summary_snapshot(cuadre_id);

-- ─── Seed Data ───────────────────────────────────────────────────────────────
INSERT INTO usuarios (id, nombre, email, password, rol, activo)
VALUES ('USR-001', 'Juan Carlos Bastardo', 'juan@onprotec.com', '9803', 'admin', TRUE)
ON CONFLICT (id) DO NOTHING;
