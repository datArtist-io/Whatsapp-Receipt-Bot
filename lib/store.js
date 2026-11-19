// Everything Slipp reads and writes in the database.
const { query } = require("./db");

const TZ = () => process.env.TZ_RECEIPT || "Africa/Lagos";
const num = (v) => (v == null ? null : Number(v));
const clean = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
const digits = (v) => String(v ?? "").replace(/\D/g, "").slice(0, 15);
const intOrNull = (v) => (v == null || v === "" || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));
const round2 = (n) => Math.round(Number(n) * 100) / 100;

class UserError extends Error {
  constructor(msg) { super(msg); this.status = 400; this.userFacing = true; }
}

// ---------- chats and businesses ----------

async function chatFor(channel, address, displayName = "") {
  const found = await query(
    `select c.*, row_to_json(b) as business from slipp.chats c join slipp.businesses b on b.id = c.business_id
     where c.channel = $1 and c.address = $2`, [channel, String(address)]);
  if (found.rows[0]) {
    const chat = found.rows[0];
    await query(`update slipp.chats set last_inbound_at = now(), display_name = coalesce(nullif($2, ''), display_name) where id = $1`, [chat.id, clean(displayName, 60)]);
    return { chat, business: chat.business, isNew: false };
  }
  const b = await query(`insert into slipp.businesses default values returning *`);
  const c = await query(
    `insert into slipp.chats (business_id, channel, address, display_name, last_inbound_at) values ($1, $2, $3, $4, now())
     on conflict (channel, address) do update set last_inbound_at = now() returning *`,
    [b.rows[0].id, channel, String(address), clean(displayName, 60)]);
  if (c.rows[0].business_id !== b.rows[0].id) { // lost a race with a duplicate delivery
    await query(`delete from slipp.businesses where id = $1`, [b.rows[0].id]);
    return chatFor(channel, address, displayName);
  }
  return { chat: c.rows[0], business: b.rows[0], isNew: true };
}

async function getBusiness(id) {
  const r = await query(`select * from slipp.businesses where id = $1`, [id]);
  return r.rows[0] || null;
}

async function updateBusiness(id, f) {
  const sets = [], vals = [id];
  const add = (col, v, max) => { if (v != null && String(v).trim() !== "") { vals.push(clean(v, max)); sets.push(`${col} = $${vals.length}`); } };
  add("name", f.name, 60);
  add("currency", f.currency, 4);
  add("phone", f.phone, 30);
  add("address", f.address, 120);
  add("bank", f.bank, 120);
  if (!sets.length) return getBusiness(id);
  const r = await query(`update slipp.businesses set ${sets.join(", ")} where id = $1 returning *`, vals);
  return r.rows[0];
}

// Moves a chat onto another business (used to connect a second app to the same business).
async function linkChat(channel, address, businessId, displayName = "") {
  const old = await query(`select business_id from slipp.chats where channel = $1 and address = $2`, [channel, String(address)]);
  await query(
    `insert into slipp.chats (business_id, channel, address, display_name, last_inbound_at) values ($1, $2, $3, $4, now())
     on conflict (channel, address) do update set business_id = excluded.business_id, last_inbound_at = now()`,
    [businessId, channel, String(address), clean(displayName, 60)]);
  const prev = old.rows[0] && old.rows[0].business_id;
  if (prev && prev !== businessId) {
    // Remove the old business only if it was an empty one made by saying hello.
    await query(
      `delete from slipp.businesses b where b.id = $1 and b.name = ''
         and not exists (select 1 from slipp.chats where business_id = b.id)
         and not exists (select 1 from slipp.invoices where business_id = b.id)`, [prev]);
  }
}

async function chatsOf(businessId) {
  const r = await query(`select channel, address, display_name, last_inbound_at from slipp.chats where business_id = $1 order by created_at`, [businessId]);
  return r.rows;
}

// ---------- website accounts ----------

const crypto = require("crypto");
const scrypt = (pw, salt) => new Promise((ok, no) => crypto.scrypt(pw, salt, 32, (e, k) => (e ? no(e) : ok(k))));

async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(pw, salt);
  return ["s1", salt.toString("base64"), key.toString("base64")].join(":");
}

