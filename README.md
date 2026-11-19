<p><img src="public/brand/logo.svg" alt="Slipp" height="56"></p>

# Slipp

**Live:** [getslipp.vercel.app](https://getslipp.vercel.app). Click **Try the live demo** to open a sample shop and chat with Slipp, no sign-up needed.

Slipp keeps a small shop's books in a WhatsApp or Telegram chat. The owner texts what they sold, spent or want to know, in plain words, and Slipp:

- makes **receipts** and **invoices** as PDFs, with a button to forward each one to the customer on WhatsApp
- puts the business's **bank details** on invoices, marks them **paid**, and gets **payment reminders** ready
- records **expenses**, keeps **stock** counts and warns when something runs low
- keeps **customers**, with what each has paid and still owes
- answers questions like "how much did I make this month?", "what's my best seller?" or "who owes me?"
- sends the owner a morning list of invoices that are due
- has a **web dashboard** with sales, spending, profit, what's owed, a six-month chart, and every invoice, customer, product and expense

There are no passwords. The first message to the bot creates the business, and the dashboard signs in with a link the bot sends ("open my dashboard"). The same business can be used from both WhatsApp and Telegram ("connect my other app").

The older quick receipt maker is still at `/app`: it makes a single receipt with no account and nothing stored.

## How it works

| Part | What it is |
|---|---|
| `api/telegram.js`, `api/whatsapp.js` | Webhooks for the two chat apps. Each message is checked (Telegram secret, Meta signature), handled once, and answered in the background. |
| `lib/assistant.js` | Claude with 13 tools for invoices, payments, expenses, stock, customers, reports and links. Every number in a reply comes from a tool result. |
| `lib/store.js`, `db/schema.sql` | Everything in Postgres, in its own `slipp` schema. Slipp creates the tables the first time it starts. |
| `api/dashboard.js`, `public/dashboard/` | The dashboard and its actions (new sale, mark paid, remind, stock, expenses, settings). |
| `api/cron/daily.js` | Runs each morning (Vercel Cron) and tells owners which invoices are due. |
| `/r/<link>`, `api/receipt.js` | The receipt or invoice page a customer opens, and its PDF. Everything on it travels inside the link, signed with `SLIPP_SECRET`. |

Claude is reached through Vercel AI Gateway using the deployment's own OIDC sign-in, so no AI key is stored on Vercel. The model is Claude Opus 5.5 by default; set `SLIPP_MODEL=claude-haiku-5-5` for a much cheaper one.

WhatsApp lets a bot reply freely within 24 hours of a person's last message. Owners write to Slipp first, so replies always work; the morning reminder goes to WhatsApp only when the owner has written in the last day, and always to Telegram.

## Setting up the chat apps

**Telegram** (free, a few minutes)

1. In Telegram, message @BotFather, send `/newbot`, and follow the steps.
2. Put the token it gives you in Vercel as `TELEGRAM_BOT_TOKEN`, then redeploy.
3. Open `https://<your-site>/api/telegram/setup` once. It points the bot at Slipp and shows its link.

**WhatsApp** (Meta's Cloud API; the free test number works for trying it)

1. At developers.facebook.com, create an app of type Business and add the WhatsApp product.
2. In Vercel set `WHATSAPP_TOKEN` (a permanent system-user token), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET` (App settings → Basic) and `WHATSAPP_VERIFY_TOKEN` (any word you choose). Redeploy.
3. In the app's WhatsApp → Configuration, set the callback URL to `https://<your-site>/api/whatsapp` with the same verify token, and subscribe to `messages`.

## Settings

Set these in Vercel (Project → Settings → Environment Variables) or in a local `.env`. `.env.example` lists them all.

| Variable | Needed | What it does |
|---|---|---|
| `SLIPP_SECRET` | Yes | Any long random string. Signs receipt links, sign-in links and connect codes. Changing it makes old links stop working. |
| `POSTGRES_URL` or `DATABASE_URL` | For the chat assistant | A Postgres database. Connecting Supabase or Neon in Vercel's Storage tab adds `POSTGRES_URL` by itself. |
| `TELEGRAM_BOT_TOKEN` | For Telegram | The bot token from @BotFather. |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | For WhatsApp | Meta WhatsApp Cloud API settings. |
| `CRON_SECRET` | For the morning reminder | Any long random string; Vercel Cron sends it back. |
| `NODEJS_HELPERS` | On Vercel | Set to `0` so webhooks can check signatures against the exact request body. |
| `SLIPP_MODEL` | No | The Claude model. Default `claude-opus-5-5`; `claude-haiku-5-5` costs far less. |
| `AI_GATEWAY_API_KEY` or `ANTHROPIC_API_KEY` | Only off Vercel | On Vercel the AI needs no key. |
| `TZ_RECEIPT`, `DEFAULT_COUNTRY_CODE` | No | Time zone for dates and reports (default Africa/Lagos); country code for local phone numbers (default 234). |
| `SLIPP_KEY` | No | An access code for the quick receipt maker at `/app`. |
| `PAYSTACK_SECRET_KEY`, `FLUTTERWAVE_SECRET_HASH` | No | Turn on the payment webhooks, which send receipts by themselves. |
| `BUSINESS_NAME`, `BUSINESS_PHONE`, `BUSINESS_ADDRESS`, `CURRENCY_SYMBOL` | For payment webhooks | The business shown on receipts made from payments. |

## Run it locally

```bash
npm install
cp .env.example .env   # set SLIPP_SECRET, DATABASE_URL, and an AI key
npm run dev
```

Then open http://localhost:3000. The local server serves the same pages and API routes as Vercel.

```bash
npm test
```

The tests run against an in-memory Postgres (PGlite) with Claude, Telegram and Meta replaced by stand-ins. They cover the chat flows (first message, sales, stock, invoices, payments, reports, conversation memory, duplicate deliveries, linking WhatsApp and Telegram), the morning reminder, the dashboard and its sign-in, receipts and their links, and both payment webhooks.

## Project layout

```
api/            Vercel functions: auth, chat, dashboard, telegram, whatsapp, cron/, receipt, sale, pay, status (10, under the free plan's limit of 12)
lib/routes/     small handlers those functions share: sign-in links, sample receipt, Telegram setup, Paystack, Flutterwave
lib/            assistant (Claude and its tools), store (database), chat senders, PDF drawing, signed links
db/             the database schema
public/         landing page, dashboard/, quick receipt maker (app/), receipt page (r/), styles, logo
fonts/          DejaVu Sans, used in PDFs so currency symbols like ₦ print correctly
test/           API and chat tests
dev.js          local server
```
