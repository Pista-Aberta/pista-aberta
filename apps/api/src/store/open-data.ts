/**
 * REVISION-21 Q5: datos abertos reais (CSV, schema.org, ocupación agregada, DCAT-AP-ES).
 */
import { and, eq, ne, sql } from "drizzle-orm";
import { csvEscapeCell } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { exportOpenData, getMunicipalityById, listFacilities } from "./db.js";

export const DEFAULT_OPEN_DATA_LICENSE = "CC BY 4.0";
/** URI CC BY 4.0 para DCAT-AP-ES (REVISION-23 R13). */
export const DEFAULT_OPEN_DATA_LICENSE_URI =
  "http://creativecommons.org/licenses/by/4.0/";
export const DEFAULT_OPEN_DATA_CATALOG = "DCAT-AP-ES";

const LANG_GL =
  "http://publications.europa.eu/resource/authority/language/GLG";
const LANG_ES =
  "http://publications.europa.eu/resource/authority/language/SPA";

export function licenseToUri(license: string): string {
  const l = license.trim();
  if (/^https?:\/\//i.test(l)) return l;
  if (/cc\s*by\s*4\.0/i.test(l) || l === "CC BY 4.0") {
    return DEFAULT_OPEN_DATA_LICENSE_URI;
  }
  return l || DEFAULT_OPEN_DATA_LICENSE_URI;
}

export function resolveOpenDataMeta(settings: {
  openData?: { license?: string; dir3?: string; catalogPublisher?: string };
  legal?: { titular?: string };
}): {
  license: string;
  licenseUri: string;
  dir3: string;
  catalogPublisher: string;
  catalog: string;
} {
  const license = settings.openData?.license?.trim() || DEFAULT_OPEN_DATA_LICENSE;
  const dir3 = settings.openData?.dir3?.trim() || "";
  const catalogPublisher =
    settings.openData?.catalogPublisher?.trim() ||
    settings.legal?.titular?.trim() ||
    "";
  return {
    license,
    licenseUri: licenseToUri(license),
    dir3,
    catalogPublisher,
    catalog: DEFAULT_OPEN_DATA_CATALOG,
  };
}

export async function openDataPayload(municipalityId: string) {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const meta = resolveOpenDataMeta(muni.settings);
  const open = await exportOpenData(municipalityId);
  return {
    ...meta,
    slug: muni.slug,
    name: muni.name,
    ...open,
  };
}

/** Catálogo CSV de instalacións (sen PII). */
export function facilitiesCatalogCsv(
  facilities: Array<{
    id: string;
    name: string;
    type: string;
    address: string;
    lat: number;
    lng: number;
    accessibility: string;
    services: string[];
  }>,
): string {
  const header = "id,name,type,address,lat,lng,accessibility,services";
  const rows = facilities.map((f) => {
    return [
      csvEscapeCell(f.id),
      csvEscapeCell(f.name),
      csvEscapeCell(f.type),
      csvEscapeCell(f.address),
      String(f.lat),
      String(f.lng),
      csvEscapeCell(f.accessibility ?? ""),
      csvEscapeCell((f.services ?? []).join("|")),
    ].join(",");
  });
  return [header, ...rows].join("\n");
}

/** JSON-LD schema.org SportsActivityLocation por instalación. */
export function facilitiesSchemaOrgJsonLd(
  muni: { name: string; slug: string },
  facilities: Array<{
    id: string;
    name: string;
    type: string;
    address: string;
    lat: number;
    lng: number;
  }>,
  baseUrl: string,
): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": facilities.map((f) => ({
      "@type": "SportsActivityLocation",
      "@id": `${baseUrl}/c/${muni.slug}/instalacions#${f.id}`,
      name: f.name,
      description: `${f.type} · ${muni.name}`,
      address: {
        "@type": "PostalAddress",
        streetAddress: f.address,
        addressLocality: muni.name,
        addressCountry: "ES",
      },
      geo: {
        "@type": "GeoCoordinates",
        latitude: f.lat,
        longitude: f.lng,
      },
      publicAccess: true,
      isAccessibleForFree: true,
    })),
  };
}

