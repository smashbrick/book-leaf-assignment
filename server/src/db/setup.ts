import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "./pool.js";
import { seed } from "./seed.js";

const SCHEMA_FILE = path.join(path.dirname(fileURLToPath(import.meta.url)), "schema.sql");

/** Drops everything and recreates the schema with the seed data. */
export async function resetDatabase(): Promise<void> {
  await pool.query("DROP SCHEMA public CASCADE; CREATE SCHEMA public;");
  await pool.query(await fs.readFile(SCHEMA_FILE, "utf8"));
  await seed();
}

/** On boot: set up a brand-new database so a fresh deploy works without manual steps. */
export async function setupIfEmpty(): Promise<void> {
  const { rows } = await pool.query<{ exists: boolean }>("SELECT to_regclass('public.users') IS NOT NULL AS exists");
  if (!rows[0]!.exists) {
    console.log("[db] empty database: creating schema and seeding data");
    await resetDatabase();
  }
}
