// The chat assistant: a business owner writes in plain words, Claude decides what to record
// using the tools below, and the reply goes back to WhatsApp or Telegram with any PDFs.
const { claude, Anthropic } = require("./ai");
const store = require("./store");
const token = require("./token");
const links = require("./links");
const { saleFromInvoice, total, money, waMessage } = require("./sale");
const telegram = require("./telegram");
const whatsapp = require("./whatsapp");

const TZ = () => process.env.TZ_RECEIPT || "Africa/Lagos";
const MAX_STEPS = 8;

const SYSTEM = `You are Slipp, a bookkeeping assistant that small business owners use from WhatsApp or Telegram. Many are in Nigeria and write in casual English or Pidgin; understand both and reply in plain, friendly English.

What you do, always through the tools:
- Record sales and make receipts. When the owner says they sold something or a customer paid, call create_invoice with status "paid".
- Make invoices for money still owed. "Invoice Tunde for...", "Tunde will pay later", "on credit" mean status "unpaid".
- Mark invoices paid when the owner says a customer has paid one (mark_invoice_paid sends the receipt).
- Record expenses, manage stock and prices, keep customer details, answer questions about sales, profit, best sellers and who owes money.

Rules:
- Never make up a number. Every figure you state must come from a tool result in this conversation.
- If a price is missing and the product has no saved price, ask for it before creating anything. Don't ask for details you can do without (customer phone, payment method).
- Amounts like "45k" mean 45000 and "1.2m" means 1200000.
- The PDF is sent automatically after create_invoice or mark_invoice_paid, with a button to forward it to the customer. Don't paste links; just confirm what was recorded (number, customer, total, and for invoices the due date).
- Keep replies short: one to four lines. For WhatsApp formatting use *bold* sparingly, no headings, no tables. For lists, one item per line.
- If the business has no name yet, the first thing you do is welcome the owner and ask for their business name (and currency if they are not using Naira), then save it with update_business.
- To open the web dashboard, call dashboard_link. To use Slipp in their other chat app, call connect_other_app.
- If asked for something you can't do (taking payments, sending messages to customers yourself, voice notes, images), say so in one line and offer what you can do.`;

const TOOLS = [
  {
    name: "update_business",
    description: "Save the owner's business details. Only include the fields the owner gave.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        currency: { type: "string", description: "Currency symbol, e.g. ₦, $, £, GH₵, KSh" },
        phone: { type: "string" },
        address: { type: "string" },
        bank: { type: "string", description: "Bank details printed on invoices, e.g. 'GTBank · 0123456789 · Ada Stores'" },
      },
    },
  },
  {
    name: "create_invoice",
    description: "Record a sale. status 'paid' records a sale and makes a receipt; status 'unpaid' makes an invoice for money owed. Leave price out for products with a saved price. Sold quantities come out of stock automatically.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Leave empty for a walk-in customer" },
        customer_phone: { type: "string" },
        items: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, qty: { type: "integer" }, price: { type: "number", description: "Price for one unit" } },
            required: ["name", "qty"],
          },
        },
        status: { type: "string", enum: ["paid", "unpaid"] },
        method: { type: "string", enum: ["cash", "transfer", "card", "pos"], description: "How a paid sale was paid" },
        due_in_days: { type: "integer", description: "For unpaid invoices. Default 7." },
        note: { type: "string", description: "Short note printed on the document" },
      },
      required: ["items", "status"],
    },
  },
  {
    name: "mark_invoice_paid",
    description: "Mark an unpaid invoice as paid and send the receipt. Use list_invoices first if you don't know the number.",
    input_schema: {
      type: "object",
      properties: { invoice_number: { type: "string", description: "e.g. INV-0007, or just 7" }, method: { type: "string", enum: ["cash", "transfer", "card", "pos"] } },
      required: ["invoice_number"],
    },
  },
  {
    name: "list_invoices",
    description: "Recent invoices and receipts, newest first.",
    input_schema: {
      type: "object",
      properties: { status: { type: "string", enum: ["paid", "unpaid"] }, customer: { type: "string" }, limit: { type: "integer" } },
    },
  },
  {
    name: "remind_customer",
    description: "Prepare a friendly payment reminder for an unpaid invoice. The owner gets a button that opens WhatsApp with the reminder ready to send.",
    input_schema: { type: "object", properties: { invoice_number: { type: "string" } }, required: ["invoice_number"] },
  },
  {
    name: "record_expense",
    description: "Record money the business spent.",
    input_schema: {
      type: "object",
      properties: {
        description: { type: "string" },
        amount: { type: "number" },
        category: { type: "string", description: "One or two words, e.g. fuel, rent, stock, transport, salary, data" },
        date: { type: "string", description: "YYYY-MM-DD if not today" },
      },
      required: ["description", "amount"],
    },
  },
  {
    name: "update_product",
    description: "Add a product or change its price or stock. Use stock_change for deliveries (+) or losses (-), set_stock for a count.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        price: { type: "number" },
        stock_change: { type: "integer" },
        set_stock: { type: "integer" },
        low_stock_alert: { type: "integer", description: "Warn when stock falls to this number" },
      },
      required: ["name"],
    },
  },
  {
    name: "list_products",
    description: "Products with prices and stock.",
    input_schema: { type: "object", properties: { low_only: { type: "boolean" } } },
  },
  {
    name: "save_customer",
    description: "Save or update a customer's details.",
    input_schema: {
      type: "object",
      properties: { name: { type: "string" }, phone: { type: "string" }, address: { type: "string" }, notes: { type: "string" } },
      required: ["name"],
    },
  },
  {
    name: "find_customers",
    description: "Look up customers with what they have paid and what they owe. Empty query lists recent customers.",
    input_schema: { type: "object", properties: { query: { type: "string" } } },
  },
  {
    name: "business_report",
    description: "Revenue, expenses, profit, unpaid invoices, best sellers, best customers and average sale for a period. For a custom range give from and to.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: Object.keys(store.PERIODS) },
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
      },
    },
  },
  {
    name: "dashboard_link",
    description: "A sign-in link to the web dashboard, valid for 15 minutes.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "connect_other_app",
    description: "Links that connect the owner's other chat app (WhatsApp or Telegram) to this same business.",
    input_schema: { type: "object", properties: {} },
  },
];

