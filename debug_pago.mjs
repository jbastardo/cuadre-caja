import { createRequire } from "module";
import { config } from "dotenv";
config();

const require = createRequire(import.meta.url);
const xmlrpc = require("xmlrpc");

const url = process.env.ODOO_URL;
const db = process.env.ODOO_DB;
const user = process.env.ODOO_USERNAME;
const pass = process.env.ODOO_PASSWORD;

if (!url || !db || !user || !pass) {
  console.error("Missing env vars:", { url: !!url, db: !!db, user: !!user, pass: !!pass });
  process.exit(1);
}

function rpc(path, method, params) {
  return new Promise((resolve, reject) => {
    const client = xmlrpc.createSecureClient({ url: `${url}${path}` });
    client.methodCall(method, params, (err, val) => {
      if (err) reject(err); else resolve(val);
    });
  });
}

// Autenticar
const uid = await rpc("/web/dataset/call_kw", "execute_kw", [
  db, 2, pass, "res.users", "search_read",
  [[["login", "=", user]]],
  { fields: ["id", "name"], limit: 1 }
]).then(r => r[0]?.id).catch(async () => {
  const loginClient = xmlrpc.createSecureClient({ url: `${url}/xmlrpc/2/common` });
  return new Promise((res, rej) => {
    loginClient.methodCall("authenticate", [db, user, pass, {}], (e, v) => e ? rej(e) : res(v));
  });
});

console.log("UID:", uid);

function kw(model, method, args, kwargs = {}) {
  const client = xmlrpc.createSecureClient({ url: `${url}/xmlrpc/2/object` });
  return new Promise((resolve, reject) => {
    client.methodCall("execute_kw", [db, uid, pass, model, method, args, kwargs], (err, val) => {
      if (err) reject(err); else resolve(val);
    });
  });
}

// Buscar el pago BANBS/2026/0832
const pagos = await kw("account.payment", "search_read",
  [[["name", "=", "BANBS/2026/0832"]]],
  { fields: ["id", "name", "partner_id", "date", "amount", "journal_id", "create_uid", "reconciled_invoice_ids", "payment_type", "partner_type", "state"] }
);

if (!pagos || pagos.length === 0) {
  console.log("Pago NO encontrado con nombre exacto. Buscando con ilike...");
  const pagos2 = await kw("account.payment", "search_read",
    [[["name", "ilike", "0832"]]],
    { fields: ["id", "name", "partner_id", "date", "amount", "journal_id", "create_uid", "reconciled_invoice_ids", "payment_type", "partner_type", "state"] }
  );
  console.log("Resultados ilike:", JSON.stringify(pagos2, null, 2));
  process.exit(0);
}

const pago = pagos[0];
console.log("\n=== PAGO ===");
console.log(JSON.stringify(pago, null, 2));

// Facturas conciliadas
const invIds = pago.reconciled_invoice_ids || [];
console.log("\n=== FACTURAS CONCILIADAS (IDs):", invIds);

if (invIds.length > 0) {
  const facturas = await kw("account.move", "search_read",
    [[["id", "in", invIds]]],
    { fields: ["id", "name", "move_type", "invoice_date", "amount_total", "amount_residual", "journal_id", "pos_order_ids"] }
  );
  console.log("\n=== FACTURAS DETALLE ===");
  console.log(JSON.stringify(facturas, null, 2));

  for (const inv of facturas) {
    if (inv.pos_order_ids?.length > 0) {
      const posPagos = await kw("pos.payment", "search_read",
        [[["pos_order_id", "in", inv.pos_order_ids]]],
        { fields: ["id", "amount", "payment_method_id"] }
      );
      console.log(`\n=== POS PAGOS de factura ${inv.name} ===`);
      console.log(JSON.stringify(posPagos, null, 2));
    } else {
      console.log(`\nFactura ${inv.name}: SIN pos_order_ids`);
    }
  }
}
