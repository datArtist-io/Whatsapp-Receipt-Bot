# WhatsApp Receipt Bot

A small Node.js and Express server that builds a PDF receipt for each sale and sends it to the customer as a WhatsApp document through Meta's WhatsApp Cloud API. Sales come in from three places: a web form for cash and bank transfer payments, a Paystack webhook, and a Flutterwave webhook.

This is a starter project. Sales are kept in memory and are lost when the server restarts, and the sale form has no login. See [Limitations](#limitations) before running it anywhere public.

## How it works

Every entry point calls the same function, `processSale()` in `server.js`:

1. It adds up the line items (`price * qty`) and gives the sale an 8-character ID from `nanoid`.
2. It strips everything except digits from the customer's phone number, so `+234 801-234-5678` becomes `2348012345678`.
3. It stores the sale in an in-memory array.
4. `receipt.js` draws a narrow PDF receipt with PDFKit and writes it to `receipts/<id>.pdf`. The receipt shows the business name, address and phone, receipt number, date, customer, payment method, optional reference, the items, and the total. It uses the bundled DejaVu Sans fonts so currency symbols such as ₦ render.
5. `whatsapp.js` uploads the PDF to the Cloud API media endpoint, then sends it to the customer as a document message with a short caption.

If no phone number is supplied, the receipt is still generated but nothing is sent.

### Entry points

| Source | Route | Trigger |
|---|---|---|
| Sale form (`public/index.html`) | `POST /api/sale` | You fill in the customer, payment method (cash or bank transfer) and items, then press "Mark as Paid & Send Receipt". |
| Paystack | `POST /api/webhook/paystack` | Paystack sends a `charge.success` event. The request is checked against an HMAC-SHA512 of the raw body using `PAYSTACK_SECRET_KEY` and the `x-paystack-signature` header. |
| Flutterwave | `POST /api/webhook/flutterwave` | Flutterwave sends a `charge.completed` event with status `successful`. The `verif-hash` header must equal `FLUTTERWAVE_SECRET_HASH`. |

`GET /api/sales` returns the in-memory list of sales as JSON.

For webhook payments the server reads the customer's phone from the customer object first, then from checkout metadata (`metadata.phone` for Paystack, `meta.phone` for Flutterwave). If the metadata contains an `items` array, it is used as the line items. Otherwise the receipt shows one line called "Purchase" (or `description` from the metadata) for the full amount. Paystack amounts are divided by 100 to convert from kobo.

### The WhatsApp 24-hour window

The Cloud API only accepts free-form messages, including the document message this bot sends, within 24 hours of the customer last messaging your business number. Outside that window you need an approved message template. `whatsapp.js` includes `sendReceiptTemplate()` for this, but `server.js` does not call it yet. If your customers usually message you on WhatsApp before they pay, the default document message is enough.

## Requirements

- Node.js and npm. The code uses optional chaining, so Node.js 14 or later is needed.
- A Meta developer app with the WhatsApp product added, which gives you a phone number ID and an access token. A temporary token works for testing; production needs a permanent System User token.
- A Paystack or Flutterwave account, only if you take online payments.
- A public URL for the server if you use the webhooks. Locally, a tunnel such as ngrok works for testing.

## Setup

```bash
git clone https://github.com/datArtist-io/Whatsapp-Receipt-Bot.git
cd Whatsapp-Receipt-Bot
npm install
cp .env.example .env
```

Fill in `.env` (see below), then start the server.

## Configuration

All settings are read from environment variables. `server.js` loads `.env` with `dotenv` at startup.

| Variable | Used in | Purpose | Default |
|---|---|---|---|
| `PORT` | `server.js` | Port to listen on | `3000` |
| `WHATSAPP_TOKEN` | `whatsapp.js` | Cloud API access token, sent as a Bearer token | none |
| `WHATSAPP_PHONE_NUMBER_ID` | `whatsapp.js` | Phone number ID of your WhatsApp business number | none |
| `GRAPH_API_VERSION` | `whatsapp.js` | Graph API version in the request URL | `v20.0` |
| `PAYSTACK_SECRET_KEY` | `server.js` | Paystack secret key, used to verify webhook signatures | empty string |
| `FLUTTERWAVE_SECRET_HASH` | `server.js` | Secret hash you set in the Flutterwave dashboard | none, so all Flutterwave webhooks are rejected |
| `BUSINESS_NAME` | `receipt.js` | Name printed at the top of the receipt | `Your Business Name` |
| `BUSINESS_PHONE` | `receipt.js` | Phone printed under the name | omitted |
| `BUSINESS_ADDRESS` | `receipt.js` | Address printed under the name | omitted |
| `CURRENCY_SYMBOL` | `receipt.js` | Symbol before every amount | `₦` |

### Payment provider webhooks

- Paystack: Dashboard, Settings, API Keys & Webhooks. Set the webhook URL to `https://<your-host>/api/webhook/paystack`.
- Flutterwave: Dashboard, Settings, Webhooks. Set the URL to `https://<your-host>/api/webhook/flutterwave` and use the same secret hash as `FLUTTERWAVE_SECRET_HASH`.

At checkout, pass the customer's WhatsApp number in `metadata.phone` (Paystack) or `meta.phone` (Flutterwave) if the provider's customer record does not already have it.

## Running

```bash
npm start
```

Open `http://localhost:3000` for the sale form. `npm run dev` runs the same command.

To record a sale without the form:

```bash
curl -X POST http://localhost:3000/api/sale \
  -H "Content-Type: application/json" \
  -d '{
    "customerName": "Ada Lovelace",
    "customerPhone": "2348012345678",
    "paymentMethod": "cash",
    "items": [{ "name": "Notebook", "qty": 2, "price": 1500 }]
  }'
```

The response contains the sale and `sent: true` or `sent: false`, with an `error` field when the WhatsApp request failed. `items` must be a non-empty array. `paymentMethod` is printed on the receipt; `cash`, `bank_transfer`, `paystack` and `flutterwave` get friendly labels.

## Project structure

```
.
├── server.js           Express app: sale endpoint, Paystack and Flutterwave webhooks, static files
├── receipt.js          Builds the PDF receipt with PDFKit and saves it to receipts/
├── whatsapp.js         Cloud API calls: media upload, document message, template message
├── public/
│   └── index.html      Sale form for cash and bank transfer payments
├── fonts/
│   ├── DejaVuSans.ttf
│   └── DejaVuSans-Bold.ttf
├── .env.example        Names of every environment variable the code reads
└── package.json
```

The `receipts/` folder is created on first run and is ignored by git.

## Customizing the receipt

The layout is in `generateReceiptPDF()` in `receipt.js`. The page is 300 points wide, and its height grows with the number of items. The closing line, "Thank you for your patronage!", is hard-coded there. Payment method labels are in `formatPaymentMethod()`.

## Limitations

- Sales live in an in-memory array, so `GET /api/sales` is empty after a restart. Swap it for a database before relying on the history.
- The sale form and `/api/sale` have no authentication. Anyone who can reach the server can record a sale and trigger a WhatsApp message.
- Generated PDFs stay in `receipts/` and are never cleaned up.
- Template messages are not wired into `processSale()`, so customers outside the 24-hour window will not receive the receipt.
- There are no automated tests.
