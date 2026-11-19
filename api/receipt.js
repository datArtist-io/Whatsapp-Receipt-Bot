// GET /api/receipt?t=...&format=json|pdf : the receipt behind a signed link.
const token = require("../lib/token");
const { receiptPdf } = require("../lib/pdf");
const { total, money, methodName } = require("../lib/sale");
const { json, fail } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    const q = new URL(req.url, "http://x").searchParams;
    const sale = token.decode(q.get("t") || "");
    if (!sale || sale.v !== 1) return json(res, 404, { error: "This receipt link is not valid." });
    if (q.get("format") === "pdf") {
      const pdf = await receiptPdf(sale);
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `${q.get("download") ? "attachment" : "inline"}; filename="Receipt-${sale.id}.pdf"`);
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      return res.end(pdf);
    }
    json(res, 200, {
      id: sale.id, date: sale.d,
      business: { name: sale.b.n, phone: sale.b.p, address: sale.b.a, currency: sale.b.c },
      customer: { name: sale.c.n, phone: sale.c.p },
      method: sale.m, methodName: methodName(sale.m), reference: sale.r,
      items: sale.i.map(([name, qty, price]) => ({ name, qty, price, priceText: money(sale, price), amountText: money(sale, qty * price) })),
      total: total(sale), totalText: money(sale, total(sale)),
    });
  } catch (e) {
    fail(res, e);
  }
};
