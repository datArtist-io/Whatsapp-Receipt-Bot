// GET /api/status : what the dashboard needs to know about this deployment.
const wa = require("../lib/whatsapp");
const { json } = require("../lib/http");

module.exports = (req, res) => json(res, 200, {
  ready: Boolean(process.env.SLIPP_SECRET && process.env.SLIPP_SECRET.length >= 16),
  autoSend: wa.configured(),
  needsKey: Boolean(process.env.SLIPP_KEY),
  paystack: Boolean(process.env.PAYSTACK_SECRET_KEY),
  flutterwave: Boolean(process.env.FLUTTERWAVE_SECRET_HASH),
});
