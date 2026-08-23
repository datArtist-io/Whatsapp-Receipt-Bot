require("dotenv").config();
const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { nanoid } = require("nanoid");

const { generateReceiptPDF } = require("./receipt");
const { sendReceiptDocument } = require("./whatsapp");

const app = express();

// Paystack sends raw JSON that we need for signature verification, so capture rawBody.
app.use(
  express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 3000;

// In-memory sale log for this simple starter (swap for a real database later)
const sales = [];

// ---------------------------------------------------------------------------
// Core: build receipt + send on WhatsApp. Used by every entry point below.
// ---------------------------------------------------------------------------
async function processSale({ customerName, customerPhone, items, paymentMethod, reference }) {
  const total = items.reduce((sum, it) => sum + it.price * it.qty, 0);
  const sale = {
    id: nanoid(8),
    customerName,
    customerPhone: normalizePhone(customerPhone),
    items,
    total,
    paymentMethod,
    reference: reference || "",
    date: new Date(),
  };

  sales.push(sale);

  const filePath = await generateReceiptPDF(sale);

  if (!sale.customerPhone) {
    console.warn(`Sale ${sale.id}: no customer phone supplied, receipt generated but not sent.`);
    return { sale, sent: false };
  }

  try {
    await sendReceiptDocument(
      sale.customerPhone,
      filePath,
      `receipt-${sale.id}.pdf`,
      `Hi ${customerName || "there"}, thanks for your purchase! Your receipt is attached.`
    );
    return { sale, sent: true };
  } catch (err) {
    console.error(`Sale ${sale.id}: WhatsApp send failed:`, err.response?.data || err.message);
    return { sale, sent: false, error: err.response?.data || err.message };
  }
}

function normalizePhone(phone) {
  if (!phone) return "";
  // Strip spaces, dashes, leading +. WhatsApp wants e.g. "2348012345678".
  return String(phone).replace(/[^\d]/g, "");
}

// ---------------------------------------------------------------------------
// 1. Manual entry (cash / bank transfer) — you tap "Paid", everything else
//    (receipt + WhatsApp send) happens automatically.
// ---------------------------------------------------------------------------
app.post("/api/sale", async (req, res) => {
  try {
    const { customerName, customerPhone, items, paymentMethod, reference } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: "items[] is required" });
    }
    const result = await processSale({ customerName, customerPhone, items, paymentMethod, reference });
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process sale" });
  }
});

app.get("/api/sales", (req, res) => {
  res.json(sales);
});

// ---------------------------------------------------------------------------
// 2. Paystack webhook — fires automatically the instant an online payment
//    succeeds. No action needed from you.
//    Set this URL in Paystack Dashboard > Settings > API Keys & Webhooks
// ---------------------------------------------------------------------------
app.post("/api/webhook/paystack", async (req, res) => {
  const signature = req.headers["x-paystack-signature"];
  const expected = crypto
    .createHmac("sha512", process.env.PAYSTACK_SECRET_KEY || "")
    .update(req.rawBody)
    .digest("hex");

  if (signature !== expected) {
    console.warn("Paystack webhook: invalid signature");
    return res.sendStatus(401);
  }

  const event = req.body;

  // Always respond 200 fast; Paystack retries if you don't.
  res.sendStatus(200);

  if (event.event === "charge.success") {
    const data = event.data;
    const customerName = data.customer?.first_name
      ? `${data.customer.first_name} ${data.customer.last_name || ""}`.trim()
      : data.customer?.email;
    const customerPhone = data.customer?.phone || data.metadata?.phone; // pass phone in metadata at checkout
    const items = data.metadata?.items || [
      { name: data.metadata?.description || "Purchase", qty: 1, price: data.amount / 100 },
    ];

    await processSale({
      customerName,
      customerPhone,
      items,
      paymentMethod: "paystack",
      reference: data.reference,
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Flutterwave webhook — same idea, fires on successful charge.
//    Set this URL in Flutterwave Dashboard > Settings > Webhooks
// ---------------------------------------------------------------------------
app.post("/api/webhook/flutterwave", async (req, res) => {
  const signature = req.headers["verif-hash"];
  if (!signature || signature !== process.env.FLUTTERWAVE_SECRET_HASH) {
    console.warn("Flutterwave webhook: invalid signature");
    return res.sendStatus(401);
  }

  res.sendStatus(200);

  const event = req.body;
  if (event.event === "charge.completed" && event.data?.status === "successful") {
    const data = event.data;
    const customerName = data.customer?.name;
    const customerPhone = data.customer?.phone_number || data.meta?.phone;
    const items = data.meta?.items || [
      { name: data.meta?.description || "Purchase", qty: 1, price: data.amount },
    ];

    await processSale({
      customerName,
      customerPhone,
      items,
      paymentMethod: "flutterwave",
      reference: data.tx_ref,
    });
  }
});

app.listen(PORT, () => {
  console.log(`WhatsApp receipt bot running on http://localhost:${PORT}`);
});
