// GET /api/status : what the pages need to know about this deployment.
const wa = require("../lib/whatsapp");
const db = require("../lib/db");
const { botAddresses } = require("../lib/assistant");
const { json } = require("../lib/http");

module.exports = async (req, res) => {
  const bots = await botAddresses().catch(() => ({}));
  json(res, 200, {
    ready: Boolean(process.env.SLIPP_SECRET && process.env.SLIPP_SECRET.length >= 16),
    autoSend: wa.configured(),
    needsKey: Boolean(process.env.SLIPP_KEY),
    paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
    flutterwave: Boolean(process.env.FLUTTERWAVE_SECRET_HASH),
    database: db.ready(),
    telegram: bots.telegram ? `https://t.me/${bots.telegram}` : null,
    whatsapp: bots.whatsapp ? `https://wa.me/${bots.whatsapp}?text=${encodeURIComponent("Hi Slipp")}` : null,
  });
};
