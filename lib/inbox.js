// One message from a business owner, from either chat app: work out the business,
// let the assistant answer, then send the reply, PDFs and buttons back.
const store = require("./store");
const links = require("./links");
const assistant = require("./assistant");
const telegram = require("./telegram");
const whatsapp = require("./whatsapp");

// Each app sends text, documents and link buttons a little differently.
const outbox = {
  telegram: {
    text: (to, text, buttons) => telegram.sendText(to, text, buttons),
    document: (to, doc) => telegram.sendDocument(to, doc.pdf, doc.caption, [doc.share]),
    typing: (to) => telegram.typing(to),
  },
  whatsapp: {
    async text(to, text, buttons = []) {
      if (!buttons.length) return whatsapp.sendText(to, text);
      // One button per WhatsApp message: the first rides on the text, the rest follow.
      await whatsapp.sendButton(to, text, buttons[0].label, buttons[0].url);
      for (const b of buttons.slice(1)) await whatsapp.sendButton(to, b.label, b.label, b.url);
    },
    async document(to, doc) {
      await whatsapp.sendDocument(to, doc.pdf, doc.filename, doc.caption);
      await whatsapp.sendButton(to, `Forward ${doc.caption.split(" · ")[0]} to your customer on WhatsApp.`, doc.share.label, doc.share.url);
    },
    typing: async () => {},
  },
};

const HELP = `Here's what you can tell me:
• "Sold 2 bags of rice to Tunde for 45k each, paid by transfer"
• "Invoice Ada for 3 crates of eggs at 4,500, due Friday"
• "Ada has paid INV-0004"
• "Spent 12k on diesel"
• "Add 20 cartons of Indomie at 9,800"
• "How much did I make this month?" or "Who owes me?"
• "Open my dashboard"`;

/**
 * msg: { channel, address, name, text, key, origin, oidcToken }
 * key is the app's message id, so a message delivered twice is handled once.
 */
async function handle(msg) {
  const out = outbox[msg.channel];
  if (msg.key && !(await store.firstTime(`${msg.channel}:${msg.key}`))) return { skipped: "duplicate" };
  const text = String(msg.text || "").trim().slice(0, 2000);

  // Connecting this chat to a business that already uses Slipp in the other app.
  const link = text.match(/^(?:\/start\s+|link\s+)([A-Za-z0-9_-]{30,60})$/i);
  if (link) {
    const bid = links.readConnect(link[1]);
    if (!bid || !(await store.getBusiness(bid))) {
      await out.text(msg.address, "That connect code has expired. Ask for a new one in your other app: say \"connect my other app\".");
      return { linked: false };
    }
    await store.linkChat(msg.channel, msg.address, bid, msg.name);
    const b = await store.getBusiness(bid);
    await out.text(msg.address, `Connected. This chat now works with ${b.name || "your business"}. Everything you record here shows up in both apps and on your dashboard.`);
    return { linked: true };
  }

  const { chat, business } = await store.chatFor(msg.channel, msg.address, msg.name);

  if (/^\/(reset|clear)$/i.test(text)) {
    await store.forget(chat.id);
    await out.text(msg.address, "Fresh start. Your records are all still here.");
    return { reset: true };
  }
  if (/^\/?help$/i.test(text) && business.name) {
    await out.text(msg.address, HELP);
    return { help: true };
  }
  if (!text) {
    await out.text(msg.address, "I can only read text messages for now. Type what you sold, spent or want to know.");
    return { unsupported: true };
  }

  await out.typing(msg.address);
  let answer;
  try {
    answer = await assistant.reply({
      business, chat, channel: msg.channel, origin: msg.origin, oidcToken: msg.oidcToken,
      text: /^\/start$/i.test(text) ? "Hi" : text,
    });
  } catch (e) {
    console.error("assistant failed", e);
    await out.text(msg.address, assistant.TROUBLE);
    return { error: e.message };
  }
  await out.text(msg.address, answer.text, answer.buttons);
  for (const doc of answer.documents) {
    try {
      await out.document(msg.address, doc);
    } catch (e) {
      console.error("document send failed", e);
      await out.text(msg.address, `${doc.caption}\n${doc.url}`, [doc.share]);
    }
  }
  return { replied: true, documents: answer.documents.length };
}

module.exports = { handle, outbox, HELP };
