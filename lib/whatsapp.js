// Meta's WhatsApp Cloud API: the Slipp bot number and automatic receipt sending.
// Needs WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID.
const crypto = require("crypto");

function configured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function send(to, message) {
  const v = process.env.GRAPH_API_VERSION || "v21.0";
  const r = await fetch(`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: String(to), ...message }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const code = body?.error?.code;
    // 131047: outside the 24-hour window, only template messages are allowed
    const msg = code === 131047 ? "WhatsApp only allows this within 24 hours of the person's last message. Use the WhatsApp button instead." : body?.error?.message || `HTTP ${r.status}`;
    throw Object.assign(new Error(msg), { code });
  }
  return body?.messages?.[0]?.id || null;
}

const sendText = (to, text) => send(to, { type: "text", text: { body: String(text).slice(0, 4000), preview_url: false } });

const sendDocument = (to, pdfUrl, filename, caption) =>
  send(to, { type: "document", document: { link: pdfUrl, filename, caption: String(caption || "").slice(0, 1000) } });

// A message with one tappable link button (WhatsApp allows one per message, label up to 20 characters).
const sendButton = (to, text, label, url) =>
  send(to, {
    type: "interactive",
    interactive: { type: "cta_url", body: { text: String(text).slice(0, 1000) }, action: { name: "cta_url", parameters: { display_text: String(label).slice(0, 20), url } } },
  });

// Meta signs each webhook delivery with the app secret.
function validSignature(raw, header) {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || typeof header !== "string" || !header.startsWith("sha256=")) return false;
  const want = Buffer.from("sha256=" + crypto.createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = { configured, send, sendText, sendDocument, sendButton, validSignature };