const fmt = (business, n) => `${business.currency || "₦"}${Number(n).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const dayText = (d) => d ? new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "";

// The PDF and the "send to customer" link for an invoice or receipt.
function documentFor(ctx, business, inv) {
  const sale = saleFromInvoice(business, inv);
  const t = token.encode(sale);
  const url = `${ctx.origin}/r/${t}`;
  const unpaid = inv.status === "unpaid";
  const kind = unpaid ? "Invoice" : "Receipt";
  const totalText = money(sale, total(sale));
  const first = (inv.customer_name || "").split(" ")[0];
  const text = unpaid
    ? `Hi${first ? " " + first : ""}, here is your invoice from ${sale.b.n} for ${totalText}${inv.due_date ? `, due ${dayText(inv.due_date)}` : ""}:\n${url}`
    : waMessage(sale, url);
  return {
    pdf: `${ctx.origin}/api/receipt?format=pdf&t=${encodeURIComponent(t)}`,
    url,
    filename: `${kind}-${inv.number}.pdf`,
    caption: `${kind} ${inv.number}${inv.customer_name ? " · " + inv.customer_name : ""} · ${totalText}`,
    share: { label: first ? `Send to ${first}` : "Send to customer", url: `https://wa.me/${links.intlPhone(inv.customer_phone)}?text=${encodeURIComponent(text)}` },
  };
}

const brief = (business, inv) => ({
  number: inv.number,
  status: inv.status,
  customer: inv.customer_name || "walk-in",
  total: fmt(business, inv.total),
  items: inv.items.map(([n, q, p]) => `${q} × ${n} @ ${fmt(business, p)}`),
  date: dayText(inv.created_at),
  ...(inv.status === "unpaid" ? { due: dayText(inv.due_date) } : { paid_on: dayText(inv.paid_at), method: inv.method }),
});

