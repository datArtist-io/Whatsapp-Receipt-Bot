// A clean, narrow PDF receipt, built in memory (nothing is written to disk).
const PDFDocument = require("pdfkit");
const path = require("path");
const { total, money, methodName } = require("./sale");

const FONT = path.join(__dirname, "..", "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "..", "fonts", "DejaVuSans-Bold.ttf");
const GREEN = "#14B86B", INK = "#0F1F17", MUTE = "#6B776F", LINE = "#E2DED3";

function drawLogo(doc, x, y, s) {
  doc.save().translate(x, y).scale(s);
  doc.path("M2.3 27C2.3 13 14 1.5 28 1.2H73C88 1.2 101 13.8 101 29V94L92 104.5L84.5 97.6L77 104.5L69.8 97.6L62.5 104.5L55.3 97.6L48 104.5L40.9 97.6L33.6 104.5L26.3 97.4L5.8 117.4C4.4 118.7 2.3 117.8 2.3 115.8Z").fill(GREEN);
  doc.roundedRect(24, 27.5, 53, 9, 4.5).fill("#FFFFFF");
  doc.roundedRect(24, 46, 32.6, 9, 4.5).fill("#FFFFFF");
  doc.path("M32 72.8L42.8 83L67.5 60.2").lineWidth(9).lineCap("round").lineJoin("round").stroke("#FFFFFF");
  doc.restore();
}

function receiptPdf(sale) {
  return new Promise((resolve, reject) => {
    const W = 300, M = 22;
    const H = 285 + sale.i.length * 18 + (sale.r ? 14 : 0) + (sale.b.a ? 12 : 0) + (sale.b.p ? 12 : 0);
    const doc = new PDFDocument({ size: [W, H], margin: M, info: { Title: `Receipt ${sale.id}`, Author: sale.b.n, Creator: "Slipp" } });
    const chunks = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    doc.registerFont("R", FONT);
    doc.registerFont("B", FONT_BOLD);

    doc.rect(0, 0, W, 6).fill(GREEN);
    let y = 24;
    doc.font("B").fontSize(15).fillColor(INK).text(sale.b.n, M, y, { width: W - 2 * M, align: "center" });
    y = doc.y + 2;
    doc.font("R").fontSize(8).fillColor(MUTE);
    if (sale.b.a) { doc.text(sale.b.a, M, y, { width: W - 2 * M, align: "center" }); y = doc.y; }
    if (sale.b.p) { doc.text(sale.b.p, M, y, { width: W - 2 * M, align: "center" }); y = doc.y; }
    y += 12;

    // paid badge
    const bw = 64;
    doc.roundedRect((W - bw) / 2, y, bw, 18, 9).fill("#E3F5EC");
    doc.font("B").fontSize(8).fillColor("#0C6B42").text("PAID", (W - bw) / 2, y + 5, { width: bw, align: "center", characterSpacing: 1 });
    y += 30;

    const row = (label, value) => {
      doc.font("R").fontSize(8).fillColor(MUTE).text(label, M, y, { width: 90 });
      doc.font("R").fontSize(8).fillColor(INK).text(value, M + 90, y, { width: W - 2 * M - 90, align: "right" });
      y = Math.max(doc.y, y + 11) + 2;
    };
    row("Receipt", sale.id);
    row("Date", new Date(sale.d).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: process.env.TZ_RECEIPT || "Africa/Lagos" }));
    row("Customer", sale.c.n || "Walk-in customer");
    row("Payment", methodName(sale.m));
    if (sale.r) row("Reference", sale.r);

    y += 6;
    doc.moveTo(M, y).lineTo(W - M, y).dash(2, { space: 2 }).lineWidth(0.7).strokeColor(LINE).stroke().undash();
    y += 10;

    for (const [n, q, p] of sale.i) {
      doc.font("R").fontSize(9).fillColor(INK).text(n, M, y, { width: 150 });
      const end = doc.y;
      doc.font("R").fontSize(8).fillColor(MUTE).text(`${q} × ${money(sale, p)}`, M, end, { width: 150 });
      doc.font("B").fontSize(9).fillColor(INK).text(money(sale, q * p), M + 150, y, { width: W - 2 * M - 150, align: "right" });
      y = doc.y > end ? Math.max(doc.y, end + 11) : end + 11;
      y += 5;
    }

    y += 2;
    doc.moveTo(M, y).lineTo(W - M, y).dash(2, { space: 2 }).lineWidth(0.7).strokeColor(LINE).stroke().undash();
    y += 12;
    doc.font("B").fontSize(10).fillColor(INK).text("Total", M, y + 3);
    doc.font("B").fontSize(16).fillColor(INK).text(money(sale, total(sale)), M, y, { width: W - 2 * M, align: "right" });
    y = doc.y + 22;

    doc.font("R").fontSize(8.5).fillColor(INK).text("Thank you for your purchase.", M, y, { width: W - 2 * M, align: "center" });
    y = doc.y + 14;
    drawLogo(doc, W / 2 - 34, y, 0.075);
    doc.font("R").fontSize(6.5).fillColor(MUTE).text("Receipt by Slipp", W / 2 - 22, y + 1.5, { width: 80 });
    doc.end();
  });
}

module.exports = { receiptPdf, drawLogo };
