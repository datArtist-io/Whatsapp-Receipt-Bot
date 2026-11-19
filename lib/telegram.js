// The Slipp bot on Telegram. Needs TELEGRAM_BOT_TOKEN.
const crypto = require("crypto");

const configured = () => Boolean(process.env.TELEGRAM_BOT_TOKEN);

async function call(method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(20000),
  });
  const body = await r.json().catch(() => ({}));
  if (!body.ok) throw Object.assign(new Error(body.description || `Telegram ${method} failed (${r.status})`), { code: body.error_code });
  return body.result;
}

const keyboard = (buttons) => (buttons && buttons.length ? { reply_markup: { inline_keyboard: buttons.map((b) => [{ text: b.label, url: b.url }]) } } : {});

// Telegram shows *stars* literally in plain text, so WhatsApp-style bold is dropped.
const plain = (t) => String(t).replace(/(^|[\s(])\*(\S[^*\n]*?\S|\S)\*(?=[\s).,!?:;]|$)/g, "$1$2");

const sendText = (chatId, text, buttons) => call("sendMessage", { chat_id: chatId, text: plain(text).slice(0, 4000), disable_web_page_preview: true, ...keyboard(buttons) });
const sendDocument = (chatId, url, caption, buttons) => call("sendDocument", { chat_id: chatId, document: url, caption: String(caption || "").slice(0, 1000), ...keyboard(buttons) });
const typing = (chatId) => call("sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});

// The secret Telegram sends back with every update, derived from the bot token so there's nothing extra to set.
const webhookSecret = () => crypto.createHmac("sha256", process.env.TELEGRAM_BOT_TOKEN || "").update("slipp-webhook").digest("hex").slice(0, 48);

function validSecret(header) {
  if (!configured() || typeof header !== "string") return false;
  const want = Buffer.from(webhookSecret());
  const got = Buffer.from(header);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { configured, call, sendText, sendDocument, typing, webhookSecret, validSecret, plain };
