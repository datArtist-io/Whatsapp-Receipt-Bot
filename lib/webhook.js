// Shared by the payment webhooks: turn a successful online payment into a sent receipt.
const { buildSale, origin, waMessage } = require("./sale");
const token = require("./token");
const wa = require("./whatsapp");

function business() {
  return { name: process.env.BUSINESS_NAME || "", phone: process.env.BUSINESS_PHONE || "", address: process.env.BUSINESS_ADDRESS || "", currency: process.env.CURRENCY_SYMBOL || "₦" };
}

async function receiptForPayment(req, { method, reference, name, phone, amount, items, description }) {
  const sale = buildSale({
    business: business(), customer: { name, phone }, method, reference,
    items: Array.isArray(items) && items.length ? items : [{ name: description || "Purchase", qty: 1, price: amount }],
  });
  const t = token.encode(sale);
  const base = origin(req);
  const url = `${base}/r/${t}`;
  let sent = false;
  if (sale.c.p && wa.configured()) {
    try {
      await wa.sendDocument(sale.c.p, `${base}/api/receipt?t=${encodeURIComponent(t)}&format=pdf`, `Receipt-${sale.id}.pdf`, waMessage(sale, url));
      sent = true;
    } catch (e) {
      console.error("whatsapp send failed", e.message);
    }
  }
  console.log(`receipt ${sale.id} for ${method} ${reference}: ${sent ? "sent" : "not sent"} ${url}`);
  return { id: sale.id, url, sent };
}

module.exports = { receiptForPayment };
