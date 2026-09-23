import { mkdirSync } from "node:fs";
import path from "node:path";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import * as schema from "./schema";

export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

const MIGRATIONS_FOLDER = path.join(process.cwd(), "drizzle");

/**
 * Local development runs on PGlite (Postgres compiled to WASM, stored in `.data/pglite`),
 * so nothing has to be installed. Set DATABASE_URL to use a real Postgres server instead
 * (Supabase, Neon, RDS…) — required on Vercel, where the filesystem is not persistent.
 */
async function connect(): Promise<Database> {
  const url = process.env.DATABASE_URL?.trim();

  if (url) {
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 5),
      ssl: url.includes("sslmode=require") ? { rejectUnauthorized: false } : undefined,
    });
    return drizzle(pool, { schema }) as unknown as Database;
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");
  const dataDir = process.env.PGLITE_DIR ?? path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  // Keep the local database in step with the code without a separate command.
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return db as unknown as Database;
}

// One connection per server process, surviving dev hot reloads.
const globalForDb = globalThis as unknown as { __cmsDb?: Promise<Database> };

export function getDb(): Promise<Database> {
  if (!globalForDb.__cmsDb) {
    globalForDb.__cmsDb = connect().catch((error) => {
      globalForDb.__cmsDb = undefined;
      throw error;
    });
  }
  return globalForDb.__cmsDb;
}

export { schema };
