// POST /api/session : { login } signs in with a link from the chat; { logout: true } signs out.
const links = require("../lib/links");
const store = require("../lib/store");
const auth = require("../lib/auth");
const { json, jsonBody, fail } = require("../lib/http");

module.exports = async (req, res) => {
  try {
    if (req.method !== "POST" || !auth.isJson(req)) return json(res, 405, { error: "Use POST with JSON." });
    const body = await jsonBody(req);
    if (body.logout) { auth.setSession(req, res, null); return json(res, 200, { ok: true }); }
    const bid = links.readLogin(String(body.login || ""));
    if (!bid || !(await store.getBusiness(bid))) return json(res, 401, { error: "This sign-in link has expired. Ask Slipp for a new one: send \"dashboard\" in your chat." });
    auth.setSession(req, res, bid);
    json(res, 200, { ok: true });
  } catch (e) {
    fail(res, e);
  }
};
