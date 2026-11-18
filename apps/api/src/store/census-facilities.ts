/**
 * REVISION-28 §3.7 — suxestións do censo OSM para alta de instalacións no panel.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import type { FacilityType } from "@pista-aberta/shared";
import { getMunicipalityById } from "./db.js";
import { createFacilityAdmin } from "./admin-ops.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export function mapOsmType(raw: string): FacilityType {
  const k = raw.toLowerCase();
  if (k.includes("pavill") || k.includes("pabell")) return "pavillon";
  if (k.includes("futbol") || k.includes("fútbol") || k.includes("campo")) return "campo";
  if (k.includes("sala")) return "sala";
  return "pista";
}

type ListaRow = {
  ine: string;
  slug: string;
  proposedAddress?: string;
};

type CensusSuggestion = {
  key: string;
  name: string;
  type: FacilityType;
  osmType: string;
  address: string;
  lat: number;
  lng: number;
  alreadyCreated: boolean;
};

function loadIneMeta(
  slug: string,
  ineFromSettings?: string | null,
): { ine: string; address: string } | null {
  const listaPath = path.join(ROOT, "data/concellos-lista.json");
  if (!fs.existsSync(listaPath)) return null;
  const lista = JSON.parse(fs.readFileSync(listaPath, "utf8")) as ListaRow[];
  const wanted = (ineFromSettings ?? "").replace(/\D/g, "").slice(0, 5);
  const row =
    (/^\d{5}$/.test(wanted) ? lista.find((c) => c.ine === wanted) : undefined) ??
    lista.find((c) => c.slug === slug);
  if (!row) return null;
  return { ine: row.ine, address: row.proposedAddress ?? "Casa do Concello" };
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

export async function listCensusFacilitySuggestions(
  municipalityId: string,
): Promise<CensusSuggestion[]> {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const meta = loadIneMeta(
    muni.slug,
    muni.settings?.ineCode ?? muni.settings?.ine,
  );
  if (!meta) return [];

  const puntosPath = path.join(ROOT, "data/instalacions-puntos.json");
  if (!fs.existsSync(puntosPath)) return [];
  const all = JSON.parse(fs.readFileSync(puntosPath, "utf8")) as Record<
    string,
    Array<[number, number, string]>
  >;
  const points = all[meta.ine] ?? [];

  const existing = await getDb()
    .select({ lat: t.facilities.lat, lng: t.facilities.lng })
    .from(t.facilities)
    .where(eq(t.facilities.municipalityId, municipalityId));
  const used = new Set(
    existing.map((f) => coordKey(Number(f.lat), Number(f.lng))),
  );

  const typeCount: Record<string, number> = {};
  const out: CensusSuggestion[] = [];
  for (let i = 0; i < points.length; i++) {
    const [lng, lat, osmType] = points[i]!;
    if (String(osmType).toLowerCase().includes("piscina")) continue;
    const type = mapOsmType(String(osmType));
    typeCount[type] = (typeCount[type] ?? 0) + 1;
    const n = typeCount[type];
    const label =
      type === "campo"
        ? `Campo ${n}`
        : type === "pavillon"
          ? `Pavillón ${n}`
          : type === "sala"
            ? `Sala ${n}`
            : `Pista ${n}`;
    out.push({
      key: `${meta.ine}-${i}`,
      name: `${label} (OSM)`,
      type,
      osmType: String(osmType),
      address: meta.address,
      lat,
      lng,
      alreadyCreated: used.has(coordKey(lat, lng)),
    });
  }
  return out;
}

export async function createFacilitiesFromCensusAdmin(
  municipalityId: string,
  actor: string,
  keys: string[],
) {
  const suggestions = await listCensusFacilitySuggestions(municipalityId);
  const pick = new Map(suggestions.map((s) => [s.key, s]));
  const created: string[] = [];
  for (const key of keys) {
    const s = pick.get(key);
    if (!s || s.alreadyCreated) continue;
    const row = await createFacilityAdmin(municipalityId, actor, {
      name: s.name,
      type: s.type,
      address: s.address,
      lat: s.lat,
      lng: s.lng,
      courtCount: 1,
    });
    created.push(row.id);
  }
  return { createdIds: created, count: created.length };
}
