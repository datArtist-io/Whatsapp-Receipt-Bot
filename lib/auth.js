// Dashboard sessions: a sign-in link from the chat becomes a 30-day cookie.
const links = require("./links");

const COOKIE = "slipp_session";

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const businessId = (req) => links.readSession(cookies(req)[COOKIE] || "");

function setSession(req, res, bid) {
  const secure = !/^(localhost|127\.)/.test(req.headers.host || "");
  const value = bid ? links.sessionCode(bid) : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${bid ? 30 * 24 * 3600 : 0}${secure ? "; Secure" : ""}`);
}

// Changes must come as JSON, which a page on another site can't send with our cookie.
const isJson = (req) => /^application\/json\b/i.test(String(req.headers["content-type"] || ""));

module.exports = { businessId, setSession, isJson };
