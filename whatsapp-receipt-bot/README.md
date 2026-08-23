# WhatsApp Receipt Bot

Automatically generates a PDF receipt and sends it to a customer's WhatsApp
the moment they pay. Tested and working end-to-end in this repo — you just
need to plug in your own credentials.

## What's automatic and what isn't (read this first)

| Payment method | How it triggers |
|---|---|
| **Online payment** (Paystack / Flutterwave) | 100% automatic. The payment provider calls your webhook the instant money lands — no action from you. |
| **Cash / Bank transfer** | You open one page and tap **"Mark as Paid & Send Receipt"** (~10 seconds). Nothing can trigger this automatically because there's no digital signal when someone hands you cash or you eyeball your bank alert. |

Both paths do the exact same thing after that: generate the PDF and send it
on WhatsApp — no copying, no manual attaching.

## What you need before this works

1. **A WhatsApp Business Cloud API account** (free, from Meta)
   - Go to [developers.facebook.com](https://developers.facebook.com) → create an app → add the "WhatsApp" product.
   - You'll get a **Phone Number ID** and a temporary access token immediately for testing. For production, generate a **permanent token** (System User token) and verify your business.
   - **Important limitation:** WhatsApp only lets you freely message a customer within 24 hours of them last messaging you. If you want to send a receipt to someone who *hasn't* messaged you first (e.g. straight after an online payment), you must create and get a **message template** approved in Meta Business Manager first. The `sendReceiptTemplate()` function in `whatsapp.js` is ready for this — see the comment in that file.
   - In practice: if your customers usually message you on WhatsApp to place an order or ask a question first, the free-form `sendReceiptDocument()` already in `server.js` will just work.

2. **A Paystack and/or Flutterwave account** (only if you take online payments)
   - Paystack: Dashboard → Settings → API Keys & Webhooks → add `https://yourdomain.com/api/webhook/paystack`
   - Flutterwave: Dashboard → Settings → Webhooks → add `https://yourdomain.com/api/webhook/flutterwave`
   - **Make sure the customer's phone number reaches the webhook.** At checkout, pass it in `metadata.phone` (Paystack) or `meta.phone` (Flutterwave) — the code reads it from there.

3. **Somewhere to host this** so Paystack/WhatsApp can reach it — e.g. Render, Railway, Fly.io, or a small VPS. It won't work on your laptop unless it's reachable from the internet (a tool like ngrok works for testing).

## Setup

```bash
npm install
cp .env.example .env
# then edit .env with your real values
npm start
```

Open `http://localhost:3000` for the manual sale form (cash/bank transfer).

## Files

- `server.js` — the web server: manual sale endpoint, Paystack webhook, Flutterwave webhook
- `receipt.js` — builds the PDF receipt (uses a bundled font so currency symbols like ₦ render correctly)
- `whatsapp.js` — sends the PDF to WhatsApp via Meta's Cloud API
- `public/index.html` — the one-tap "mark as paid" form for cash/bank transfer sales
- `.env.example` — every setting you need to fill in

## Customizing the receipt

Edit `receipt.js` — it's a straightforward PDFKit layout (business name, items
table, total, footer). Colors, logo, layout are all editable there.

## Going further

- Swap the in-memory `sales` array in `server.js` for a real database (e.g. Postgres, SQLite) once you're past testing — right now sales history resets if the server restarts.
- Add authentication to the `/` form page before deploying publicly, since anyone with the link could currently log a sale.