export type OccupancyAggregateRow = {
  facilityId: string;
  facilityName: string;
  weekday: number;
  hour: string;
  booked: number;
  free: number;
  closed: number;
  occupancyPct: number;
};

/**
 * Ocupación agregada por instalación / día da semana / hora (sen PII).
 * Base: franxas existentes + reservas non canceladas.
 */
export async function occupancyAggregate(
  municipalityId: string,
): Promise<OccupancyAggregateRow[]> {
  const facilities = await listFacilities(municipalityId);
  const nameById = new Map(facilities.map((f) => [f.id, f.name]));
  const units = await getDb()
    .select()
    .from(t.units)
    .where(eq(t.units.municipalityId, municipalityId));
  const facilityByUnit = new Map(units.map((u) => [u.id, u.facilityId]));

  const slots = await getDb()
    .select()
    .from(t.timeSlots)
    .where(eq(t.timeSlots.municipalityId, municipalityId));

  const booked = await getDb()
    .select({ slotId: t.bookings.slotId })
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        ne(t.bookings.status, "cancelled"),
      ),
    );
  const bookedSet = new Set(booked.map((b) => b.slotId));

  type Acc = { booked: number; free: number; closed: number };
  const map = new Map<string, Acc>();

  for (const s of slots) {
    const facilityId = facilityByUnit.get(s.unitId);
    if (!facilityId) continue;
    const weekday = new Date(`${s.date}T12:00:00Z`).getUTCDay();
    const key = `${facilityId}|${weekday}|${s.start}`;
    const acc = map.get(key) ?? { booked: 0, free: 0, closed: 0 };
    if (s.closed) acc.closed += 1;
    else if (bookedSet.has(s.id)) acc.booked += 1;
    else acc.free += 1;
    map.set(key, acc);
  }

  const rows: OccupancyAggregateRow[] = [];
  for (const [key, acc] of map) {
    const [facilityId, wd, hour] = key.split("|") as [string, string, string];
    const open = acc.booked + acc.free;
    rows.push({
      facilityId,
      facilityName: nameById.get(facilityId) ?? facilityId,
      weekday: Number(wd),
      hour,
      booked: acc.booked,
      free: acc.free,
      closed: acc.closed,
      occupancyPct: open === 0 ? 0 : Math.round((1000 * acc.booked) / open) / 10,
    });
  }
  rows.sort(
    (a, b) =>
      a.facilityName.localeCompare(b.facilityName) ||
      a.weekday - b.weekday ||
      a.hour.localeCompare(b.hour),
  );
  return rows;
}

export function occupancyAggregateCsv(rows: OccupancyAggregateRow[]): string {
  const header =
    "facility_id,facility_name,weekday,hour,booked,free,closed,occupancy_pct";
  const lines = rows.map((r) =>
    [
      csvEscapeCell(r.facilityId),
      csvEscapeCell(r.facilityName),
      r.weekday,
      r.hour,
      r.booked,
      r.free,
      r.closed,
      r.occupancyPct,
    ].join(","),
  );
  return [header, ...lines].join("\n");
}

