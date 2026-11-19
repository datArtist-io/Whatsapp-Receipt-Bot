// POST /api/webhooks/flutterwave : a successful Flutterwave charge sends the customer a receipt.
const crypto = require("crypto");
const { rawBody, json } = require("../../lib/http");
const { receiptForPayment } = require("../../lib/webhook");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
  const hash = process.env.FLUTTERWAVE_SECRET_HASH;
  if (!hash) return json(res, 503, { error: "Flutterwave is not set up." });
  const got = Buffer.from(String(req.headers["verif-hash"] || ""));
  if (got.length !== Buffer.from(hash).length || !crypto.timingSafeEqual(got, Buffer.from(hash))) return json(res, 401, { error: "Bad signature." });
  const raw = await rawBody(req).catch(() => null);
  let event;
  try { event = JSON.parse(String(raw || "")); } catch { return json(res, 400, { error: "Bad JSON." }); }
  const d = event.data || {};
  if (event.event !== "charge.completed" || d.status !== "successful") return json(res, 200, { ignored: true });
  const meta = d.meta || event.meta_data || {}, cust = d.customer || {};
  try {
    const r = await receiptForPayment(req, {
      method: "flutterwave", reference: d.tx_ref || d.flw_ref, amount: Number(d.amount) || 0,
      name: cust.name || meta.name || "", phone: cust.phone_number || meta.phone || "", items: meta.items, description: meta.description,
    });
    json(res, 200, r);
  } catch (e) {
    console.error(e);
    json(res, 200, { error: e.message });
  }
};