// The bot's own Telegram username and WhatsApp number, from settings or asked once from each app.
let addresses = null;
async function botAddresses() {
  if (addresses) return addresses;
  const out = { telegram: (process.env.TELEGRAM_BOT_USERNAME || "").replace(/^@/, ""), whatsapp: (process.env.WHATSAPP_NUMBER || "").replace(/\D/g, "") };
  if (!out.telegram && telegram.configured()) out.telegram = await telegram.call("getMe", {}).then((m) => m.username).catch(() => "");
  if (!out.whatsapp && whatsapp.configured()) {
    const v = process.env.GRAPH_API_VERSION || "v21.0";
    out.whatsapp = await fetch(`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number`, {
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}` }, signal: AbortSignal.timeout(8000),
    }).then((r) => r.json()).then((j) => String(j.display_phone_number || "").replace(/\D/g, "")).catch(() => "");
  }
  addresses = out;
  return out;
}

async function runTool(ctx, name, input) {
  const bid = ctx.business.id;
  const b = () => ctx.business;
  switch (name) {
    case "update_business": {
      ctx.business = await store.updateBusiness(bid, input);
      const x = ctx.business;
      return { saved: true, business: { name: x.name, currency: x.currency, phone: x.phone, address: x.address, bank: x.bank } };
    }
    case "create_invoice": {
      const { invoice, lowStock } = await store.createInvoice(bid, input);
      ctx.documents.push(documentFor(ctx, b(), invoice));
      for (const l of lowStock) ctx.notes.push(`Stock is low: ${l.stock} × ${l.name} left.`);
      return { recorded: brief(b(), invoice), document_sent: true, low_stock: lowStock };
    }
    case "mark_invoice_paid": {
      const { invoice, already } = await store.markPaid(bid, input.invoice_number, input.method);
      if (!already) ctx.documents.push(documentFor(ctx, b(), invoice));
      return already ? { already_paid: brief(b(), invoice) } : { marked_paid: brief(b(), invoice), receipt_sent: true };
    }
    case "list_invoices": {
      const rows = await store.listInvoices(bid, input);
      return { invoices: rows.map((i) => brief(b(), i)) };
    }
    case "remind_customer": {
      const inv = await store.findInvoice(bid, input.invoice_number);
      if (!inv) return { error: `No invoice ${input.invoice_number}.` };
      if (inv.status === "paid") return { error: `${inv.number} is already paid.` };
      const doc = documentFor(ctx, b(), inv);
      const first = (inv.customer_name || "").split(" ")[0];
      const text = `Hi${first ? " " + first : ""}, a friendly reminder about invoice ${inv.number} from ${b().name} for ${fmt(b(), inv.total)}${inv.due_date ? `, due ${dayText(inv.due_date)}` : ""}. Here it is:\n${doc.url}`;
      ctx.buttons.push({ label: first ? `Remind ${first}` : "Send reminder", url: `https://wa.me/${links.intlPhone(inv.customer_phone)}?text=${encodeURIComponent(text)}` });
      await store.noteReminder(inv.id);
      return { reminder_ready: true, invoice: brief(b(), inv), customer_phone_known: Boolean(inv.customer_phone) };
    }
    case "record_expense": {
      const e = await store.recordExpense(bid, input);
      return { recorded: { description: e.description, amount: fmt(b(), e.amount), category: e.category || "other", date: dayText(e.spent_on) } };
    }
    case "update_product": {
      const p = await store.upsertProduct(bid, input);
      return { saved: { name: p.name, price: p.price == null ? null : fmt(b(), p.price), stock: p.stock, low_stock_alert: p.low_stock } };
    }
    case "list_products": {
      const rows = await store.listProducts(bid, Boolean(input.low_only));
      return { products: rows.map((p) => ({ name: p.name, price: p.price == null ? null : fmt(b(), p.price), stock: p.stock })) };
    }
    case "save_customer": {
      const c = await store.saveCustomer(bid, input);
      return { saved: { name: c.name, phone: c.phone, address: c.address } };
    }
    case "find_customers": {
      const rows = await store.findCustomers(bid, input.query || "");
      return { customers: rows.map((c) => ({ name: c.name, phone: c.phone, invoices: c.invoices, paid: fmt(b(), c.paid_total), owes: fmt(b(), c.owing), last_purchase: dayText(c.last_purchase) })) };
    }
    case "business_report": {
      const r = await store.report(bid, input.period, input.from, input.to);
      const m = (n) => fmt(b(), n);
      return {
        ...r, revenue: m(r.revenue), expenses: m(r.expenses), profit: m(r.profit), average_sale: m(r.average_sale), unpaid_total: m(r.unpaid_total),
        best_sellers: r.best_sellers.map((x) => ({ ...x, amount: m(x.amount) })),
        top_expenses: r.top_expenses.map((x) => ({ ...x, amount: m(x.amount) })),
        best_customers: r.best_customers.map((x) => ({ ...x, amount: m(x.amount) })),
        note: "Revenue counts paid sales by the day they were paid. Profit is revenue minus recorded expenses.",
      };
    }
    case "dashboard_link": {
      ctx.buttons.push({ label: "Open dashboard", url: `${ctx.origin}/app?login=${links.loginCode(bid)}` });
      return { link_sent: true, valid_for: "15 minutes" };
    }
    case "connect_other_app": {
      const code = links.connectCode(bid);
      const out = { valid_for: "30 minutes" };
      const { telegram: tg, whatsapp: wa } = await botAddresses();
      if (ctx.channel !== "telegram" && tg) {
        ctx.buttons.push({ label: "Open in Telegram", url: `https://t.me/${tg}?start=${code}` });
        out.telegram = "button sent";
      }
      if (ctx.channel !== "whatsapp" && wa) {
        ctx.buttons.push({ label: "Open in WhatsApp", url: `https://wa.me/${wa}?text=${encodeURIComponent("LINK " + code)}` });
        out.whatsapp = "button sent";
      }
      if (!out.telegram && !out.whatsapp) out.unavailable = "The other app isn't set up for Slipp yet.";
      return out;
    }
    default:
      return { error: `Unknown tool ${name}` };
  }
}

