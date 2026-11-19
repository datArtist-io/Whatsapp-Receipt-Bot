// POST /api/auth : { action: "signup", name, business, phone, password, currency }
//                  { action: "signin", phone, password }
// Website accounts sign in with the owner's phone number and a password.
const store = require("../lib/store");
const auth = require("../lib/auth");
const { json, jsonBody, fail } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST" || !auth.isJson(req)) return json(res, 405, { error: "Use POST with JSON." });
    const b = await jsonBody(req);
    let business;
    if (b.action === "signup") {
      business = await store.createAccount({ ownerName: b.name, businessName: b.business, phone: b.phone, display: b.display, password: b.password, currency: b.currency });
    } else if (b.action === "signin") {
      business = await store.signIn(b.phone, b.password);
    } else {
      return json(res, 400, { error: "Unknown action." });
    }
    auth.setSession(req, res, business.id);
    json(res, 200, { ok: true, business: { name: business.name, owner: business.owner_name } });
  } catch (e) {
    fail(res, e);
  }
};