async function checkPassword(pw, stored) {
  const [v, salt, hash] = String(stored || "").split(":");
  if (v !== "s1" || !salt || !hash) return false;
  const got = await scrypt(pw, Buffer.from(salt, "base64"));
  const want = Buffer.from(hash, "base64");
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

async function createAccount({ ownerName, businessName, phone, display, password, currency }) {
  const owner = clean(ownerName, 60), name = clean(businessName, 60), p = digits(phone);
  if (!owner) throw new UserError("Add your name.");
  if (!name) throw new UserError("Add your business name.");
  if (p.length < 8) throw new UserError("Check your phone number.");
  if (String(password || "").length < 6) throw new UserError("Use a password of at least 6 characters.");
  const taken = await query(`select 1 from slipp.businesses where login_phone = $1`, [p]);
  if (taken.rows.length) throw new UserError("That number already has an account. Sign in instead.");
  const r = await query(
    `insert into slipp.businesses (name, owner_name, login_phone, password_hash, phone, currency) values ($1, $2, $3, $4, $5, $6) returning *`,
    [name, owner, p, await hashPassword(String(password)), clean(display, 30) || "+" + p, clean(currency, 4) || "₦"]);
  return r.rows[0];
}

async function signIn(phone, password) {
  const r = await query(`select * from slipp.businesses where login_phone = $1`, [digits(phone)]);
  const b = r.rows[0];
  if (!b || !(await checkPassword(String(password || ""), b.password_hash))) throw new UserError("That number and password don't match.");
  return b;
}

// The business's chat in the web app, made the first time it's needed.
async function webChat(bid) {
  await query(`insert into slipp.chats (business_id, channel, address) values ($1, 'web', $2) on conflict (channel, address) do nothing`, [bid, String(bid)]);
  const r = await query(`select * from slipp.chats where channel = 'web' and address = $1`, [String(bid)]);
  return r.rows[0];
}

// The conversation as the web app shows it, with the receipts and buttons that came with replies.
async function transcript(chatId, limit = 60) {
  const r = await query(`select id, role, content, extra, created_at from slipp.messages where chat_id = $1 order by id desc limit $2`, [chatId, limit]);
  return r.rows.reverse();
}

// How many messages an owner sent in the last day, to keep one account from running up the AI bill.
async function sentToday(chatId) {
  const r = await query(`select count(*)::int as n from slipp.messages where chat_id = $1 and role = 'user' and created_at > now() - interval '1 day'`, [chatId]);
  return r.rows[0].n;
}

// ---------- customers ----------

async function saveCustomer(bid, c) {
  const name = clean(c.name, 60);
  if (!name) throw new UserError("A customer needs a name.");
  const r = await query(
    `insert into slipp.customers (business_id, name, phone, address, notes) values ($1, $2, $3, $4, $5)
     on conflict (business_id, lower(name)) do update set
       phone = coalesce(nullif(excluded.phone, ''), slipp.customers.phone),
       address = coalesce(nullif(excluded.address, ''), slipp.customers.address),
       notes = coalesce(nullif(excluded.notes, ''), slipp.customers.notes)
     returning *`,
    [bid, name, digits(c.phone), clean(c.address, 160), clean(c.notes, 300)]);
  return r.rows[0];
}

async function findCustomers(bid, q = "", limit = 20) {
  const r = await query(
    `select c.name, c.phone, c.address, c.notes,
            count(i.id)::int as invoices,
            coalesce(sum(i.total) filter (where i.status = 'paid'), 0) as paid_total,
            coalesce(sum(i.total) filter (where i.status = 'unpaid'), 0) as owing,
            max(i.created_at) as last_purchase
     from slipp.customers c left join slipp.invoices i on i.customer_id = c.id
     where c.business_id = $1 and ($2 = '' or c.name ilike '%' || $2 || '%' or c.phone like '%' || $2 || '%')
     group by c.id order by max(i.created_at) desc nulls last, c.name limit $3`,
    [bid, clean(q, 60), limit]);
  return r.rows.map((x) => ({ ...x, paid_total: num(x.paid_total), owing: num(x.owing) }));
}

// ---------- products and stock ----------

async function upsertProduct(bid, p) {
  const name = clean(p.name, 60);
  if (!name) throw new UserError("A product needs a name.");
  const price = p.price == null || p.price === "" ? null : round2(p.price);
  if (price != null && (!(price >= 0) || price > 1e9)) throw new UserError(`Check the price for "${name}".`);
  const r = await query(
    `insert into slipp.products (business_id, name, price, stock, low_stock) values ($1, $2, $3, coalesce($4::int, $6::int), coalesce($5, 3))
     on conflict (business_id, lower(name)) do update set
       price = coalesce($3, slipp.products.price),
       stock = case when $4::int is not null then $4::int
                    when $6::int is not null then coalesce(slipp.products.stock, 0) + $6::int
                    else slipp.products.stock end,
       low_stock = coalesce($5, slipp.products.low_stock)
     returning *`,
    [bid, name, price, intOrNull(p.set_stock), intOrNull(p.low_stock_alert), intOrNull(p.stock_change)]);
  const row = r.rows[0];
  if (row.stock != null && row.stock > row.low_stock && row.low_alerted) {
    await query(`update slipp.products set low_alerted = false where id = $1`, [row.id]);
  }
  return { ...row, price: num(row.price) };
}

async function listProducts(bid, lowOnly = false) {
  const r = await query(
    `select name, price, stock, low_stock from slipp.products where business_id = $1
     and (not $2 or (stock is not null and stock <= low_stock)) order by lower(name) limit 200`, [bid, lowOnly]);
  return r.rows.map((x) => ({ ...x, price: num(x.price) }));
}

// ---------- invoices and receipts ----------

async function createInvoice(bid, input) {
  const rawItems = Array.isArray(input.items) ? input.items : [];
  if (!rawItems.length) throw new UserError("Add at least one item.");
  if (rawItems.length > 40) throw new UserError("An invoice can have up to 40 items.");
  const known = await query(`select id, name, price, stock from slipp.products where business_id = $1 and lower(name) = any($2)`,
    [bid, rawItems.map((i) => clean(i && i.name, 60).toLowerCase())]);
  const byName = new Map(known.rows.map((p) => [p.name.toLowerCase(), p]));
  const items = rawItems.map((it) => {
    const name = clean(it && it.name, 60);
    if (!name) throw new UserError("Every item needs a name.");
    const qty = Math.round(Number(it.qty ?? 1));
    if (!(qty >= 1 && qty <= 9999)) throw new UserError(`Check the quantity for "${name}".`);
    const prod = byName.get(name.toLowerCase());
    const price = it.price == null || it.price === "" ? num(prod && prod.price) : round2(it.price);
    if (price == null) throw new UserError(`What is the price of "${name}"?`);
    if (!(price >= 0 && price <= 1e9)) throw new UserError(`Check the price for "${name}".`);
    return [prod ? prod.name : name, qty, price];
  });
  const total = round2(items.reduce((s, [, q, p]) => s + q * p, 0));
  const status = input.status === "unpaid" ? "unpaid" : "paid";
  let customer = null;
  if (clean(input.customer_name, 60)) customer = await saveCustomer(bid, { name: input.customer_name, phone: input.customer_phone });
  const seq = await query(`update slipp.businesses set invoice_seq = invoice_seq + 1 where id = $1 returning invoice_seq`, [bid]);
  const number = `${status === "paid" ? "R" : "INV"}-${String(seq.rows[0].invoice_seq).padStart(4, "0")}`;
  const due = status === "unpaid" ? Math.max(0, Math.min(365, Math.round(Number(input.due_in_days ?? 7)))) : null;
  const r = await query(
    `insert into slipp.invoices (business_id, number, customer_id, customer_name, customer_phone, items, total, status, method, note, due_date, paid_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, case when $11::int is null then null else (now() at time zone $12)::date + $11::int end,
             case when $8 = 'paid' then now() end)
     returning *`,
    [bid, number, customer && customer.id, customer ? customer.name : clean(input.customer_name, 60),
     customer ? customer.phone || digits(input.customer_phone) : digits(input.customer_phone),
     JSON.stringify(items), total, status, status === "paid" ? clean(input.method, 20) || "cash" : "", clean(input.note, 200), due, TZ()]);
  // Take sold items out of stock and note anything that is now running low.
  const low = [];
  for (const [name, qty] of items) {
    const p = byName.get(name.toLowerCase());
    if (!p || p.stock == null) continue;
    const u = await query(
      `update slipp.products set stock = greatest(stock - $2, 0) where id = $1 returning name, stock, low_stock, low_alerted`, [p.id, qty]);
    const row = u.rows[0];
    if (row && row.stock <= row.low_stock && !row.low_alerted) {
      low.push({ name: row.name, stock: row.stock });
      await query(`update slipp.products set low_alerted = true where id = $1`, [p.id]);
    }
  }
  return { invoice: invRow(r.rows[0]), lowStock: low };
}

function invRow(r) {
  if (!r) return null;
  return { ...r, total: num(r.total), items: typeof r.items === "string" ? JSON.parse(r.items) : r.items };
}

async function findInvoice(bid, number) {
  const n = clean(number, 20).toUpperCase().replace(/\s+/g, "");
  const r = await query(
    `select * from slipp.invoices where business_id = $1 and (upper(number) = $2 or upper(number) like '%-' || lpad(regexp_replace($2, '\\D', '', 'g'), 4, '0'))
     order by (upper(number) = $2) desc, created_at desc limit 1`, [bid, n]);
  return invRow(r.rows[0]);
}

async function markPaid(bid, number, method) {
  const inv = await findInvoice(bid, number);
  if (!inv) throw new UserError(`I couldn't find invoice ${number}.`);
  if (inv.status === "paid") return { invoice: inv, already: true };
  const r = await query(`update slipp.invoices set status = 'paid', paid_at = now(), method = $2 where id = $1 returning *`,
    [inv.id, clean(method, 20) || "transfer"]);
  return { invoice: invRow(r.rows[0]), already: false };
}

async function listInvoices(bid, f = {}) {
  const r = await query(
    `select * from slipp.invoices where business_id = $1
       and ($2 = '' or status = $2)
       and ($3 = '' or customer_name ilike '%' || $3 || '%')
     order by created_at desc limit $4`,
    [bid, ["paid", "unpaid"].includes(f.status) ? f.status : "", clean(f.customer, 60), Math.min(50, Math.max(1, Number(f.limit) || 10))]);
  return r.rows.map(invRow);
}

async function noteReminder(id) {
  await query(`update slipp.invoices set reminded_at = now() where id = $1`, [id]);
}

// ---------- expenses ----------

async function recordExpense(bid, e) {
  const description = clean(e.description, 120);
  const amount = round2(e.amount);
  if (!description) throw new UserError("What was the expense for?");
  if (!(amount > 0 && amount <= 1e9)) throw new UserError("Check the expense amount.");
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(e.date || "")) ? e.date : null;
  const r = await query(
    `insert into slipp.expenses (business_id, description, category, amount, spent_on)
     values ($1, $2, $3, $4, coalesce($5::date, (now() at time zone $6)::date)) returning *`,
    [bid, description, clean(e.category, 30).toLowerCase(), amount, date, TZ()]);
  return { ...r.rows[0], amount: num(r.rows[0].amount) };
}

