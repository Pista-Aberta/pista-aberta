/**
 * REVISION-29 §3.7 — plantillas por tipo (unidades, normas en texto).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { FacilityType, RulesTextItem } from "@pista-aberta/shared";
import { getMunicipalityById } from "./db.js";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

export const FACILITY_DRAFT_RULES = "Borrador — revisar antes de publicar.";

export type UnitTemplateSpec = {
  key: string;
  name: string;
  slotMinutes?: number;
  bookingKind?: string;
  capacity?: number;
  incompatibleKeys?: string[];
};

export function unitTemplatesForFacility(
  type: FacilityType,
  courtCount: number,
  halfCourts: boolean,
): UnitTemplateSpec[] {
  const n = Math.max(1, Math.min(12, Math.floor(courtCount) || 1));
  if (type === "pavillon" && halfCourts && n === 1) {
    return [
      {
        key: "full",
        name: "Pista completa",
        slotMinutes: 90,
        incompatibleKeys: ["half-a", "half-b"],
      },
      {
        key: "half-a",
        name: "Media pista A",
        slotMinutes: 90,
        bookingKind: "clubs",
        incompatibleKeys: ["full"],
      },
      {
        key: "half-b",
        name: "Media pista B",
        slotMinutes: 90,
        bookingKind: "clubs",
        incompatibleKeys: ["full"],
      },
    ];
  }
  const label =
    type === "campo"
      ? "Campo"
      : type === "pavillon"
        ? "Pista"
        : type === "sala"
          ? "Sala"
          : "Pista";
  return Array.from({ length: n }, (_, i) => ({
    key: `court-${i + 1}`,
    name: `${label} ${i + 1}`,
    slotMinutes: type === "pavillon" ? 90 : 60,
  }));
}

export function defaultRulesTextForType(
  type: FacilityType,
  halfCourts = false,
): RulesTextItem[] {
  const base: RulesTextItem[] = [
    {
      id: "rt-calzado",
      order: 0,
      gl: "Calzado axeitado para a superficie.",
      es: "Calzado adecuado para la superficie.",
    },
    {
      id: "rt-respecto",
      order: 1,
      gl: "Respecta o tempo da franxa e deixa a instalación limpa.",
      es: "Respeta el tiempo de la franja y deja la instalación limpia.",
    },
  ];
  if (type === "pista") {
    return [
      ...base,
      {
        id: "rt-padel",
        order: 2,
        gl: "Máximo 4 xogadores por pista de pádel.",
        es: "Máximo 4 jugadores por pista de pádel.",
      },
    ];
  }
  if (type === "pavillon") {
    /* REVISION-30 Z14: a norma de medias pistas só se engade se hai medias. */
    if (!halfCourts) return base;
    return [
      ...base,
      {
        id: "rt-pav",
        order: 2,
        gl: "A pista completa e as medias pistas son incompatibles entre si.",
        es: "La pista completa y las medias pistas son incompatibles entre sí.",
      },
    ];
  }
  if (type === "campo") {
    return [
      ...base,
      {
        id: "rt-campo",
        order: 2,
        gl: "Reserva o campo completo salvo acordo co club.",
        es: "Reserva el campo completo salvo acuerdo con el club.",
      },
    ];
  }
  return [
    ...base,
    {
      id: "rt-sala",
      order: 2,
      gl: "Actividades guiadas poden ter prioridade na reserva.",
      es: "Las actividades guiadas pueden tener prioridad en la reserva.",
    },
  ];
}

export function defaultSlotMinutesForType(type: FacilityType): number {
  return type === "pavillon" ? 90 : 60;
}

type ListaRow = { ine: string; slug: string; proposedAddress?: string };

function loadListaRow(slug: string): ListaRow | null {
  const listaPath = path.join(REPO_ROOT, "data/concellos-lista.json");
  if (!fs.existsSync(listaPath)) return null;
  const lista = JSON.parse(fs.readFileSync(listaPath, "utf8")) as ListaRow[];
  return lista.find((c) => c.slug === slug) ?? null;
}

/** Centro aproximado do concello (primeiro punto OSM ou fallback galego). */
export async function resolveMunicipalityMapCenter(
  municipalityId: string,
): Promise<{ lat: number; lng: number; addressHint?: string }> {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) return { lat: 42.75, lng: -7.65 };
  const row = loadListaRow(muni.slug);
  const ine = row?.ine;
  if (ine) {
    const puntosPath = path.join(REPO_ROOT, "data/instalacions-puntos.json");
    if (fs.existsSync(puntosPath)) {
      const all = JSON.parse(fs.readFileSync(puntosPath, "utf8")) as Record<
        string,
        Array<[number, number, string]>
      >;
      const pt = all[ine]?.[0];
      if (pt) return { lat: pt[1], lng: pt[0], addressHint: row?.proposedAddress };
    }
  }
  return { lat: 42.75, lng: -7.65, addressHint: row?.proposedAddress };
}

export function isPlaceholderCoords(lat: number, lng: number): boolean {
  return Math.abs(lat - 42.78) < 0.001 && Math.abs(lng - -8.88) < 0.001;
}
