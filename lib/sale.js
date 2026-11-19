// Turning form input or a payment webhook into a clean, checked sale.
const crypto = require("crypto");

const METHODS = { cash: "Cash", transfer: "Bank transfer", card: "Card", paystack: "Paystack", flutterwave: "Flutterwave" };
const ID_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function newId() {
  const bytes = crypto.randomBytes(6);
  return Array.from(bytes, (b) => ID_CHARS[b % ID_CHARS.length]).join("");
}

const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const phoneDigits = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 15);

class InputError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

/**
 * Validates input and returns the compact sale stored in the receipt link:
 * { v, id, d (ISO date), b: { n, p, a, c }, c: { n, p }, m, r, i: [[name, qty, price]] }
 */
function buildSale(input, now = new Date()) {
  const b = input.business || {};
  const c = input.customer || {};
  const items = Array.isArray(input.items) ? input.items : [];
  const name = clean(b.name, 60);
  if (!name) throw new InputError("Add your business name in Settings first.");
  const rows = [];
  for (const it of items) {
    const n = clean(it && it.name, 60);
    const q = Math.round(Number(it && it.qty));
    const p = Math.round(Number(it && it.price) * 100) / 100;
    if (!n && !p) continue; // empty row
    if (!n) throw new InputError("Every item needs a name.");
    if (!Number.isFinite(q) || q < 1 || q > 9999) throw new InputError(`Check the quantity for "${n}".`);
    if (!Number.isFinite(p) || p < 0 || p > 1e9) throw new InputError(`Check the price for "${n}".`);
    rows.push([n, q, p]);
  }
  if (!rows.length) throw new InputError("Add at least one item.");
  if (rows.length > 40) throw new InputError("A receipt can have up to 40 items.");
  const m = METHODS[input.method] ? input.method : "cash";
  return {
    v: 1,
    id: clean(input.id, 16) || newId(),
    d: now.toISOString(),
    b: { n: name, p: clean(b.phone, 30), a: clean(b.address, 120), c: clean(b.currency, 4) || "₦" },
    c: { n: clean(c.name, 60), p: phoneDigits(c.phone) },
    m,
    r: clean(input.reference, 40),
    i: rows,
  };
}

const total = (sale) => Math.round(sale.i.reduce((s, [, q, p]) => s + q * p, 0) * 100) / 100;
const money = (sale, n) => `${sale.b.c}${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const methodName = (m) => METHODS[m] || m;

function origin(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, "");
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  const proto = req.headers["x-forwarded-proto"] || (/^localhost|^127\./.test(host || "") ? "http" : "https");
  return `${proto}://${host}`;
}

function waMessage(sale, url) {
  const who = sale.c.n ? `Hi ${sale.c.n.split(" ")[0]}, thanks` : "Thanks";
  return `${who} for shopping with ${sale.b.n}. Here is your receipt for ${money(sale, total(sale))}:\n${url}`;
}

module.exports = { buildSale, total, money, methodName, origin, waMessage, newId, InputError, METHODS };