async function listExpenses(bid, limit = 20) {
  const r = await query(`select description, category, amount, spent_on from slipp.expenses where business_id = $1 order by spent_on desc, created_at desc limit $2`, [bid, limit]);
  return r.rows.map((x) => ({ ...x, amount: num(x.amount) }));
}

// ---------- reports ----------

const PERIODS = {
  today: ["date_trunc('day', l)", "date_trunc('day', l) + interval '1 day'"],
  yesterday: ["date_trunc('day', l) - interval '1 day'", "date_trunc('day', l)"],
  week: ["date_trunc('week', l)", "date_trunc('week', l) + interval '1 week'"],
  last_week: ["date_trunc('week', l) - interval '1 week'", "date_trunc('week', l)"],
  month: ["date_trunc('month', l)", "date_trunc('month', l) + interval '1 month'"],
  last_month: ["date_trunc('month', l) - interval '1 month'", "date_trunc('month', l)"],
  year: ["date_trunc('year', l)", "date_trunc('year', l) + interval '1 year'"],
  all: ["timestamp '2000-01-01'", "timestamp '2100-01-01'"],
};

async function report(bid, period = "month", from, to) {
  let range;
  const day = /^\d{4}-\d{2}-\d{2}$/;
  if (day.test(String(from || "")) && day.test(String(to || ""))) {
    range = await query(`select $1::timestamp as s, $2::timestamp + interval '1 day' as e`, [from, to]);
    period = `${from} to ${to}`;
  } else {
    const [s, e] = PERIODS[period] || PERIODS.month;
    if (!PERIODS[period]) period = "month";
    range = await query(`select ${s} as s, ${e} as e from (select now() at time zone $1 as l) t`, [TZ()]);
  }
  const { s, e } = range.rows[0];
  const args = [bid, s, e, TZ()];
  const inPeriod = `(created_at at time zone $4) >= $2 and (created_at at time zone $4) < $3`;
  const paidIn = `(paid_at at time zone $4) >= $2 and (paid_at at time zone $4) < $3`;
  const [sales, owing, exp, top, cats, best] = await Promise.all([
    query(`select coalesce(sum(total), 0) as revenue, count(*)::int as count, count(distinct nullif(lower(customer_name), ''))::int as customers
           from slipp.invoices where business_id = $1 and status = 'paid' and ${paidIn}`, args),
    query(`select coalesce(sum(total), 0) as owing, count(*)::int as count,
                  count(*) filter (where due_date < (now() at time zone $4)::date)::int as overdue
           from slipp.invoices where business_id = $1 and status = 'unpaid' and ${inPeriod}`, args),
    query(`select coalesce(sum(amount), 0) as total from slipp.expenses where business_id = $1 and spent_on >= $2::date and spent_on < $3::date`, args.slice(0, 3)),
    query(`select item->>0 as name, sum((item->>1)::int)::int as qty, sum((item->>1)::numeric * (item->>2)::numeric) as amount
           from slipp.invoices, jsonb_array_elements(items) item
           where business_id = $1 and status = 'paid' and ${paidIn} group by 1 order by 3 desc limit 5`, args),
    query(`select coalesce(nullif(category, ''), 'other') as category, sum(amount) as amount from slipp.expenses
           where business_id = $1 and spent_on >= $2::date and spent_on < $3::date group by 1 order by 2 desc limit 5`, args.slice(0, 3)),
    query(`select customer_name as name, sum(total) as amount, count(*)::int as count from slipp.invoices
           where business_id = $1 and status = 'paid' and customer_name <> '' and ${paidIn} group by 1 order by 2 desc limit 3`, args),
  ]);
  const revenue = num(sales.rows[0].revenue), expenses = num(exp.rows[0].total);
  const count = sales.rows[0].count;
  return {
    period,
    from: new Date(s).toISOString().slice(0, 10),
    to: new Date(new Date(e).getTime() - 1).toISOString().slice(0, 10),
    revenue, expenses, profit: round2(revenue - expenses),
    paid_sales: count,
    customers: sales.rows[0].customers,
    average_sale: count ? round2(revenue / count) : 0,
    unpaid_total: num(owing.rows[0].owing), unpaid_count: owing.rows[0].count, overdue_count: owing.rows[0].overdue,
    best_sellers: top.rows.map((x) => ({ name: x.name, qty: x.qty, amount: num(x.amount) })),
    top_expenses: cats.rows.map((x) => ({ category: x.category, amount: num(x.amount) })),
    best_customers: best.rows.map((x) => ({ name: x.name, amount: num(x.amount), count: x.count })),
  };
}

