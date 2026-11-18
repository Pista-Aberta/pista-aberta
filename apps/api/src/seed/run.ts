import { initDb, closeDb } from "../db/client.js";
import { migrateSchema } from "../db/migrate.js";
import { seedDb } from "../db/seed-db.js";

await initDb();
await migrateSchema();
await seedDb();
await closeDb();
