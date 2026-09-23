/**
 * Applies pending migrations from ./drizzle.
 *
 *   npm run db:migrate
 *
 * With DATABASE_URL set it migrates that Postgres server (run it on every deploy, before the
 * new code starts). Without it, the local PGlite database is migrated — which also happens
 * automatically whenever the app opens it.
 */
import path from "node:path";

async function main() {
  const url = process.env.DATABASE_URL?.trim();
  const migrationsFolder = path.join(process.cwd(), "drizzle");

  if (!url) {
    const { getDb } = await import("../src/db");
    await getDb();
    console.log("Local PGlite database is up to date.");
    return;
  }

  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const pool = new Pool({
    connectionString: url,
    max: 1,
    ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
  });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
    console.log(`Migrated ${new URL(url).host}.`);
  } finally {
    await pool.end();
  }
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