/** Catálogo DCAT-AP-ES en JSON-LD (REVISION-23 R13). */
export function dcatApEsJsonLd(input: {
  muni: { id: string; slug: string; name: string; createdAt?: Date | string };
  license: string;
  dir3: string;
  catalogPublisher: string;
  baseUrl: string;
  issued?: string;
  modified?: string;
}): Record<string, unknown> {
  const { muni, license, dir3, catalogPublisher, baseUrl } = input;
  const licenseUri = licenseToUri(license);
  const catalogId = `${baseUrl}/api/c/${muni.slug}/datos-abertos/dcat.jsonld`;
  const nowIso = new Date().toISOString();
  const issued =
    input.issued ||
    (muni.createdAt
      ? new Date(muni.createdAt).toISOString()
      : nowIso);
  const modified = input.modified || nowIso;
  const publisher: Record<string, unknown> = {
    "@type": "org:Organization",
    "foaf:name": catalogPublisher || muni.name,
  };
  if (dir3) {
    publisher["dct:identifier"] = dir3;
    publisher["@id"] =
      `http://datos.gob.es/recurso/sector-publico/org/Organismo/${dir3}`;
  }
  return {
    "@context": {
      dcat: "http://www.w3.org/ns/dcat#",
      dct: "http://purl.org/dc/terms/",
      foaf: "http://xmlns.com/foaf/0.1/",
      org: "http://www.w3.org/ns/org#",
      vcard: "http://www.w3.org/2006/vcard/ns#",
      xsd: "http://www.w3.org/2001/XMLSchema#",
    },
    "@graph": [
      {
        "@id": catalogId,
        "@type": "dcat:Catalog",
        "dct:title": `Datos abertos · ${muni.name}`,
        "dct:description":
          "Catálogo de instalacións deportivas e ocupación agregada (sen datos persoais).",
        "dct:publisher": publisher,
        "dct:language": [{ "@id": LANG_GL }, { "@id": LANG_ES }],
        "dct:license": { "@id": licenseUri },
        "dct:issued": { "@type": "xsd:dateTime", "@value": issued },
        "dct:modified": { "@type": "xsd:dateTime", "@value": modified },
        "dcat:dataset": [
          { "@id": `${catalogId}#instalacions` },
          { "@id": `${catalogId}#ocupacion` },
        ],
      },
      {
        "@id": `${catalogId}#instalacions`,
        "@type": "dcat:Dataset",
        "dct:title": "Catálogo de instalacións deportivas",
        "dct:description": "Listado de instalacións (GeoJSON, CSV, schema.org).",
        "dct:license": { "@id": licenseUri },
        "dct:issued": { "@type": "xsd:dateTime", "@value": issued },
        "dct:modified": { "@type": "xsd:dateTime", "@value": modified },
        "dct:language": [{ "@id": LANG_GL }, { "@id": LANG_ES }],
        "dcat:keyword": ["deporte", "instalacións", "municipio"],
        "dcat:theme": "http://datos.gob.es/kos/sector-publico/sector/deporte",
        "dcat:distribution": [
          {
            "@type": "dcat:Distribution",
            "dct:title": "GeoJSON",
            "dcat:accessURL": `${baseUrl}/api/c/${muni.slug}/datos-abertos/instalacions.geojson`,
            "dcat:mediaType": "application/geo+json",
          },
          {
            "@type": "dcat:Distribution",
            "dct:title": "CSV",
            "dcat:accessURL": `${baseUrl}/api/c/${muni.slug}/datos-abertos/instalacions.csv`,
            "dcat:mediaType": "text/csv",
          },
          {
            "@type": "dcat:Distribution",
            "dct:title": "JSON-LD schema.org SportsActivityLocation",
            "dcat:accessURL": `${baseUrl}/api/c/${muni.slug}/datos-abertos/instalacions.jsonld`,
            "dcat:mediaType": "application/ld+json",
          },
        ],
      },
      {
        "@id": `${catalogId}#ocupacion`,
        "@type": "dcat:Dataset",
        "dct:title": "Ocupación agregada por instalación, día e hora",
        "dct:description":
          "Contadores agregados sen datos persoais (booked/free/closed).",
        "dct:license": { "@id": licenseUri },
        "dct:issued": { "@type": "xsd:dateTime", "@value": issued },
        "dct:modified": { "@type": "xsd:dateTime", "@value": modified },
        "dcat:keyword": ["ocupación", "deporte", "agregado"],
        "dcat:distribution": [
          {
            "@type": "dcat:Distribution",
            "dct:title": "JSON",
            "dcat:accessURL": `${baseUrl}/api/c/${muni.slug}/datos-abertos/ocupacion.json`,
            "dcat:mediaType": "application/json",
          },
          {
            "@type": "dcat:Distribution",
            "dct:title": "CSV",
            "dcat:accessURL": `${baseUrl}/api/c/${muni.slug}/datos-abertos/ocupacion.csv`,
            "dcat:mediaType": "text/csv",
          },
        ],
      },
    ],
  };
}

void sql;
