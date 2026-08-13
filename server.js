const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3000;
const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const MP_WEBHOOK_SECRET = process.env.MP_WEBHOOK_SECRET || "";

const DATA_DIR = path.join(__dirname, "data");
const ORDERS_FILE = path.join(DATA_DIR, "orders.json");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
if (!fs.existsSync(ORDERS_FILE)) fs.writeFileSync(ORDERS_FILE, "{}", "utf8");

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readOrders() {
  return JSON.parse(fs.readFileSync(ORDERS_FILE, "utf8") || "{}");
}
function writeOrders(orders) {
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2), "utf8");
}
function requireGateway() {
  if (!MP_ACCESS_TOKEN) {
    const e = new Error("MP_ACCESS_TOKEN não configurado.");
    e.status = 500;
    throw e;
  }
}
async function mpFetch(url, options={}) {
  requireGateway();
  const r = await fetch("https://api.mercadopago.com" + url, {
    ...options,
    headers: {
      "Authorization": `Bearer ${MP_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const text = await r.text();
  let data = {};
  try { data = JSON.parse(text); } catch {}
  if (!r.ok) {
    const e = new Error(data.message || `Mercado Pago HTTP ${r.status}`);
    e.status = r.status;
    e.details = data;
    throw e;
  }
  return data;
}

app.post("/api/pix/create", async (req, res) => {
  try {
    const { amount, description, customerName, customerEmail, items } = req.body || {};
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) return res.status(400).json({error:"Valor inválido."});

    const externalReference = "MGF-" + Date.now() + "-" + crypto.randomBytes(3).toString("hex");
    const payment = await mpFetch("/v1/payments", {
      method: "POST",
      headers: {
        "X-Idempotency-Key": crypto.randomUUID()
      },
      body: JSON.stringify({
        transaction_amount: Number(value.toFixed(2)),
        description: description || "Pedido Madame Glamour Fios",
        payment_method_id: "pix",
        payer: {
          email: customerEmail || "cliente@madameglamour.com",
          first_name: (customerName || "Cliente").split(" ")[0],
          last_name: (customerName || "Cliente").split(" ").slice(1).join(" ") || "Madame"
        },
        external_reference: externalReference,
        notification_url: process.env.MP_NOTIFICATION_URL || undefined
      })
    });

    const orders = readOrders();
    orders[externalReference] = {
      id: externalReference,
      gatewayPaymentId: payment.id,
      status: payment.status || "pending",
      amount: value,
      customerName,
      customerEmail,
      items: items || [],
      createdAt: new Date().toISOString()
    };
    writeOrders(orders);

    res.json({
      orderId: externalReference,
      paymentId: payment.id,
      status: payment.status,
      qr_code: payment.point_of_interaction?.transaction_data?.qr_code || "",
      qr_code_base64: payment.point_of_interaction?.transaction_data?.qr_code_base64 || "",
      ticket_url: payment.point_of_interaction?.transaction_data?.ticket_url || ""
    });
  } catch (e) {
    console.error(e);
    res.status(e.status || 500).json({error: e.message || "Erro ao criar Pix."});
  }
});

app.get("/api/orders/:id", (req, res) => {
  const orders = readOrders();
  const order = orders[req.params.id];
  if (!order) return res.status(404).json({error:"Pedido não encontrado."});
  res.json({id:order.id, status:order.status, amount:order.amount});
});

async function syncPayment(paymentId) {
  const payment = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`, {method:"GET"});
  const orders = readOrders();
  const key = Object.keys(orders).find(k => String(orders[k].gatewayPaymentId) === String(paymentId));
  if (!key) return;
  const order = orders[key];
  const old = order.status;
  order.status = payment.status;
  order.updatedAt = new Date().toISOString();
  if (payment.status === "approved") order.paidAt = new Date().toISOString();
  writeOrders(orders);
  console.log(`[PIX] ${key}: ${old} -> ${payment.status}`);
}

app.post("/api/webhooks/mercadopago", async (req, res) => {
  // Always acknowledge quickly. The payment status is verified server-to-server below.
  res.sendStatus(200);
  try {
    const paymentId =
      req.body?.data?.id ||
      req.body?.id ||
      req.query?.["data.id"];
    if (paymentId) await syncPayment(paymentId);
  } catch (e) {
    console.error("[WEBHOOK]", e.message);
  }
});


function adminAuthorized(req) {
  const expected = process.env.ADMIN_TOKEN;
  if (!expected) return false;
  const provided = req.headers["x-admin-token"] || "";
  return provided === expected;
}

app.get("/api/admin/orders", (req, res) => {
  if (!adminAuthorized(req)) return res.status(401).json({error:"Não autorizado."});
  const orders = readOrders();
  const list = Object.values(orders).sort((a,b) => new Date(b.createdAt)-new Date(a.createdAt));
  const stats = {
    total: list.length,
    paid: list.filter(o => o.status === "approved").length,
    pending: list.filter(o => ["pending","in_process","authorized"].includes(o.status)).length,
    cancelled: list.filter(o => ["cancelled","rejected","refunded"].includes(o.status)).length,
    paidValue: list.filter(o => o.status === "approved").reduce((sum,o)=>sum+Number(o.amount||0),0),
    pendingValue: list.filter(o => ["pending","in_process","authorized"].includes(o.status)).reduce((sum,o)=>sum+Number(o.amount||0),0)
  };
  res.json({stats, orders:list});
});

app.post("/api/admin/orders/:id/sync", async (req,res) => {
  if (!adminAuthorized(req)) return res.status(401).json({error:"Não autorizado."});
  const orders = readOrders();
  const order = orders[req.params.id];
  if (!order) return res.status(404).json({error:"Pedido não encontrado."});
  try {
    await syncPayment(order.gatewayPaymentId);
    const updated = readOrders()[req.params.id];
    res.json(updated);
  } catch(e) {
    res.status(500).json({error:e.message || "Erro ao sincronizar."});
  }
});

// Health check
app.get("/api/health", (_req,res) => res.json({ok:true, service:"madame-glamour-fios-pix"}));

app.get("/admin", (_req,res) => res.sendFile(path.join(__dirname,"public","admin.html")));

app.get("*", (_req,res) => res.sendFile(path.join(__dirname,"public","index.html")));

app.listen(PORT, () => {
  console.log(`Madame Glamour Fios rodando em http://localhost:${PORT}`);
  if (!MP_ACCESS_TOKEN) console.warn("ATENÇÃO: MP_ACCESS_TOKEN não configurado.");
});
