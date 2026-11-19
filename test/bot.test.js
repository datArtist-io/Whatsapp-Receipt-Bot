// The chat bot end to end: a Telegram or WhatsApp message goes in, a scripted stand-in for
// Claude picks tools, records land in an in-memory Postgres, and replies and PDFs go out.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.SLIPP_SECRET = "test-secret-0123456789abcdef";
process.env.TELEGRAM_BOT_TOKEN = "123:test-token";
process.env.TELEGRAM_BOT_USERNAME = "SlippTestBot";
process.env.WHATSAPP_TOKEN = "wa-token";
process.env.WHATSAPP_PHONE_NUMBER_ID = "999";
process.env.WHATSAPP_APP_SECRET = "wa-app-secret";
process.env.WHATSAPP_VERIFY_TOKEN = "verify-me";
process.env.WHATSAPP_NUMBER = "+1 555 000 1111";
process.env.CRON_SECRET = "cron-secret";
process.env.PORT = "0";

const { freshDb } = require("./pg");
const { useClaude } = require("../lib/ai");
const store = require("../lib/store");
const telegram = require("../lib/telegram");

// Everything sent to Telegram and Meta is captured here.
const realFetch = globalThis.fetch;
let outbox = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith("https://api.telegram.org/")) {
    const method = u.split("/").pop();
    outbox.push({ app: "telegram", method, body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ ok: true, result: method === "getMe" ? { username: "SlippTestBot" } : { message_id: 1 } }));
  }
  if (u.startsWith("https://graph.facebook.com/")) {
    outbox.push({ app: "whatsapp", body: JSON.parse(opts.body) });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.out" }] }));
  }
  return realFetch(url, opts);
};

// A stand-in for Claude: each test queues the turns it should produce.
let script = [];
const calls = [];
useClaude({
  model: "test-model",
  client: { messages: { create: async (params) => {
    calls.push(JSON.parse(JSON.stringify(params)));
    const next = script.shift();
    if (!next) return { stop_reason: "end_turn", content: [{ type: "text", text: "(script ran out)" }] };
    return typeof next === "function" ? next(params) : next;
  } } },
});
const say = (text) => ({ stop_reason: "end_turn", content: [{ type: "text", text }] });
let n = 0;
const use = (name, input) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", id: `tu_${++n}`, name, input }] });
const lastToolResult = (params) => JSON.parse(params.messages.at(-1).content[0].content);

