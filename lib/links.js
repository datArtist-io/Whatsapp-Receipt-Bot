// Short signed codes: dashboard sign-in links and codes that connect a second chat app.
const crypto = require("crypto");

function key() {
  const s = process.env.SLIPP_SECRET;
  if (!s || s.length < 16) throw Object.assign(new Error("SLIPP_SECRET is not set (16+ characters)."), { status: 500 });
  return s;
}

const mac = (purpose, data) => crypto.createHmac("sha256", key()).update(purpose).update(data).digest().subarray(0, 9);

// purpose + business id + expiry, packed into a URL-safe code of about 44 characters.
function make(purpose, businessId, ttlSeconds) {
  const id = Buffer.from(businessId.replace(/-/g, ""), "hex");
  const exp = Buffer.alloc(4);
  exp.writeUInt32BE(Math.floor(Date.now() / 1000) + ttlSeconds);
  const data = Buffer.concat([id, exp]);
  return Buffer.concat([data, mac(purpose, data)]).toString("base64url");
}

function read(purpose, code) {
  if (typeof code !== "string" || code.length > 80) return null;
  const buf = Buffer.from(code, "base64url");
  if (buf.length !== 29) return null;
  const data = buf.subarray(0, 20);
  const sig = buf.subarray(20);
  if (!crypto.timingSafeEqual(sig, mac(purpose, data))) return null;
  if (data.readUInt32BE(16) < Date.now() / 1000) return null;
  const h = data.subarray(0, 16).toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// Turns a local number like 0803 123 4567 into 2348031234567 for wa.me links.
function intlPhone(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  const cc = (process.env.DEFAULT_COUNTRY_CODE || "234").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  else if (d.startsWith("0")) d = cc + d.slice(1);
  else if (d.length <= 10) d = cc + d;
  return d;
}

module.exports = {
  loginCode: (bid) => make("login", bid, 15 * 60),
  readLogin: (code) => read("login", code),
  sessionCode: (bid) => make("session", bid, 30 * 24 * 3600),
  readSession: (code) => read("session", code),
  connectCode: (bid) => make("connect", bid, 30 * 60),
  readConnect: (code) => read("connect", code),
  intlPhone,
};
