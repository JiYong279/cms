import { defineConfig } from "drizzle-kit";

const url = process.env.DATABASE_URL?.trim();

// `npm run db:generate` only diffs the schema, so it works without any database.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  ...(url
    ? { dbCredentials: { url } }
    : { driver: "pglite", dbCredentials: { url: "./.data/pglite" } }),
});
