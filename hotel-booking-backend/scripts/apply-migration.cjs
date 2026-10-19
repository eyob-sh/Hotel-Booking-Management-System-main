// One-shot migration runner (drizzle-kit migrate needs a driver config we
// don't ship; this applies the generated .sql files directly).
// Usage (from the backend directory):  node scripts/apply-migration.cjs drizzle/0002_messy_red_hulk.sql
// Statements are executed one at a time, autocommit — safe for
// ALTER TYPE ... ADD VALUE (illegal inside a transaction block on old PG).
const path = require("path");
const fs = require("fs");
require("dotenv").config({ path: path.join(process.cwd(), ".env") });
const { Client } = require("pg");

(async () => {
  const file = process.argv[2];
  if (!file) {
    console.error("usage: node scripts/apply-migration.cjs <path-to.sql>");
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const hasMigrations = await client.query(
    "SELECT to_regclass('drizzle.__drizzle_migrations') AS t"
  );
  if (hasMigrations.rows[0].t) {
    const applied = await client.query(
      "SELECT name FROM drizzle.__drizzle_migrations ORDER BY created_at"
    );
    console.log("applied so far:", applied.rows.map((r) => r.name).join(", ") || "(none)");
  } else {
    console.log("(no drizzle migrations table — prior migrations were applied manually)");
  }

  const sql = fs.readFileSync(file, "utf8");
  const statements = sql
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);

  for (const statement of statements) {
    console.log("EXEC:", statement.split("\n")[0].slice(0, 90));
    try {
      await client.query(statement);
    } catch (err) {
      // Re-runs after a partial failure: skip statements that already landed.
      if (
        err.code === "42710" ||
        /already exists|already contains|already a member/i.test(err.message || "")
      ) {
        console.log("  SKIP (already applied):", err.message.slice(0, 80));
        continue;
      }
      throw err;
    }
  }

  for (const t of ["room_types", "payment_providers", "payments", "room_inventory"]) {
    const n = await client.query(`SELECT count(*)::int AS n FROM "${t}"`);
    console.log(`${t} rows:`, n.rows[0].n);
  }
  const cols = await client.query(
    "SELECT column_name FROM information_schema.columns WHERE table_name='bookings' AND column_name IN ('roomTypeId','reference','depositAmount','balanceAmount','currency','source') ORDER BY column_name"
  );
  console.log("bookings new cols:", cols.rows.map((r) => r.column_name).join(", "));

  await client.end();
  console.log("MIGRATION OK:", file);
})().catch((err) => {
  console.error("MIGRATION FAILED:", err.message);
  process.exit(1);
});
