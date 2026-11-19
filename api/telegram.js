// POST /api/telegram : updates from the Slipp Telegram bot.
// GET /api/telegram (or /api/telegram/setup) : points the bot at this deployment.
const { waitUntil } = require("@vercel/functions");
const telegram = require("../lib/telegram");
const inbox = require("../lib/inbox");
const { origin } = require("../lib/sale");
const { json, jsonBody, fail } = require("../lib/http");

const setup = require("../lib/routes/telegram-setup");

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") return setup(req, res);
    if (req.method !== "POST") return json(res, 405, { error: "Use POST." });
    if (!telegram.validSecret(req.headers["x-telegram-bot-api-secret-token"])) return json(res, 401, { error: "Not from Telegram." });
    const update = await jsonBody(req);
    const m = update.message;
    // Only private chats with the bot; groups and channels are ignored.
    if (!m || !m.chat || m.chat.type !== "private") return json(res, 200, { ok: true, ignored: true });
    const work = inbox.handle({
      channel: "telegram",
      address: String(m.chat.id),
      name: [m.from && m.from.first_name, m.from && m.from.last_name].filter(Boolean).join(" "),
      text: m.text || "",
      key: update.update_id,
      origin: origin(req),
      oidcToken: req.headers["x-vercel-oidc-token"],
    }).catch((e) => console.error("telegram update failed", e));
    // Answer Telegram at once so it doesn't resend; the reply is sent in the background.
    waitUntil(work);
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e);
  }
};
