// A private demo shop for a visitor who wants to try Slipp without signing up:
// six months of sales, customers, stock and expenses, plus a short chat to continue.
const { query } = require("./db");
const store = require("./store");

const PRODUCTS = [
  ["Rice 50kg", 72000, 22], ["Vegetable Oil 5L", 16500, 40], ["Indomie (carton)", 11800, 45],
  ["Sugar 1kg", 1900, 16], ["Peak Milk tin", 950, 80], ["Semovita 2kg", 3800, 36],
];
const CUSTOMERS = [
  ["Chidi Okonkwo", "08031234567"], ["Ngozi Adeyemi", "08029876543"], ["Mama Bisi", "08055551234"],
  ["Tunde Bakare", "08099887766"], ["Halima Musa", "08124445566"], ["Emeka Obi", "08061112233"],
];

async function backdate(table, id, months, days) {
  const when = `now() - make_interval(months => ${Number(months)}, days => ${Number(days)})`;
  if (table === "invoices") await query(`update slipp.invoices set created_at = ${when}, paid_at = case when status = 'paid' then ${when} end where id = $1`, [id]);
  else await query(`update slipp.expenses set spent_on = (${when})::date where id = $1`, [id]);
}

async function createDemo(documentFor, origin) {
  const r = await query(
    `insert into slipp.businesses (name, owner_name, phone, address, bank, currency, demo)
     values ('Amaka''s Provisions', 'Amaka', '+234 800 000 0001', 'Shop 14, Ogbete Market, Enugu', 'GTBank · 0123456789 · Amaka''s Provisions', '₦', true)
     returning *`);
  const b = r.rows[0];
  for (const [name, price, stock] of PRODUCTS) await store.upsertProduct(b.id, { name, price, set_stock: stock, low_stock_alert: 5 });
  let k = 0;
  for (const m of [5, 4, 3, 2, 1, 0]) {
    const count = 5 + (5 - m) * 2;
    for (let i = 0; i < count; i++) {
      const [cname, cphone] = CUSTOMERS[k % CUSTOMERS.length];
      const [pname, pprice] = PRODUCTS[(k * 7) % PRODUCTS.length];
      k++;
      const { invoice } = await store.createInvoice(b.id, {
        customer_name: cname, customer_phone: cphone, items: [{ name: pname, qty: 1 + (k % 3), price: pprice }],
        status: "paid", method: k % 2 ? "transfer" : "cash",
      });
      const days = m === 0 ? (i * 2) % Math.max(1, new Date().getDate() - 1) : (i * 3) % 25;
      await backdate("invoices", invoice.id, m, days);
    }
    for (const [d, a, cat] of [["Shop rent", 45000, "rent"], ["Generator fuel", 18000, "fuel"], ["Transport to market", 9000, "transport"]]) {
      const e = await store.recordExpense(b.id, { description: d, amount: a + m * 1500, category: cat });
      await backdate("expenses", e.id, m, m === 0 ? 0 : 3);
    }
  }
  const owed1 = await store.createInvoice(b.id, { customer_name: "Ngozi Adeyemi", customer_phone: "08029876543", items: [{ name: "Rice 50kg", qty: 1 }, { name: "Vegetable Oil 5L", qty: 2 }], status: "unpaid", due_in_days: 0 });
  await query(`update slipp.invoices set due_date = due_date - 4, created_at = now() - interval '9 days' where id = $1`, [owed1.invoice.id]);
  await store.createInvoice(b.id, { customer_name: "Emeka Obi", customer_phone: "08061112233", items: [{ name: "Indomie (carton)", qty: 3 }], status: "unpaid", due_in_days: 5 });
  // Restock so the stock page looks like a running shop, with one item running low.
  for (const [name, , stock] of PRODUCTS) await store.upsertProduct(b.id, { name, set_stock: name === "Sugar 1kg" ? 4 : stock });

  const chat = await store.webChat(b.id);
  const business = await store.getBusiness(b.id);
  const sale = (await store.createInvoice(b.id, { customer_name: "Chidi Okonkwo", customer_phone: "08031234567", items: [{ name: "Rice 50kg", qty: 2 }], status: "paid", method: "transfer" })).invoice;
  const doc = documentFor({ origin }, business, sale);
  const lines = [
    ["user", "Chidi took 2 bags of rice, paid by transfer", null],
    ["assistant", `Recorded receipt *${sale.number}* for ${sale.customer_name}: *₦${sale.total.toLocaleString("en-US")}*.`, { documents: [doc], buttons: [] }],
    ["user", "Who still owes me?", null],
    ["assistant", "Two people:\n• Ngozi Adeyemi, *₦105,000*, 4 days overdue\n• Emeka Obi, *₦35,400*, due in 5 days\nSay \"remind Ngozi\" and I'll get a reminder ready.", null],
  ];
  for (const [role, text, extra] of lines) await store.remember(chat.id, role, text, extra);
  return business;
}

// Demo shops older than a day go, with everything in them.
async function cleanup() {
  const r = await query(`delete from slipp.businesses where (demo and created_at < now() - interval '1 day')
     or (name = 'Slipp Test Shop' and owner_name = 'Test Owner') returning id`);
  return r.rows.length;
}

module.exports = { createDemo, cleanup };
