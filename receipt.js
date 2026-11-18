// receipt.js
// Builds a clean PDF receipt for a sale and saves it to /receipts/<id>.pdf
// Returns the local file path so it can be uploaded to WhatsApp.

const PDFDocument = require("pdfkit");
const fs = require("fs");
const path = require("path");

const RECEIPTS_DIR = path.join(__dirname, "receipts");
if (!fs.existsSync(RECEIPTS_DIR)) fs.mkdirSync(RECEIPTS_DIR);

const BUSINESS_NAME = process.env.BUSINESS_NAME || "Your Business Name";
const BUSINESS_PHONE = process.env.BUSINESS_PHONE || "";
const BUSINESS_ADDRESS = process.env.BUSINESS_ADDRESS || "";
const CURRENCY = process.env.CURRENCY_SYMBOL || "₦";

/**
 * sale = {
 *   id: string,
 *   customerName: string,
 *   customerPhone: string, // in international format e.g. 2348012345678
 *   items: [{ name, qty, price }],
 *   total: number,
 *   paymentMethod: "cash" | "bank_transfer" | "paystack" | "flutterwave",
 *   reference: string,     // transaction ref if online payment
 *   date: Date
 * }
 */
const FONT_REGULAR = path.join(__dirname, "fonts", "DejaVuSans.ttf");
const FONT_BOLD = path.join(__dirname, "fonts", "DejaVuSans-Bold.ttf");

function generateReceiptPDF(sale) {
  return new Promise((resolve, reject) => {
    const filePath = path.join(RECEIPTS_DIR, `${sale.id}.pdf`);
    // Page height scales with number of items + optional reference line, plus
    // a fixed allowance for header/meta/footer. A little trailing white space
    // is fine for a receipt; running out of room is not.
    const estimatedHeight = 260 + sale.items.length * 14 + (sale.reference ? 12 : 0);
    const doc = new PDFDocument({ size: [300, estimatedHeight], margin: 20, autoFirstPage: false });
    doc.addPage();
    doc.registerFont("Regular", FONT_REGULAR);
    doc.registerFont("Bold", FONT_BOLD);

    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    // Header
    doc.font("Bold").fontSize(16).text(BUSINESS_NAME, { align: "center" });
    if (BUSINESS_ADDRESS) doc.font("Regular").fontSize(8).text(BUSINESS_ADDRESS, { align: "center" });
    if (BUSINESS_PHONE) doc.font("Regular").fontSize(8).text(BUSINESS_PHONE, { align: "center" });
    doc.moveDown(0.5);
    doc.font("Bold").fontSize(10).text("RECEIPT", { align: "center" });
    doc.moveDown(0.5);
    doc.moveTo(20, doc.y).lineTo(280, doc.y).stroke();
    doc.moveDown(0.5);

    // Meta info
    doc.font("Regular").fontSize(8);
    doc.text(`Receipt No: ${sale.id}`);
    doc.text(`Date: ${new Date(sale.date).toLocaleString()}`);
    doc.text(`Customer: ${sale.customerName || "Walk-in Customer"}`);
    if (sale.customerPhone) doc.text(`Phone: ${sale.customerPhone}`);
    doc.text(`Payment: ${formatPaymentMethod(sale.paymentMethod)}`);
    if (sale.reference) doc.text(`Reference: ${sale.reference}`);
    doc.moveDown(0.5);
    doc.moveTo(20, doc.y).lineTo(280, doc.y).stroke();
    doc.moveDown(0.5);

    // Items table
    doc.font("Bold").fontSize(8);
    doc.text("Item", 20, doc.y, { continued: true, width: 140 });
    doc.text("Qty", 160, doc.y, { continued: true, width: 40 });
    doc.text("Amount", 210, doc.y, { width: 70, align: "right" });
    doc.moveDown(0.3);
    doc.font("Regular").fontSize(8);

    sale.items.forEach((item) => {
      const lineY = doc.y;
      doc.text(item.name, 20, lineY, { width: 140 });
      doc.text(String(item.qty), 160, lineY, { width: 40 });
      doc.text(formatMoney(item.price * item.qty), 210, lineY, { width: 70, align: "right" });
    });

    doc.moveDown(0.5);
    doc.moveTo(20, doc.y).lineTo(280, doc.y).stroke();
    doc.moveDown(0.5);

    doc.font("Bold").fontSize(11);
    doc.text(`TOTAL: ${formatMoney(sale.total)}`, { align: "right" });
    doc.moveDown(1);

    doc.font("Regular").fontSize(8).text("Thank you for your patronage!", { align: "center" });

    doc.end();

    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

function formatMoney(n) {
  return `${CURRENCY}${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPaymentMethod(m) {
  const map = {
    cash: "Cash",
    bank_transfer: "Bank Transfer",
    paystack: "Card / Paystack",
    flutterwave: "Card / Flutterwave",
  };
  return map[m] || m;
}

module.exports = { generateReceiptPDF, RECEIPTS_DIR };
