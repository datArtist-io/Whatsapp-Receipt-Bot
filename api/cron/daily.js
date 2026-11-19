// GET /api/cron/daily : run by Vercel Cron each morning. Tells each owner which invoices
// are due or overdue, with a button to the dashboard where they can send reminders.
const store = require("../../lib/store");
const links = require("../../lib/links");
const { outbox } = require("../../lib/inbox");
const { origin } = require("../../lib/sale");
const { json, fail } = require("../../lib/http");
const crypto = require("crypto");

function fromCron(req) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const got = Buffer.from(String(req.headers.authorization || ""));
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

module.exports = async (req, res) => {
  try {
    if (!fromCron(req)) return json(res, 401, { error: "Only Vercel Cron can run this." });
    const removed = await require("../../lib/demo").cleanup();
    const due = (await store.dueInvoices()).filter((i) => !i.demo);
    const byBusiness = new Map();
    for (const inv of due) {
      if (!byBusiness.has(inv.business_id)) byBusiness.set(inv.business_id, []);
      byBusiness.get(inv.business_id).push(inv);
    }
    let sent = 0;
    for (const [bid, invs] of byBusiness) {
      const cur = invs[0].currency || "₦";
      const today = new Date().toISOString().slice(0, 10);
      const lines = invs.slice(0, 10).map((i) => {
        const d = new Date(i.due_date).toISOString().slice(0, 10);
        return `• ${i.number} · ${i.customer_name || "walk-in"} · ${cur}${i.total.toLocaleString("en-US")} · ${d < today ? "overdue" : "due today"}`;
      });
      const more = invs.length > 10 ? `\n…and ${invs.length - 10} more.` : "";
      const text = `Good morning. ${invs.length === 1 ? "This invoice is" : "These invoices are"} waiting for payment:\n${lines.join("\n")}${more}\n\nReply "remind" with the invoice number and I'll get a reminder ready.`;
      const button = { label: "Open dashboard", url: `${origin(req)}/app?login=${links.loginCode(bid)}` };
      const chats = await store.chatsOf(bid);
      let delivered = false;
      for (const c of chats) {
        // WhatsApp only lets the bot write first within 24 hours of the owner's last message.
        if (c.channel === "whatsapp" && !(c.last_inbound_at && Date.now() - new Date(c.last_inbound_at) < 23.5 * 3600e3)) continue;
        try {
          await outbox[c.channel].text(c.address, text, [button]);
          delivered = true;
        } catch (e) {
          console.error("daily message failed", c.channel, e.message);
        }
      }
      if (delivered) {
        sent++;
        for (const i of invs) await store.noteReminder(i.id);
      }
    }
    json(res, 200, { ok: true, businesses: byBusiness.size, sent, demoShopsRemoved: removed });
  } catch (e) {
    fail(res, e);
  }
};
