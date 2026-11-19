// One small query function. On Vercel it talks to Postgres through DATABASE_URL, or the
// POSTGRES_URL that Vercel's Supabase or Neon connection adds. Slipp creates its own tables
// (db/schema.sql) the first time each server starts. Tests swap in an in-memory Postgres.
const fs = require("fs");
const path = require("path");

let impl = null;
let schemaReady = null;

const url = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";

function pgImpl() {
  const u = url();
  if (!u) throw Object.assign(new Error("No database: connect Supabase or Neon to the Vercel project, or set DATABASE_URL."), { status: 500 });
  const { Pool } = require("pg");
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(u);
  // Supabase signs its database certificates with its own CA. Put that CA in DATABASE_CA_CERT
  // (Supabase dashboard → Database → SSL) to have the certificate checked; without it the
  // connection is still encrypted but the server certificate is not verified.
  const ca = process.env.DATABASE_CA_CERT;
  // TLS is set below; drop the URL's own TLS and pooler hints so they don't override it.
  const conn = new URL(u);
  for (const k of ["sslmode", "sslrootcert", "supa", "pgbouncer"]) conn.searchParams.delete(k);
  const pool = new Pool({
    connectionString: conn.toString(),
    ssl: local ? false : ca ? { ca: ca.replace(/\\n/g, "\n") } : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
  });
  const run = (text, params) => pool.query(text, params);
  return async (text, params) => {
    if (!schemaReady) {
      // One transaction with a lock, so two servers starting together don't trip over each other.
      const sql = fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8");
      schemaReady = run(`begin; select pg_advisory_xact_lock(726354); ${sql}; commit;`).catch((e) => { schemaReady = null; throw e; });
    }
    await schemaReady;
    return run(text, params);
  };
}

function query(text, params = []) {
  if (!impl) impl = pgImpl();
  return impl(text, params);
}

const ready = () => Boolean(impl || url());
const useDb = (fn) => { impl = fn; };

module.exports = { query, ready, useDb };
