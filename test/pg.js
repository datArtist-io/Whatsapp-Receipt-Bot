// An in-memory Postgres (PGlite) with Slipp's schema, plugged into lib/db.
const fs = require("fs");
const path = require("path");
const db = require("../lib/db");

async function freshDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const pg = new PGlite();
  await pg.exec(fs.readFileSync(path.join(__dirname, "..", "db", "schema.sql"), "utf8"));
  db.useDb((text, params) => pg.query(text, params));
  return pg;
}

module.exports = { freshDb };