let server, base;
before(async () => {
  await freshDb();
  server = require("../dev.js");
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

let updateId = 1000;
const tg = (text, chatId = 501, headers = {}) => realFetch(`${base}/api/telegram`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-telegram-bot-api-secret-token": telegram.webhookSecret(), ...headers },
  body: JSON.stringify({ update_id: ++updateId, message: { message_id: updateId, chat: { id: chatId, type: "private" }, from: { first_name: "Ada" }, text } }),
});
const until = async (fn, ms = 3000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error("timed out waiting");
};
const sentTo = (method) => outbox.filter((o) => o.app === "telegram" && o.method === method);

test("Telegram rejects updates without the webhook secret", async () => {
  const r = await tg("hi", 501, { "x-telegram-bot-api-secret-token": "wrong" });
  assert.equal(r.status, 401);
});

test("a first message creates a business and the assistant saves its name", async () => {
  outbox = [];
  script = [
    (p) => { assert.match(p.system[1].text, /no name yet/); return use("update_business", { name: "Ada Stores", bank: "GTBank · 0123456789 · Ada Stores" }); },
    (p) => { assert.equal(lastToolResult(p).business.name, "Ada Stores"); return say("Welcome, *Ada Stores* is all set."); },
  ];
  assert.equal((await tg("/start")).status, 200);
  const msg = await until(() => sentTo("sendMessage").find((o) => o.body.text.includes("Ada Stores")));
  assert.equal(String(msg.body.chat_id), "501");
  assert.equal(msg.body.text, "Welcome, Ada Stores is all set.", "WhatsApp-style bold is dropped on Telegram");
  assert.equal(calls.at(-2).messages.at(-1).content, "Hi", "/start is passed on as a greeting");
});

test("a sale is recorded, stock goes down and the receipt PDF is sent with a forward button", async () => {
  outbox = [];
  const { business } = await store.chatFor("telegram", "501");
  await store.upsertProduct(business.id, { name: "Rice 50kg", price: 45000, set_stock: 5, low_stock_alert: 3 });
  script = [
    use("create_invoice", { customer_name: "Tunde Bello", customer_phone: "0803 111 2222", items: [{ name: "rice 50kg", qty: 2 }], status: "paid", method: "transfer" }),
    (p) => {
      const r = lastToolResult(p);
      assert.equal(r.recorded.total, "₦90,000");
      assert.deepEqual(r.low_stock, [{ name: "Rice 50kg", stock: 3 }]);
      return say("Recorded R-0001 for Tunde Bello: ₦90,000.");
    },
  ];
  await tg("sold 2 bags of rice to Tunde 0803 111 2222, transfer");
  const doc = await until(() => sentTo("sendDocument")[0]);
  const text = sentTo("sendMessage")[0].body.text;
  assert.match(text, /Recorded R-0001/);
  assert.match(text, /Stock is low: 3 × Rice 50kg left\./);
  assert.match(doc.body.caption, /^Receipt R-0001 · Tunde Bello · ₦90,000\.00$/);
  const button = doc.body.reply_markup.inline_keyboard[0][0];
  assert.equal(button.text, "Send to Tunde");
  assert.match(button.url, /^https:\/\/wa\.me\/2348031112222\?text=Hi%20Tunde/);
  // the PDF link really serves a receipt
  const pdf = await realFetch(doc.body.document.replace(/^https?:\/\/[^/]+/, base));
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  assert.match(pdf.headers.get("content-disposition"), /Receipt-R-0001\.pdf/);
  const products = await store.listProducts(business.id);
  assert.equal(products[0].stock, 3);
});

test("an invoice prints as unpaid with bank details, then marking it paid sends a receipt", async () => {
  outbox = [];
  script = [
    use("create_invoice", { customer_name: "Ngozi", items: [{ name: "Eggs (crate)", qty: 3, price: 4500 }], status: "unpaid", due_in_days: 3 }),
    say("Invoice INV-0002 for Ngozi: ₦13,500, due in 3 days."),
  ];
  await tg("invoice ngozi 3 crates of eggs 4500 each, due in 3 days");
  const inv = await until(() => sentTo("sendDocument")[0]);
  assert.match(inv.body.caption, /^Invoice INV-0002 · Ngozi · ₦13,500\.00$/);
  const t = new URL(inv.body.document).searchParams.get("t");
  const j = await (await realFetch(`${base}/api/receipt?format=json&t=${encodeURIComponent(t)}`)).json();
  assert.equal(j.status, "unpaid");
  assert.equal(j.business.bank, "GTBank · 0123456789 · Ada Stores");
  assert.match(j.due, /^\d{4}-\d{2}-\d{2}$/);

  outbox = [];
  script = [use("mark_invoice_paid", { invoice_number: "2", method: "cash" }), say("INV-0002 is paid. Receipt sent.")];
  await tg("ngozi has paid invoice 2");
  const rec = await until(() => sentTo("sendDocument")[0]);
  assert.match(rec.body.caption, /^Receipt INV-0002 · Ngozi/);
});

test("reports add up sales, expenses and what is owed", async () => {
  outbox = [];
  const { business } = await store.chatFor("telegram", "501");
  await store.createInvoice(business.id, { customer_name: "Musa", items: [{ name: "Oil", qty: 1, price: 5000 }], status: "unpaid" });
  script = [
    use("record_expense", { description: "Diesel", amount: 12000, category: "Fuel" }),
    use("business_report", { period: "month" }),
    (p) => {
      const r = lastToolResult(p);
      assert.equal(r.revenue, "₦103,500");
      assert.equal(r.expenses, "₦12,000");
      assert.equal(r.profit, "₦91,500");
      assert.equal(r.unpaid_total, "₦5,000");
      assert.equal(r.best_sellers[0].name, "Rice 50kg");
      return say("This month: ₦103,500 in sales, ₦12,000 spent, ₦91,500 profit.");
    },
  ];
  await tg("spent 12k on diesel. how much have I made this month?");
  await until(() => sentTo("sendMessage").find((o) => /profit/.test(o.body.text)));
});

test("the assistant sees earlier turns of the conversation", async () => {
  script = [say("ok")];
  outbox = [];
  await tg("thanks");
  await until(() => sentTo("sendMessage")[0]);
  const msgs = calls.at(-1).messages;
  assert.ok(msgs.length >= 8, "history is included");
  assert.equal(msgs[0].role, "user");
  for (let i = 1; i < msgs.length; i++) assert.notEqual(msgs[i].role, msgs[i - 1].role, "turns alternate");
});

test("a message delivered twice is answered once", async () => {
  outbox = [];
  script = [say("one"), say("two")];
  const body = JSON.stringify({ update_id: 777777, message: { message_id: 1, chat: { id: 501, type: "private" }, from: { first_name: "Ada" }, text: "hello" } });
  const h = { "content-type": "application/json", "x-telegram-bot-api-secret-token": telegram.webhookSecret() };
  await realFetch(`${base}/api/telegram`, { method: "POST", headers: h, body });
  await realFetch(`${base}/api/telegram`, { method: "POST", headers: h, body });
  await until(() => sentTo("sendMessage")[0]);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(sentTo("sendMessage").length, 1);
  script = [];
});

test("WhatsApp: verification, signed messages, and linking to the same business", async () => {
  const v = await realFetch(`${base}/api/whatsapp?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=42`);
  assert.equal(await v.text(), "42");
  assert.equal((await realFetch(`${base}/api/whatsapp?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=42`)).status, 403);

  // ask for a connect code on Telegram
  outbox = [];
  script = [use("connect_other_app", {}), say("Tap the button to open Slipp in WhatsApp.")];
  await tg("connect my whatsapp");
  const m = await until(() => sentTo("sendMessage")[0]);
  const url = m.body.reply_markup.inline_keyboard[0][0].url;
  assert.match(url, /^https:\/\/wa\.me\/15550001111\?text=LINK%20/);
  const code = decodeURIComponent(url.split("text=")[1]);

  const send = (text, id) => {
    const raw = JSON.stringify({ entry: [{ changes: [{ value: { contacts: [{ wa_id: "2348099990000", profile: { name: "Ada" } }], messages: [{ from: "2348099990000", id, type: "text", text: { body: text } }] } }] }] });
    const sig = "sha256=" + crypto.createHmac("sha256", "wa-app-secret").update(raw).digest("hex");
    return realFetch(`${base}/api/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": sig }, body: raw });
  };
  const bad = await realFetch(`${base}/api/whatsapp`, { method: "POST", headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=00" }, body: "{}" });
  assert.equal(bad.status, 401);

  outbox = [];
  assert.equal((await send(code, "wamid.a")).status, 200);
  const linked = await until(() => outbox.find((o) => o.app === "whatsapp"));
  assert.equal(linked.body.to, "2348099990000");
  assert.match(linked.body.text.body, /Connected\. This chat now works with Ada Stores/);
  const tgChat = await store.chatFor("telegram", "501");
  const waChat = await store.chatFor("whatsapp", "2348099990000");
  assert.equal(waChat.business.id, tgChat.business.id);

  // a sale on WhatsApp comes back as text, a PDF document and a forward button
  outbox = [];
  script = [use("create_invoice", { items: [{ name: "Rice 50kg", qty: 1 }], status: "paid", method: "cash" }), say("Recorded R-0004: ₦45,000.")];
  await send("sold 1 rice cash", "wamid.b");
  await until(() => outbox.filter((o) => o.app === "whatsapp").length >= 3);
  const [text, document, button] = outbox.filter((o) => o.app === "whatsapp").map((o) => o.body);
  assert.equal(text.type, "text");
  assert.equal(document.type, "document");
  assert.equal(document.document.filename, "Receipt-R-0004.pdf");
  assert.equal(button.type, "interactive");
  assert.equal(button.interactive.action.parameters.display_text, "Send to customer");
});

test("the daily check tells owners about due invoices once, and only Vercel Cron can run it", async () => {
  assert.equal((await realFetch(`${base}/api/cron/daily`)).status, 401);
  const { business } = await store.chatFor("telegram", "501");
  await store.createInvoice(business.id, { customer_name: "Bayo", items: [{ name: "Sugar", qty: 2, price: 1500 }], status: "unpaid", due_in_days: 0 });
  outbox = [];
  const r = await realFetch(`${base}/api/cron/daily`, { headers: { authorization: "Bearer cron-secret" } });
  const out = await r.json();
  assert.equal(out.sent, 1);
  const tgMsg = sentTo("sendMessage")[0];
  assert.match(tgMsg.body.text, /INV-0005 · Bayo · ₦3,000 · due today/);
  assert.match(tgMsg.body.reply_markup.inline_keyboard[0][0].url, /\/app\?login=/);
  assert.ok(outbox.some((o) => o.app === "whatsapp"), "the linked WhatsApp chat wrote within 24 hours, so it hears too");
  outbox = [];
  const again = await (await realFetch(`${base}/api/cron/daily`, { headers: { authorization: "Bearer cron-secret" } })).json();
  assert.equal(again.sent, 0, "not repeated the same day");
});

test("the dashboard: sign in with a chat link, read the books, and act on invoices", async () => {
  const links = require("../lib/links");
  const { business } = await store.chatFor("telegram", "501");
  assert.equal((await realFetch(`${base}/api/dashboard`)).status, 401);
  const bad = await realFetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: "nope" }) });
  assert.equal(bad.status, 401);
  const s = await realFetch(`${base}/api/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: links.loginCode(business.id) }) });
  assert.equal(s.status, 200);
  const cookie = s.headers.get("set-cookie").split(";")[0];
  assert.match(s.headers.get("set-cookie"), /HttpOnly; SameSite=Lax/);
  const d = await (await realFetch(`${base}/api/dashboard?period=all`, { headers: { cookie } })).json();
  assert.equal(d.business.name, "Ada Stores");
  assert.ok(d.invoices.length >= 5);
  assert.ok(d.unpaid.some((i) => i.customer === "Bayo"));
  const post = (body, headers = {}) => realFetch(`${base}/api/dashboard`, { method: "POST", headers: { "content-type": "application/json", cookie, ...headers }, body: JSON.stringify(body) });
  assert.equal((await post({ action: "mark_paid", number: "INV-0005" }, { "content-type": "text/plain" })).status, 405, "only JSON can change things");
  const remind = await (await post({ action: "remind", number: "INV-0005" })).json();
  assert.match(remind.url, /^https:\/\/wa\.me\/\?text=Hi%20Bayo%2C%20a%20friendly%20reminder/);
  const paid = await (await post({ action: "mark_paid", number: "INV-0005", method: "cash" })).json();
  assert.equal(paid.invoice.status, "paid");
  const sale = await (await post({ action: "invoice", status: "paid", customer_name: "Kemi", items: [{ name: "Rice 50kg", qty: 1 }] })).json();
  assert.equal(sale.invoice.total, 45000);
  assert.match(sale.invoice.share, /^https:\/\/wa\.me\//);
  const err = await post({ action: "invoice", status: "paid", items: [{ name: "Mystery", qty: 1 }] });
  assert.equal(err.status, 400);
  assert.match((await err.json()).error, /price of "Mystery"/);
});

