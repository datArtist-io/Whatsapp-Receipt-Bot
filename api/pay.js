// POST /api/webhooks/paystack and /api/webhooks/flutterwave (rewritten here in vercel.json):
// card payments that send the customer a receipt by themselves.
const handlers = { paystack: require("../lib/routes/paystack"), flutterwave: require("../lib/routes/flutterwave") };
const { json } = require("../lib/http");

module.exports = (req, res) => {
  const u = new URL(req.url, "http://x");
  const provider = u.searchParams.get("provider") || u.pathname.split("/").filter(Boolean).pop();
  const h = handlers[provider];
  if (!h) return json(res, 404, { error: "Unknown payment provider." });
  return h(req, res);
};
