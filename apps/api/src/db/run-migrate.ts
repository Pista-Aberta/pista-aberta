/**
 * Arranque da imaxe: migrate sempre; seed demo só con PA_DEMO.
 * REVISION-36 H1 — nunca meter Exemplo/Proba/contas demo en produción.
 */
import { initDb, closeDb } from "./client.js";
import { migrateSchema } from "./migrate.js";
import { seedDb } from "./seed-db.js";

const paDemo =
  process.env.PA_DEMO === "1" || process.env.PA_DEMO === "true";

await initDb();
await migrateSchema();
if (paDemo) {
  await seedDb();
  console.info("[db] migrate + seed OK (PA_DEMO)");
} else {
  console.info("[db] migrate OK (sen seed; PA_DEMO off)");
}
await closeDb();
