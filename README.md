<p><img src="public/brand/logo.svg" alt="Slipp" height="56"></p>

# Slipp

Slipp makes a receipt for each sale and gets it to the customer on WhatsApp. Type what they bought, tap send, and they have a neat receipt in their chat, with a page they can open any time and a PDF to download.

It runs on Vercel with no database and no server to keep running, and it works the moment it is deployed:

- **Without any WhatsApp setup**, Slipp opens WhatsApp with the receipt message ready for the customer's number. You tap send.
- **With WhatsApp Cloud API keys**, receipts send themselves.
- **With Paystack or Flutterwave**, card payments send their own receipts, with nobody touching the dashboard.

## How it works

| Page | What it is |
|---|---|
| `/` | The landing page |
| `/app` | The dashboard: make a receipt, see a live preview, send it, and see recent receipts |
| `/r/<link>` | The receipt the customer opens, with PDF download and share |

Receipts are not stored anywhere. Everything on a receipt (business, customer, items, payment, date) travels inside its link, signed with `SLIPP_SECRET` so nobody can create or change one. Opening the link checks the signature and shows the receipt; the PDF is drawn on request. The dashboard keeps your business details and a list of recent receipts in your own browser.

| API route | What it does |
|---|---|
| `POST /api/sale` | Checks the sale, signs the link, and sends it on WhatsApp when automatic sending is set up. Returns the receipt link, the PDF link and a `wa.me` link. |
| `GET /api/receipt?t=…&format=json\|pdf` | The receipt behind a link, as data or as a PDF |
| `POST /api/webhooks/paystack` | A `charge.success` with a valid `x-paystack-signature` makes and sends a receipt |
| `POST /api/webhooks/flutterwave` | A successful `charge.completed` with the right `verif-hash` does the same |
| `GET /api/sample` | Opens a sample receipt |
| `GET /api/status` | Tells the dashboard what is set up |

For webhook payments, Slipp reads the customer's phone from the payment's customer details or from `metadata.phone` (Paystack) or `meta.phone` (Flutterwave). If the metadata has an `items` array (`[{ "name", "qty", "price" }]`), those become the receipt lines; otherwise there is one line for the full amount.

## Settings

Set these in Vercel (Project → Settings → Environment Variables) or in a local `.env`. `.env.example` lists them all.

| Variable | Needed | What it does |
|---|---|---|
| `SLIPP_SECRET` | Yes | Any long random string. Signs every receipt link. Changing it makes old links stop working. |
| `SLIPP_KEY` | No | An access code the dashboard must enter before it can make receipts. Without it, anyone with the dashboard link can make receipts in their own business name. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | No | Meta WhatsApp Cloud API credentials for automatic sending. |
| `PAYSTACK_SECRET_KEY` | No | Turns on the Paystack webhook. |
| `FLUTTERWAVE_SECRET_HASH` | No | Turns on the Flutterwave webhook. |
| `BUSINESS_NAME`, `BUSINESS_PHONE`, `BUSINESS_ADDRESS`, `CURRENCY_SYMBOL` | For webhooks | The business shown on receipts made from payments. |

WhatsApp only lets a business send a free-form message, including a document, within 24 hours of the customer's last message. Outside that window Slipp reports that automatic sending did not work, and the dashboard's WhatsApp button still works.

## Run it locally

```bash
npm install
cp .env.example .env   # set SLIPP_SECRET
npm run dev
```

Then open http://localhost:3000. The local server serves the same pages and API routes as Vercel.

```bash
npm test
```

The tests cover making and opening receipts, rejecting changed links, input checks, the access code, automatic sending (with Meta's API faked), and both payment webhooks.

## Project layout

```
api/            Vercel functions: sale, receipt, sample, status, webhooks/
lib/            signed links, sale checks, PDF drawing, WhatsApp sending
public/         landing page, dashboard (app/), receipt page (r/), styles, logo
fonts/          DejaVu Sans, used in PDFs so currency symbols like ₦ print correctly
test/           API tests
dev.js          local server
```
