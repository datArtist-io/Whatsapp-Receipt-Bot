// POST /api/sale: make a receipt, and send it on WhatsApp when automatic sending is set up.
const crypto = require("crypto");
const { buildSale, total, money, origin, waMessage } = require("../lib/sale");
const token = require("../lib/token");
const wa = require("../lib/whatsapp");
const { json, jsonBody, fail } = require("../lib/http");

function allowed(req) {
  const key = process.env.SLIPP_KEY;
  if (!key) return true;
  const got = Buffer.from(String(req.headers["x-slipp-key"] || ""));
  const want = Buffer.from(key);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!allowed(req)) return json(res, 401, { error: "The access code is wrong. Check it in Settings." });
    const input = await jsonBody(req);
    const sale = buildSale(input);
    const t = token.encode(sale);
    const base = origin(req);
    const url = `${base}/r/${t}`;
    const pdfUrl = `${base}/api/receipt?t=${encodeURIComponent(t)}&format=pdf`;
    const phone = sale.c.p;
    const out = {
      id: sale.id, date: sale.d, total: total(sale), totalText: money(sale, total(sale)),
      url, pdfUrl, waLink: `https://wa.me/${phone}?text=${encodeURIComponent(waMessage(sale, url))}`,
      autoSend: wa.configured(), sent: false, sendError: null,
    };
    if (!phone) out.waLink = `https://wa.me/?text=${encodeURIComponent(waMessage(sale, url))}`;
    if (input.send !== false && phone && wa.configured()) {
      try {
        await wa.sendDocument(phone, pdfUrl, `Receipt-${sale.id}.pdf`, waMessage(sale, url));
        out.sent = true;
      } catch (e) {
        out.sendError = e.message;
      }
    }
    json(res, 200, out);
  } catch (e) {
    fail(res, e);
  }
};
