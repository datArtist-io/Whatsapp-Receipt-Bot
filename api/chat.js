// GET /api/chat : the web chat so far. POST /api/chat { text } : send a message to Slipp.
const store = require("../lib/store");
const auth = require("../lib/auth");
const assistant = require("../lib/assistant");
const { origin } = require("../lib/sale");
const { json, jsonBody, fail } = require("../lib/http");

const DAILY_LIMIT = Number(process.env.SLIPP_DAILY_MESSAGES) || 150;

const shape = (m) => ({
  role: m.role,
  text: m.content,
  documents: (m.extra && m.extra.documents) || [],
  buttons: (m.extra && m.extra.buttons) || [],
  at: m.created_at,
});

module.exports = async (req, res) => {
  try {
    const bid = auth.businessId(req);
    if (!bid) return json(res, 401, { error: "Signed out." });
    const business = await store.getBusiness(bid);
    if (!business) { auth.setSession(req, res, null); return json(res, 401, { error: "Signed out." }); }
    const chat = await store.webChat(bid);

    if (req.method === "GET") {
      const msgs = await store.transcript(chat.id);
      return json(res, 200, { business: { name: business.name, owner: business.owner_name, currency: business.currency }, messages: msgs.map(shape) });
    }
    if (req.method !== "POST" || !auth.isJson(req)) return json(res, 405, { error: "Use POST with JSON." });
    const text = String((await jsonBody(req)).text || "").trim().slice(0, 2000);
    if (!text) return json(res, 400, { error: "Type a message first." });
    if ((await store.sentToday(chat.id)) >= DAILY_LIMIT) {
      return json(res, 429, { error: "You've sent a lot of messages today. Slipp will be back for you tomorrow." });
    }
    let answer;
    try {
      answer = await assistant.reply({ business, chat, channel: "web", text, origin: origin(req), oidcToken: req.headers["x-vercel-oidc-token"] });
    } catch (e) {
      console.error("assistant failed", e);
      return json(res, 503, { error: assistant.TROUBLE });
    }
    json(res, 200, { role: "assistant", text: answer.text, documents: answer.documents, buttons: answer.buttons });
  } catch (e) {
    fail(res, e);
  }
};
