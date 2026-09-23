/**
 * Prepares an empty database: the Qub-X website and a first admin account.
 *
 *   npm run db:seed                  admin with a random password (printed once)
 *   SEED_ADMIN_EMAIL=… SEED_ADMIN_PASSWORD=… npm run db:seed
 *   npm run db:seed -- --demo        also an editor and a writer, for trying out permissions locally
 *
 * Articles are loaded separately (npm run db:import-qubx -- --replace).
 * With the local PGlite database, stop `npm run dev` first (one process at a time).
 */
import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { getDb, schema } from "../src/db";
import type { Role } from "../src/db/schema";
import { isWeakPassword } from "../src/lib/passwords";

const demo = process.argv.includes("--demo");

function randomPassword() {
  return randomBytes(12).toString("base64url");
}

async function main() {
  const db = await getDb();

  await db
    .insert(schema.sites)
    .values({
      id: "qubx",
      name: "Qub-X",
      baseUrl: "https://www.qub-x.com",
      blogPaths: { en: "/blog", vi: "/vi/blog" },
      defaultLocale: "vi",
      revalidateUrl: process.env.QUBX_REVALIDATE_URL ?? "http://localhost:3000/api/cms/revalidate",
    })
    .onConflictDoNothing();

  const accounts: { email: string; name: string; role: Role; password: string }[] = [
    {
      email: process.env.SEED_ADMIN_EMAIL ?? "admin@example.com",
      name: "Quản trị viên",
      role: "admin",
      password: process.env.SEED_ADMIN_PASSWORD ?? randomPassword(),
    },
  ];
  if (demo) {
    accounts.push(
      { email: "editor@example.com", name: "Biên Tập Viên", role: "editor", password: randomPassword() },
      { email: "writer@example.com", name: "Người Viết", role: "writer", password: randomPassword() },
    );
  }

  for (const account of accounts) {
    if (isWeakPassword(account.password)) throw new Error(`Password for ${account.email} is too weak.`);
    const [created] = await db
      .insert(schema.users)
      .values({
        email: account.email,
        name: account.name,
        role: account.role,
        passwordHash: await bcrypt.hash(account.password, 10),
      })
      .onConflictDoNothing()
      .returning({ id: schema.users.id });
    console.log(
      created
        ? `${account.role.padEnd(6)} ${account.email}  password: ${account.password}`
        : `${account.role.padEnd(6)} ${account.email}  already exists, left unchanged`,
    );
  }
  console.log("\nSave these passwords now; they are not stored anywhere in plain text.");
}

main().then(
  () => process.exit(0),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
