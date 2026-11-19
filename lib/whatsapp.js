// Optional automatic sending through Meta's WhatsApp Cloud API.
// Without WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID, Slipp gives a ready-to-send wa.me link instead.
function configured() {
  return Boolean(process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID);
}

async function sendDocument(to, pdfUrl, filename, caption) {
  const v = process.env.GRAPH_API_VERSION || "v21.0";
  const r = await fetch(`https://graph.facebook.com/${v}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "document", document: { link: pdfUrl, filename, caption } }),
    signal: AbortSignal.timeout(15000),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = body?.error?.message || `HTTP ${r.status}`;
    // 131047: outside the 24-hour window, a template message is needed
    const code = body?.error?.code;
    throw Object.assign(new Error(code === 131047 ? "WhatsApp only allows this within 24 hours of the customer's last message. Use the WhatsApp button instead." : msg), { code });
  }
  return body?.messages?.[0]?.id || null;
}

module.exports = { configured, sendDocument };