function context(business, channel) {
  const today = new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: TZ() });
  const lines = [
    `Today is ${today}. The owner is writing ${channel === "web" ? "in the Slipp web app, where receipts show as cards with Open and Send on WhatsApp buttons" : channel === "telegram" ? "on Telegram" : "on WhatsApp"}.`,
    business.name ? `Business: ${business.name}. Currency: ${business.currency}.` : "This business has no name yet: welcome the owner and ask for it.",
    business.name && !business.bank ? "No bank details are saved for invoices yet; if the owner makes an invoice, you may suggest adding them once." : "",
  ];
  return lines.filter(Boolean).join("\n");
}

/**
 * Answers one message from a business owner.
 * Returns { text, documents: [{ pdf, filename, caption, share }], buttons: [{ label, url }] }.
 */
async function reply({ business, chat, channel, text, origin, oidcToken }) {
  const ctx = { business, channel, origin, documents: [], buttons: [], notes: [] };
  const { client, model } = claude(oidcToken);
  const past = await store.history(chat.id);
  const messages = [];
  for (const m of past) {
    // The API needs alternating turns that start with the owner.
    if (!messages.length && m.role !== "user") continue;
    if (messages.length && messages[messages.length - 1].role === m.role) messages[messages.length - 1].content += "\n" + m.content;
    else messages.push({ role: m.role, content: m.content });
  }
  if (messages.length && messages[messages.length - 1].role === "user") messages.push({ role: "assistant", content: "(no reply)" });
  messages.push({ role: "user", content: text });

  let answer = "";
  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.messages.create({
      model,
      max_tokens: 16000,
      system: [{ type: "text", text: SYSTEM }, { type: "text", text: context(ctx.business, channel) }],
      tools: TOOLS,
      // Thinking effort is a Claude setting; other models (Grok, through AI Gateway) skip it.
      ...(/claude/i.test(model) ? { output_config: { effort: "low" } } : {}),
      messages,
    });
    if (res.stop_reason === "refusal") { answer = "Sorry, I can't help with that one."; break; }
    const texts = res.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
    const calls = res.content.filter((c) => c.type === "tool_use");
    if (res.stop_reason !== "tool_use" || !calls.length) { answer = texts; break; }
    messages.push({ role: "assistant", content: res.content });
    const results = [];
    for (const call of calls) {
      let out, isError = false;
      try {
        out = await runTool(ctx, call.name, call.input || {});
      } catch (e) {
        if (!e.userFacing) console.error("tool failed", call.name, e);
        out = { error: e.userFacing ? e.message : "That didn't work. Try again." };
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: call.id, content: JSON.stringify(out), ...(isError ? { is_error: true } : {}) });
    }
    messages.push({ role: "user", content: results });
    if (step === MAX_STEPS - 1) answer = texts || "Done.";
  }
  if (!answer) answer = ctx.documents.length ? "Done." : "Sorry, I didn't get that. Try again?";
  if (ctx.notes.length) answer += "\n\n" + ctx.notes.join("\n");

  await store.remember(chat.id, "user", text);
  const extra = ctx.documents.length || ctx.buttons.length ? { documents: ctx.documents, buttons: ctx.buttons } : null;
  await store.remember(chat.id, "assistant", answer, extra);
  return { text: answer, documents: ctx.documents, buttons: ctx.buttons, business: ctx.business };
}

const TROUBLE = "I'm having trouble thinking right now. Please try again in a minute.";
const isAiError = (e) => e instanceof Anthropic.APIError || e instanceof Anthropic.APIConnectionError;

module.exports = { reply, runTool, documentFor, botAddresses, TOOLS, SYSTEM, TROUBLE, isAiError };
