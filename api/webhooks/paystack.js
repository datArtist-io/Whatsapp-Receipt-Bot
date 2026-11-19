// POST /api/webhooks/paystack : a successful Paystack charge sends the customer a receipt.
const crypto = require("crypto");
const { rawBody, json } = require("../../lib/http");
const { receiptForPayment } = require("../../lib/webhook");

module.exports = async (req, res) => {
  if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
  const secret = process.env.PAYSTACK_SECRET_KEY;
  if (!secret) return json(res, 503, { error: "Paystack is not set up." });
  const raw = await rawBody(req).catch(() => null);
  if (!raw) return json(res, 400, { error: "No body." });
  const want = crypto.createHmac("sha512", secret).update(raw).digest("hex");
  const got = String(req.headers["x-paystack-signature"] || "");
  if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return json(res, 401, { error: "Bad signature." });
  let event;
  try { event = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: "Bad JSON." }); }
  if (event.event !== "charge.success") return json(res, 200, { ignored: event.event || true });
  const d = event.data || {}, meta = d.metadata || {}, cust = d.customer || {};
  try {
    const r = await receiptForPayment(req, {
      method: "paystack", reference: d.reference, amount: (Number(d.amount) || 0) / 100,
      name: [cust.first_name, cust.last_name].filter(Boolean).join(" ") || meta.name || "",
      phone: cust.phone || meta.phone || "", items: meta.items, description: meta.description,
    });
    json(res, 200, r);
  } catch (e) {
    console.error(e);
    json(res, 200, { error: e.message }); // 200 so Paystack does not retry a payment we cannot turn into a receipt
  }
};