// Revenue and expenses per day or month, for the dashboard chart.
async function series(bid, months = 6) {
  const r = await query(
    `with m as (select generate_series(date_trunc('month', now() at time zone $3) - ($2 - 1) * interval '1 month',
                                       date_trunc('month', now() at time zone $3), interval '1 month') as month)
     select to_char(m.month, 'YYYY-MM') as month,
       (select coalesce(sum(total), 0) from slipp.invoices where business_id = $1 and status = 'paid'
          and date_trunc('month', paid_at at time zone $3) = m.month) as revenue,
       (select coalesce(sum(amount), 0) from slipp.expenses where business_id = $1 and date_trunc('month', spent_on) = m.month) as expenses
     from m order by m.month`, [bid, months, TZ()]);
  return r.rows.map((x) => ({ month: x.month, revenue: num(x.revenue), expenses: num(x.expenses) }));
}

// ---------- conversation memory and duplicate deliveries ----------

async function history(chatId, limit = 16) {
  const r = await query(`select role, content from slipp.messages where chat_id = $1 order by id desc limit $2`, [chatId, limit]);
  return r.rows.reverse();
}

async function remember(chatId, role, content, extra = null) {
  await query(`insert into slipp.messages (chat_id, role, content, extra) values ($1, $2, $3, $4)`,
    [chatId, role, String(content).slice(0, 4000), extra ? JSON.stringify(extra) : null]);
}

