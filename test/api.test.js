// End-to-end tests of the API against the local server (the same handlers Vercel runs).
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");

process.env.SLIPP_SECRET = "test-secret-0123456789abcdef";
process.env.PAYSTACK_SECRET_KEY = "sk_test_paystack";
process.env.FLUTTERWAVE_SECRET_HASH = "flw-hash";
process.env.BUSINESS_NAME = "Webhook Shop";
process.env.PORT = "0";

// fake Meta's WhatsApp API
const realFetch = globalThis.fetch;
const sentToMeta = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).startsWith("https://graph.facebook.com/")) {
    sentToMeta.push({ url: String(url), body: JSON.parse(opts.body), auth: opts.headers.Authorization });
    if (process.env.META_FAIL) return new Response(JSON.stringify({ error: { code: 131047, message: "Re-engagement message" } }), { status: 400 });
    return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
  }
  return realFetch(url, opts);
};

let server, base;
before(async () => {
  server = require("../dev.js");
  await new Promise((r) => (server.listening ? r() : server.once("listening", r)));
  base = `http://localhost:${server.address().port}`;
});
after(() => server.close());

const sale = (over = {}) => ({
  business: { name: "Mama Tee's Kitchen", phone: "+234 801 000 0000", address: "Ikeja", currency: "₦" },
  customer: { name: "Ada Okafor", phone: "2348012345678" },
  method: "transfer", reference: "TRF-1",
  items: [{ name: "Jollof rice", qty: 2, price: 3500 }, { name: "Zobo", qty: 3, price: 700 }],
  ...over,
});
const post = (path, body, headers = {}) => realFetch(base + path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: typeof body === "string" ? body : JSON.stringify(body) });

