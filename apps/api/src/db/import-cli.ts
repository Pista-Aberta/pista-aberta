/**
 * CLI: npm run db:import -- ficheiro.json [--slug novo] [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { initDb, closeDb } from "./client.js";
import { migrateSchema } from "./migrate.js";
import {
  findImportConflicts,
  importMunicipalityDump,
} from "../store/muni-portability.js";

function usage(): never {
  console.error(
    "Uso: npm run db:import -- <ficheiro.json> [--slug novo-slug] [--dry-run]\n" +
      "  Importa un dump versionado dun concello (REVISION-21 Q4 / REVISION-23 R10).",
  );
  process.exit(1);
}

const args = process.argv.slice(2).filter((a) => a !== "--");
if (args.length < 1) usage();

let file: string | undefined;
let slug: string | undefined;
let dryRun = false;
for (let i = 0; i < args.length; i++) {
  const a = args[i]!;
  if (a === "--slug") {
    slug = args[++i];
    continue;
  }
  if (a.startsWith("--slug=")) {
    slug = a.slice("--slug=".length);
    continue;
  }
  if (a === "--dry-run") {
    dryRun = true;
    continue;
  }
  if (!file) file = a;
}

if (!file) usage();

const abs = path.resolve(file);
if (!fs.existsSync(abs)) {
  console.error(`Ficheiro non atopado: ${abs}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(abs, "utf8")) as unknown;

await initDb();
await migrateSchema();
try {
  if (dryRun) {
    const conflicts = await findImportConflicts(raw);
    console.info("[db:import] dry-run");
    console.info(
      `  conflitos correo: ${conflicts.emails.length}`,
      conflicts.emails,
    );
    console.info(
      `  conflitos identificador: ${conflicts.identifiers.length}`,
      conflicts.identifiers,
    );
    if (conflicts.emails.length || conflicts.identifiers.length) {
      console.info(
        "  Acción: cambia o correo/identificador no dump ou na base destino; logo importa sen --dry-run.",
      );
      process.exitCode = 2;
    } else {
      console.info("  Sen conflitos. Seguro importar.");
    }
  } else {
    const result = await importMunicipalityDump(raw, {
      slug,
      dryRun: false,
    });
    console.info(
      `[db:import] OK slug=${result.slug} id=${result.municipalityId} remapped=${result.remapped}`,
    );
  }
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[db:import] erro: ${msg}`);
  await closeDb();
  process.exit(1);
}
await closeDb();
