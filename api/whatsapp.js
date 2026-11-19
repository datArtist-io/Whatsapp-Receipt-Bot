// /api/whatsapp : the WhatsApp Cloud API webhook for the Slipp bot number.
// GET answers Meta's verification check; POST carries incoming messages.
const { waitUntil } = require("@vercel/functions");
const whatsapp = require("../lib/whatsapp");
const inbox = require("../lib/inbox");
const { origin } = require("../lib/sale");
const { json, rawBody, fail } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const q = new URL(req.url, "http://x").searchParams;
      const want = process.env.WHATSAPP_VERIFY_TOKEN;
      if (want && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === want) {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        return res.end(q.get("hub.challenge") || "");
      }
      return json(res, 403, { error: "Verification failed." });
    }
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    const raw = await rawBody(req);
    if (!whatsapp.validSignature(raw, req.headers["x-hub-signature-256"])) return json(res, 401, { error: "Bad signature." });
    let body;
    try { body = JSON.parse(raw.toString("utf8")); } catch { return json(res, 400, { error: "Invalid JSON" }); }

    const jobs = [];
    for (const entry of body.entry || []) {
      for (const change of entry.changes || []) {
        const v = change.value || {};
        const names = Object.fromEntries((v.contacts || []).map((c) => [c.wa_id, c.profile && c.profile.name]));
        for (const m of v.messages || []) {
          const text = m.type === "text" ? m.text && m.text.body
            : m.type === "interactive" ? (m.interactive.button_reply || m.interactive.list_reply || {}).title
            : m.type === "button" ? m.button && m.button.text : "";
          jobs.push(inbox.handle({
            channel: "whatsapp", address: m.from, name: names[m.from] || "", text: text || "", key: m.id,
            origin: origin(req), oidcToken: req.headers["x-vercel-oidc-token"],
          }).catch((e) => console.error("whatsapp message failed", e)));
        }
      }
    }
    waitUntil(Promise.all(jobs));
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e);
  }
};
