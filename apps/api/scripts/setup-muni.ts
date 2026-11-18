/**
 * REVISION-23 R2 — primeiro arranque dun concello sen semente de demo.
 *
 *   docker compose exec api npm run setup -- --concello "Concello de Exemplo" --slug exemplo --ine 32078
 *
 * Crea o concello (sen sandbox) e trae do censo OSM as instalacións
 * como borrador (active=false). Remata pechando a base.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Raíz do monorepo (…/apps/api/scripts → ../../..). */
const ROOT = path.resolve(__dirname, "../../..");
/** Raíz de apps/api. */
const API_ROOT = path.resolve(__dirname, "..");

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return fallback;
}

function mapOsmType(raw: string): string {
  const k = raw.toLowerCase();
  if (k.includes("pavill") || k.includes("pabell")) return "pavillon";
  if (k.includes("tenis")) return "pista";
  if (k.includes("padel") || k.includes("pádel")) return "pista";
  if (k.includes("futbol") || k.includes("fútbol") || k.includes("campo")) return "campo";
  if (k.includes("piscina")) return "piscina";
  if (k.includes("sala")) return "sala";
  if (k.includes("baloncesto") || k.includes("multi") || k.includes("pista")) return "pista";
  return "pista";
}

function requireDatabaseUrl(): void {
  const url = process.env.DATABASE_URL?.trim() ?? "";
  const nodeEnv = (process.env.NODE_ENV ?? "").toLowerCase();
  const prodLike = nodeEnv === "production" || process.env.FORCE_POSTGRES === "1";
  if (prodLike && !url.startsWith("postgres")) {
    console.error(
      "DATABASE_URL de Postgres é obrigatorio en produción. " +
        "Executa este script co contedor da API: docker compose exec api npm run setup -- …",
    );
    process.exit(1);
  }
}

async function main() {
  const name = arg("--concello");
  const slugRaw = arg("--slug");
  const ine = arg("--ine");
  if (!name?.trim() || !slugRaw?.trim() || !ine?.trim()) {
    console.error(
      'Uso: npm run setup -- --concello "Concello de Exemplo" --slug exemplo --ine 32078',
    );
    process.exit(1);
  }
  const slug = slugRaw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (!slug) {
    console.error("slug inválido");
    process.exit(1);
  }
  const ineCode = String(ine).replace(/\D/g, "").slice(0, 5);
  if (!/^\d{5}$/.test(ineCode)) {
    console.error("INE inválido (esperábase código de 5 díxitos, p.ex. 32078)");
    process.exit(1);
  }

  requireDatabaseUrl();
  process.chdir(API_ROOT);

  const { initDb, closeDb, getDb } = await import("../src/db/client.js");
  const { migrateSchema } = await import("../src/db/migrate.js");
  const { createMunicipality, getMunicipalityBySlug } = await import(
    "../src/store/db.js"
  );
  const t = await import("../src/db/schema.js");

  await initDb();
  await migrateSchema();

  try {
    const existing = await getMunicipalityBySlug(slug);
    if (existing) {
      console.error(`Xa existe o concello /c/${slug} (${existing.id}).`);
      process.exitCode = 2;
      return;
    }

    const m = await createMunicipality({
      name: name.trim(),
      slug,
      accentColor: "#5A4636",
      theme: { brand: "#5A4636", accent: "#5A4636" },
      sandbox: false,
      ineCode,
    });
    console.log(`Concello creado: ${m.name} (${m.id}) · /c/${slug} · INE ${ineCode}`);

    type ListaFac = { name: string; type: string; courts?: number };
    type ListaRow = {
      ine: string;
      name: string;
      slug: string;
      facilities?: ListaFac[];
      proposedAddress?: string;
    };
    const listaPath = path.join(ROOT, "data/concellos-lista.json");
    const puntosPath = path.join(ROOT, "data/instalacions-puntos.json");
    let facilities: ListaFac[] = [];
    let address = `Casa do Concello`;
    if (fs.existsSync(listaPath)) {
      const lista = JSON.parse(fs.readFileSync(listaPath, "utf8")) as ListaRow[];
      const row = lista.find((c) => c.ine === ine || c.slug === slug);
      if (row) {
        facilities = row.facilities ?? [];
        address = row.proposedAddress ?? address;
      }
    }

    type Point = [number, number, string];
    let points: Point[] = [];
    if (fs.existsSync(puntosPath)) {
      const all = JSON.parse(fs.readFileSync(puntosPath, "utf8")) as Record<
        string,
        Point[]
      >;
      points = all[ine] ?? [];
    }

    const db = getDb();
    let created = 0;
    if (points.length > 0) {
      const typeCount: Record<string, number> = {};
      for (const [lng, lat, osmType] of points) {
        if (String(osmType).toLowerCase().includes("piscina")) continue;
        const type = mapOsmType(String(osmType));
        typeCount[type] = (typeCount[type] ?? 0) + 1;
        const n = typeCount[type];
        const facId = `fac-${slug}-osm-${created + 1}`;
        const label =
          type === "campo"
            ? `Campo ${n}`
            : type === "pavillon"
              ? `Pavillón ${n}`
              : type === "sala"
                ? `Sala ${n}`
                : `Pista ${n}`;
        await db.insert(t.facilities).values({
          id: facId,
          municipalityId: m.id,
          name: `${label} (OSM)`,
          type,
          address,
          lat: String(lat),
          lng: String(lng),
          accessibility: "",
          services: [],
          rules: "Borrador OSM — revisar antes de publicar.",
          active: false,
        });
        await db.insert(t.units).values({
          id: `unit-${slug}-osm-${created + 1}`,
          facilityId: facId,
          municipalityId: m.id,
          name: "Unidade 1",
          incompatibleWith: [],
          active: false,
        });
        created += 1;
      }
    } else {
      for (const f of facilities) {
        if (f.type === "piscina" || /piscina/i.test(f.name)) continue;
        const type = mapOsmType(f.type);
        const facId = `fac-${slug}-osm-${created + 1}`;
        await db.insert(t.facilities).values({
          id: facId,
          municipalityId: m.id,
          name: `${f.name} (borrador OSM)`,
          type,
          address,
          lat: "42.8",
          lng: "-8.8",
          accessibility: "",
          services: [],
          rules: "Borrador OSM — revisar antes de publicar.",
          active: false,
        });
        const courts = Math.max(1, Math.min(8, f.courts ?? 1));
        for (let i = 1; i <= courts; i++) {
          await db.insert(t.units).values({
            id: `unit-${slug}-osm-${created + 1}-${i}`,
            facilityId: facId,
            municipalityId: m.id,
            name: courts > 1 ? `Pista ${i}` : "Unidade 1",
            incompatibleWith: [],
            active: false,
          });
        }
        created += 1;
      }
    }

    console.log(
      `Instalacións borrador OSM: ${created}. Revisádeas en /c/${slug}/admin/instalacions.`,
    );
    console.log(
      "Sen semente de demo. Seguinte: docker compose exec api npm run admin -- --email persoa@concello.gal",
    );
    void randomUUID;
  } finally {
    await closeDb();
  }
}

main().catch(async (e) => {
  console.error(e);
  try {
    const { closeDb } = await import("../src/db/client.js");
    await closeDb();
  } catch {
    /* ignore */
  }
  process.exit(1);
});
