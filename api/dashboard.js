// GET /api/dashboard?period=month : everything the dashboard shows.
// POST /api/dashboard : { action, ... } changes made from the dashboard.
const store = require("../lib/store");
const auth = require("../lib/auth");
const links = require("../lib/links");
const { documentFor, botAddresses } = require("../lib/assistant");
const { origin } = require("../lib/sale");
const { json, jsonBody, fail } = require("../lib/http");

const day = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
const inv = (ctx, business, i) => {
  const doc = documentFor(ctx, business, i);
  return {
    number: i.number, status: i.status, customer: i.customer_name, phone: i.customer_phone, total: i.total,
    items: i.items, method: i.method, created: i.created_at, paid: i.paid_at, due: day(i.due_date),
    overdue: i.status === "unpaid" && i.due_date && day(i.due_date) < new Date().toISOString().slice(0, 10),
    url: doc.url, pdf: doc.pdf, share: doc.share.url,
  };
};

async function load(req, bid, period) {
  const business = await store.getBusiness(bid);
  const ctx = { origin: origin(req) };
  const [report, series, invoices, unpaid, customers, products, expenses, chats, bots] = await Promise.all([
    store.report(bid, period), store.series(bid, 6), store.listInvoices(bid, { limit: 50 }), store.listInvoices(bid, { status: "unpaid", limit: 50 }),
    store.findCustomers(bid, "", 100), store.listProducts(bid), store.listExpenses(bid, 50), store.chatsOf(bid), botAddresses(),
  ]);
  const code = links.connectCode(bid);
  const has = new Set(chats.map((c) => c.channel));
  return {
    business: { name: business.name, currency: business.currency, phone: business.phone, address: business.address, bank: business.bank, demo: business.demo },
    report, series,
    invoices: invoices.map((i) => inv(ctx, business, i)),
    unpaid: unpaid.map((i) => inv(ctx, business, i)),
    customers, products,
    expenses: expenses.map((e) => ({ ...e, spent_on: day(e.spent_on) })),
    chats: chats.map((c) => ({ channel: c.channel, name: c.display_name })),
    connect: {
      telegram: !has.has("telegram") && bots.telegram ? `https://t.me/${bots.telegram}?start=${code}` : null,
      whatsapp: !has.has("whatsapp") && bots.whatsapp ? `https://wa.me/${bots.whatsapp}?text=${encodeURIComponent("LINK " + code)}` : null,
    },
  };
}

async function act(req, bid, body) {
  const business = await store.getBusiness(bid);
  const ctx = { origin: origin(req) };
  switch (body.action) {
    case "invoice": {
      const { invoice } = await store.createInvoice(bid, body);
      return { invoice: inv(ctx, business, invoice) };
    }
    case "mark_paid": {
      const { invoice } = await store.markPaid(bid, body.number, body.method);
      return { invoice: inv(ctx, business, invoice) };
    }
    case "remind": {
      const i = await store.findInvoice(bid, body.number);
      if (!i || i.status !== "unpaid") throw new store.UserError("That invoice isn't waiting for payment.");
      const d = inv(ctx, business, i);
      const first = (i.customer_name || "").split(" ")[0];
      const text = `Hi${first ? " " + first : ""}, a friendly reminder about invoice ${i.number} from ${business.name} for ${business.currency}${i.total.toLocaleString("en-US")}${d.due ? `, due ${d.due}` : ""}. Here it is:\n${d.url}`;
      await store.noteReminder(i.id);
      return { url: `https://wa.me/${links.intlPhone(i.customer_phone)}?text=${encodeURIComponent(text)}` };
    }
    case "expense": return { expense: await store.recordExpense(bid, body) };
    case "product": return { product: await store.upsertProduct(bid, body) };
    case "customer": return { customer: await store.saveCustomer(bid, body) };
    case "business": return { business: await store.updateBusiness(bid, body) };
    default: throw new store.UserError("Unknown action.");
  }
}

module.exports = async (req, res) => {
  try {
    const bid = auth.businessId(req);
    if (!bid) return json(res, 401, { error: "Signed out." });
    if (req.method === "GET") {
      const period = new URL(req.url, "http://x").searchParams.get("period") || "month";
      return json(res, 200, await load(req, bid, store.PERIODS[period] ? period : "month"));
    }
    if (req.method !== "POST" || !auth.isJson(req)) return json(res, 405, { error: "Use POST with JSON." });
    json(res, 200, await act(req, bid, await jsonBody(req)));
  } catch (e) {
    fail(res, e);
  }
};