test("the website: sign up, chat with Slipp, see the receipt in the chat, sign in again", async () => {
  const post = (path, body, cookie) => realFetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
  const bad = await post("/api/auth", { action: "signup", name: "Ada", business: "", phone: "2348011112222", password: "secret123" });
  assert.equal(bad.status, 400);
  const r = await post("/api/auth", { action: "signup", name: "Kemi Ade", business: "Kemi Foods", phone: "2348011112222", display: "+234 801 111 2222", password: "secret123" });
  assert.equal(r.status, 200);
  const cookie = r.headers.get("set-cookie").split(";")[0];
  assert.equal((await post("/api/auth", { action: "signup", name: "X", business: "Y", phone: "2348011112222", password: "secret123" })).status, 400, "one account per number");

  const first = await (await realFetch(`${base}/api/chat`, { headers: { cookie } })).json();
  assert.equal(first.business.name, "Kemi Foods");
  assert.deepEqual(first.messages, []);

  script = [use("create_invoice", { customer_name: "Bola", items: [{ name: "Puff puff (dozen)", qty: 2, price: 1500 }], status: "paid", method: "cash" }), say("Recorded R-0001 for Bola: ₦3,000.")];
  const reply = await (await post("/api/chat", { text: "sold 2 dozen puff puff to bola, 1500 each, cash" }, cookie)).json();
  assert.equal(reply.text, "Recorded R-0001 for Bola: ₦3,000.");
  assert.equal(reply.documents.length, 1);
  assert.match(reply.documents[0].caption, /^Receipt R-0001 · Bola · ₦3,000\.00$/);
  assert.match(calls.at(-1).system[1].text, /Slipp web app/);

  const again = await (await realFetch(`${base}/api/chat`, { headers: { cookie } })).json();
  assert.equal(again.messages.length, 2);
  assert.equal(again.messages[1].documents[0].caption, reply.documents[0].caption, "receipts stay in the chat history");

  const wrong = await post("/api/auth", { action: "signin", phone: "2348011112222", password: "nope-nope" });
  assert.equal(wrong.status, 400);
  const ok = await post("/api/auth", { action: "signin", phone: "2348011112222", password: "secret123" });
  assert.equal(ok.status, 200);
  const d = await (await realFetch(`${base}/api/dashboard`, { headers: { cookie: ok.headers.get("set-cookie").split(";")[0] } })).json();
  assert.equal(d.business.phone, "+234 801 111 2222");
  assert.equal(d.invoices[0].customer, "Bola");
  assert.equal((await realFetch(`${base}/api/chat`)).status, 401);
});
