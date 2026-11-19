// GET /api/telegram/setup : points the Telegram bot at this deployment. Safe to open any
// number of times; it only ever sets the webhook to this same site.
const telegram = require("../telegram");
const { origin } = require("../sale");
const { json, fail } = require("../http");

module.exports = async (req, res) => {
  try {
    if (!telegram.configured()) return json(res, 400, { ok: false, error: "Add TELEGRAM_BOT_TOKEN in Vercel first, then redeploy." });
    const url = `${origin(req)}/api/telegram`;
    await telegram.call("setWebhook", { url, secret_token: telegram.webhookSecret(), allowed_updates: ["message"], max_connections: 20 });
    await telegram.call("setMyCommands", { commands: [
      { command: "help", description: "What you can ask Slipp" },
      { command: "reset", description: "Start the conversation fresh (keeps your records)" },
    ] });
    await telegram.call("setMyDescription", { description: "Slipp keeps your shop's books in chat: receipts, invoices, sales, expenses, stock and reports. Say hi to start." }).catch(() => {});
    const me = await telegram.call("getMe", {});
    json(res, 200, { ok: true, bot: `@${me.username}`, open: `https://t.me/${me.username}`, webhook: url });
  } catch (e) {
    fail(res, e);
  }
};
