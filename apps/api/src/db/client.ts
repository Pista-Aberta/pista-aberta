/**
 * Cliente DB: Postgres real (DATABASE_URL postgres://…) ou PGlite (dev sen Docker).
 */
import { drizzle as drizzlePg } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { PgliteDatabase } from "drizzle-orm/pglite";
import postgres from "postgres";
import * as schema from "./schema.js";
import path from "node:path";
import fs from "node:fs";

export type AppDb =
  | PostgresJsDatabase<typeof schema>
  | PgliteDatabase<typeof schema>;

let db: AppDb | null = null;
let mode: "postgres" | "pglite" = "pglite";
let pgClient: ReturnType<typeof postgres> | null = null;

export function getDbMode(): "postgres" | "pglite" {
  return mode;
}

export function getDb(): AppDb {
  if (!db) throw new Error("DB non inicializada — chamar initDb() primeiro");
  return db;
}

export async function initDb(): Promise<AppDb> {
  if (db) return db;

  const url = process.env.DATABASE_URL?.trim() ?? "";
  const wantsPostgres =
    url.startsWith("postgres://") || url.startsWith("postgresql://");

  if (wantsPostgres) {
    try {
      /* REVISION-37 I9 — silenciar NOTICE «already exists, skipping» nas migracións. */
      pgClient = postgres(url, {
        max: 8,
        idle_timeout: 20,
        connect_timeout: 5,
        onnotice: () => {},
      });
      await pgClient`select 1`;
      db = drizzlePg(pgClient, { schema });
      mode = "postgres";
      console.info(`[db] Postgres conectado (${url.replace(/:[^:@]+@/, ":***@")})`);
      return db;
    } catch (err) {
      console.warn(
        `[db] Postgres non dispoñible (${(err as Error).message}); usando PGlite local`,
      );
      if (pgClient) {
        await pgClient.end({ timeout: 1 }).catch(() => undefined);
        pgClient = null;
      }
    }
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle: drizzlePglite } = await import("drizzle-orm/pglite");
  const dataDir =
    process.env.PGLITE_DATA_DIR ?? path.join(process.cwd(), ".data", "pglite");
  fs.mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  await client.waitReady;
  db = drizzlePglite(client, { schema });
  mode = "pglite";
  console.info(`[db] PGlite en ${dataDir}`);
  return db;
}

export async function closeDb(): Promise<void> {
  if (pgClient) {
    await pgClient.end({ timeout: 2 });
    pgClient = null;
  }
  db = null;
}