async function forget(chatId) {
  await query(`delete from slipp.messages where chat_id = $1`, [chatId]);
}

async function firstTime(key) {
  const r = await query(`insert into slipp.seen_updates (key) values ($1) on conflict do nothing returning key`, [String(key).slice(0, 200)]);
  if (Math.random() < 0.02) await query(`delete from slipp.seen_updates where created_at < now() - interval '3 days'`);
  return r.rows.length === 1;
}

// ---------- daily check ----------

// Unpaid invoices that are due or overdue and haven't been mentioned to the owner in 3 days.
async function dueInvoices() {
  const r = await query(
    `select i.*, b.name as business_name, b.currency from slipp.invoices i join slipp.businesses b on b.id = i.business_id
     where i.status = 'unpaid' and i.due_date <= (now() at time zone $1)::date
       and (i.reminded_at is null or i.reminded_at < now() - interval '3 days')
     order by i.business_id, i.due_date limit 500`, [TZ()]);
  return r.rows.map(invRow);
}

module.exports = {
  UserError, createAccount, signIn, webChat, transcript, sentToday, chatFor, getBusiness, updateBusiness, linkChat, chatsOf,
  saveCustomer, findCustomers, upsertProduct, listProducts,
  createInvoice, findInvoice, markPaid, listInvoices, noteReminder,
  recordExpense, listExpenses, report, series, PERIODS,
  history, remember, forget, firstTime, dueInvoices,
};
