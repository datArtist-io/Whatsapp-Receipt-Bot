// One small query function. On Vercel it talks to Postgres through DATABASE_URL;
// tests swap in an in-memory Postgres with useDb().
let impl = null;

function pgImpl() {
  const url = process.env.DATABASE_URL;
  if (!url) throw Object.assign(new Error("DATABASE_URL is not set."), { status: 500 });
  const { Pool } = require("pg");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // Supabase signs its database certificates with its own CA. Put that CA in DATABASE_CA_CERT
  // (Supabase dashboard → Database → SSL) to have the certificate checked; without it the
  // connection is still encrypted but the server certificate is not verified.
  const ca = process.env.DATABASE_CA_CERT;
  const pool = new Pool({
    connectionString: url.replace(/[?&]sslmode=[^&]*/, ""),
    ssl: local ? false : ca ? { ca: ca.replace(/\\n/g, "\n") } : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  return (text, params) => pool.query(text, params);
}

function query(text, params = []) {
  if (!impl) impl = pgImpl();
  return impl(text, params);
}

const ready = () => Boolean(impl || process.env.DATABASE_URL);
const useDb = (fn) => { impl = fn; };

module.exports = { query, ready, useDb };
