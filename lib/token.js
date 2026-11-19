// Receipts are not stored anywhere: everything on a receipt travels inside its link,
// signed with SLIPP_SECRET so nobody can make or change one.
const crypto = require("crypto");

function secret() {
  const s = process.env.SLIPP_SECRET;
  if (!s || s.length < 16) throw Object.assign(new Error("SLIPP_SECRET is not set (16+ characters)."), { status: 500 });
  return s;
}

const b64 = (buf) => Buffer.from(buf).toString("base64url");
const sign = (payload) => b64(crypto.createHmac("sha256", secret()).update(payload).digest().subarray(0, 12));

function encode(sale) {
  const payload = b64(JSON.stringify(sale));
  return `${payload}.${sign(payload)}`;
}

function decode(token) {
  if (typeof token !== "string" || token.length > 6000) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = token.slice(0, dot);
  const sig = Buffer.from(token.slice(dot + 1));
  const want = Buffer.from(sign(payload));
  if (sig.length !== want.length || !crypto.timingSafeEqual(sig, want)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

module.exports = { encode, decode };