test("a sale becomes a signed receipt link, a WhatsApp link, JSON and a PDF", async () => {
  const r = await post("/api/sale", sale());
  assert.equal(r.status, 200);
  const out = await r.json();
  assert.equal(out.total, 9100);
  assert.equal(out.totalText, "₦9,100.00");
  assert.match(out.url, /\/r\/[\w-]+\.[\w-]+$/);
  assert.match(out.waLink, /^https:\/\/wa\.me\/2348012345678\?text=/);
  assert.match(decodeURIComponent(out.waLink), /Hi Ada, thanks for shopping with Mama Tee's Kitchen\. Here is your receipt for ₦9,100\.00:\nhttp/);
  assert.equal(out.sent, false);
  const t = out.url.split("/r/")[1];
  const j = await (await realFetch(`${base}/api/receipt?format=json&t=${encodeURIComponent(t)}`)).json();
  assert.equal(j.business.name, "Mama Tee's Kitchen");
  assert.equal(j.items[0].amountText, "₦7,000.00");
  assert.equal(j.methodName, "Bank transfer");
  assert.equal(j.reference, "TRF-1");
  const pdf = await realFetch(`${base}/api/receipt?format=pdf&t=${encodeURIComponent(t)}`);
  assert.equal(pdf.headers.get("content-type"), "application/pdf");
  const buf = Buffer.from(await pdf.arrayBuffer());
  assert.equal(buf.subarray(0, 5).toString(), "%PDF-");
  assert.ok(buf.length > 2000);
  // the receipt page itself is served for /r/<token>
  const page = await realFetch(out.url.replace(/^https?:\/\/[^/]+/, base));
  assert.match(await page.text(), /Receipt by Slipp/);
});

test("a changed receipt link is rejected", async () => {
  const out = await (await post("/api/sale", sale())).json();
  const t = out.url.split("/r/")[1];
  const [payload, sig] = t.split(".");
  const data = JSON.parse(Buffer.from(payload, "base64url"));
  data.i[0][2] = 1; // try to change a price
  const forged = Buffer.from(JSON.stringify(data)).toString("base64url") + "." + sig;
  assert.equal((await realFetch(`${base}/api/receipt?format=json&t=${encodeURIComponent(forged)}`)).status, 404);
  assert.equal((await realFetch(`${base}/api/receipt?format=json&t=nonsense`)).status, 404);
});

test("bad input gets a clear message", async () => {
  const cases = [
    [sale({ business: { name: " " } }), /business name/],
    [sale({ items: [] }), /at least one item/],
    [sale({ items: [{ name: "Rice", qty: 0, price: 1 }] }), /quantity for "Rice"/],
    [sale({ items: [{ name: "", qty: 1, price: 50 }] }), /needs a name/],
    [sale({ items: [{ name: "Rice", qty: 1, price: -5 }] }), /price for "Rice"/],
  ];
  for (const [body, msg] of cases) {
    const r = await post("/api/sale", body);
    assert.equal(r.status, 400);
    assert.match((await r.json()).error, msg);
  }
  assert.equal((await post("/api/sale", "{not json")).status, 400);
  assert.equal((await realFetch(base + "/api/sale")).status, 405);
});

test("an access code can be required", async () => {
  process.env.SLIPP_KEY = "shop-code";
  try {
    assert.equal((await post("/api/sale", sale())).status, 401);
    assert.equal((await post("/api/sale", sale(), { "x-slipp-key": "wrong" })).status, 401);
    assert.equal((await post("/api/sale", sale(), { "x-slipp-key": "shop-code" })).status, 200);
    assert.equal((await (await realFetch(base + "/api/status")).json()).needsKey, true);
  } finally { delete process.env.SLIPP_KEY; }
});

test("with Cloud API keys, receipts send themselves; a failure falls back to the button", async () => {
  process.env.WHATSAPP_TOKEN = "EAAtoken"; process.env.WHATSAPP_PHONE_NUMBER_ID = "1234";
  try {
    sentToMeta.length = 0;
    const out = await (await post("/api/sale", sale())).json();
    assert.equal(out.sent, true);
    assert.equal(sentToMeta.length, 1);
    const m = sentToMeta[0];
    assert.match(m.url, /\/1234\/messages$/);
    assert.equal(m.auth, "Bearer EAAtoken");
    assert.equal(m.body.to, "2348012345678");
    assert.equal(m.body.type, "document");
    assert.match(m.body.document.link, /\/api\/receipt\?t=.+&format=pdf$/);
    assert.equal(m.body.document.filename, `Receipt-${out.id}.pdf`);
    process.env.META_FAIL = "1";
    const out2 = await (await post("/api/sale", sale())).json();
    assert.equal(out2.sent, false);
    assert.match(out2.sendError, /24 hours/);
    assert.ok(out2.waLink);
    // no phone: nothing is sent automatically
    delete process.env.META_FAIL; sentToMeta.length = 0;
    const out3 = await (await post("/api/sale", sale({ customer: { name: "Walk-in" } }))).json();
    assert.equal(out3.sent, false); assert.equal(sentToMeta.length, 0);
    assert.match(out3.waLink, /^https:\/\/wa\.me\/\?text=/);
  } finally { delete process.env.WHATSAPP_TOKEN; delete process.env.WHATSAPP_PHONE_NUMBER_ID; delete process.env.META_FAIL; }
});

test("Paystack: signed charge.success makes a receipt; bad signatures are refused", async () => {
  const body = JSON.stringify({ event: "charge.success", data: { reference: "PSK-77", amount: 1250000, customer: { first_name: "Bayo", last_name: "Ade", phone: "+234 802 111 2222" }, metadata: { items: [{ name: "Ankara fabric", qty: 2, price: 6250 }] } } });
  const sig = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(body).digest("hex");
  const r = await post("/api/webhooks/paystack", body, { "x-paystack-signature": sig });
  assert.equal(r.status, 200);
  const out = await r.json();
  const t = out.url.split("/r/")[1];
  const j = await (await realFetch(`${base}/api/receipt?format=json&t=${encodeURIComponent(t)}`)).json();
  assert.equal(j.business.name, "Webhook Shop");
  assert.equal(j.customer.name, "Bayo Ade");
  assert.equal(j.customer.phone, "2348021112222");
  assert.equal(j.total, 12500);
  assert.equal(j.methodName, "Paystack");
  assert.equal((await post("/api/webhooks/paystack", body, { "x-paystack-signature": "0".repeat(128) })).status, 401);
  const other = JSON.stringify({ event: "transfer.success", data: {} });
  const r3 = await post("/api/webhooks/paystack", other, { "x-paystack-signature": crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(other).digest("hex") });
  assert.equal(r3.status, 200);
  assert.ok((await r3.json()).ignored);
});

test("Flutterwave: verified successful charge makes a receipt", async () => {
  const body = { event: "charge.completed", data: { status: "successful", tx_ref: "FLW-9", amount: 4500, customer: { name: "Chi Obi", phone_number: "08031234567" } } };
  assert.equal((await post("/api/webhooks/flutterwave", body, { "verif-hash": "wrong" })).status, 401);
  const r = await post("/api/webhooks/flutterwave", body, { "verif-hash": "flw-hash" });
  assert.equal(r.status, 200);
  const t = (await r.json()).url.split("/r/")[1];
  const j = await (await realFetch(`${base}/api/receipt?format=json&t=${encodeURIComponent(t)}`)).json();
  assert.equal(j.items[0].name, "Purchase");
  assert.equal(j.totalText, "₦4,500.00");
  assert.equal(j.reference, "FLW-9");
});

test("the sample receipt and status endpoints work", async () => {
  const r = await realFetch(base + "/api/sample", { redirect: "manual" });
  assert.equal(r.status, 302);
  assert.match(r.headers.get("location"), /^\/r\//);
  const s = await (await realFetch(base + "/api/status")).json();
  assert.equal(s.ready, true); assert.equal(s.autoSend, false); assert.equal(s.paystack, true);
});

test("without SLIPP_SECRET nothing is signed", async () => {
  const keep = process.env.SLIPP_SECRET; delete process.env.SLIPP_SECRET;
  try {
    const r = await post("/api/sale", sale());
    assert.equal(r.status, 500);
    assert.match((await r.json()).error, /SLIPP_SECRET/);
  } finally { process.env.SLIPP_SECRET = keep; }
});
