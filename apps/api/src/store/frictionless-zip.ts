/**
 * TANDA-1 / REVISION-40 N7 — export Frictionless Data Package (ZIP).
 * Táboas principais + imaxes de instalacións.
 * ?persoais=1 inclúe persoas (só admin) + audit("export.personal").
 */
import { deflateRawSync } from "node:zlib";
import { csvEscapeCell } from "@pista-aberta/shared";
import { exportFullMunicipality } from "./muni-portability.js";
import {
  getMunicipalityById,
  listActivities,
  listClubs,
  listFacilities,
} from "./db.js";
import { listClosures, listOpeningHours } from "./admin-ops.js";
import { facilitiesCatalogCsv } from "./open-data.js";
import { audit } from "./extra.js";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { eq } from "drizzle-orm";

function crc32(buf: Buffer): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
    }
  }
  return ~c >>> 0;
}

function zipStore(files: Array<{ name: string; data: Buffer }>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const nameBuf = Buffer.from(f.name, "utf8");
    const compressed = deflateRawSync(f.data);
    const useStore = compressed.length >= f.data.length;
    const payload = useStore ? f.data : compressed;
    const method = useStore ? 0 : 8;
    const crc = crc32(f.data);
    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(f.data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);
    localParts.push(local, payload);
    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(payload.length, 20);
    central.writeUInt32LE(f.data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centralParts.push(central);
    offset += local.length + payload.length;
  }
  const centralDir = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDir, end]);
}

function csvEscape(v: unknown): string {
  /* REVISION-43 R2: sempre entre comiñas + anti-fórmula. */
  return csvEscapeCell(v == null ? "" : String(v));
}

function toCsv(headers: string[], rows: unknown[][]): string {
  return [
    headers.join(","),
    ...rows.map((r) => r.map(csvEscape).join(",")),
  ].join("\n");
}

function parseDataUrl(dataUrl: string): { ext: string; body: Buffer } | null {
  const m = /^data:image\/(jpeg|jpg|png|webp|gif);base64,(.+)$/i.exec(
    dataUrl.trim(),
  );
  if (!m) return null;
  const ext = m[1]!.toLowerCase() === "jpg" ? "jpeg" : m[1]!.toLowerCase();
  try {
    return { ext, body: Buffer.from(m[2]!, "base64") };
  } catch {
    return null;
  }
}

type FieldMeta = { name: string; type: string; description?: string };

type ResourceMeta = {
  name: string;
  path: string;
  profile: string;
  format: string;
  mediatype: string;
  schema?: { fields: FieldMeta[] };
};

function pushCsv(
  files: Array<{ name: string; data: Buffer }>,
  resources: ResourceMeta[],
  name: string,
  relPath: string,
  csv: string,
  fields?: FieldMeta[],
) {
  files.push({ name: relPath, data: Buffer.from(csv, "utf8") });
  resources.push({
    name,
    path: relPath,
    profile: "tabular-data-resource",
    format: "csv",
    mediatype: "text/csv",
    ...(fields?.length ? { schema: { fields } } : {}),
  });
}

export async function buildFrictionlessZip(
  municipalityId: string,
  opts?: { persoais?: boolean; actor?: string },
): Promise<{ buffer: Buffer; filename: string }> {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");

  const [facilities, unitsRows, hours, closures, activities, clubs] =
    await Promise.all([
      listFacilities(municipalityId),
      getDb()
        .select()
        .from(t.units)
        .where(eq(t.units.municipalityId, municipalityId)),
      listOpeningHours(municipalityId),
      listClosures(municipalityId),
      listActivities(municipalityId),
      listClubs(municipalityId),
    ]);

  const resources: ResourceMeta[] = [];
  const files: Array<{ name: string; data: Buffer }> = [];

  pushCsv(
    files,
    resources,
    "instalacions",
    "data/instalacions.csv",
    facilitiesCatalogCsv(facilities),
    [
      { name: "id", type: "string", description: "Identificador da instalación" },
      { name: "name", type: "string", description: "Nome" },
      { name: "type", type: "string", description: "Tipo (pista, pavillón…)" },
      { name: "address", type: "string", description: "Enderezo" },
      { name: "lat", type: "number", description: "Latitude" },
      { name: "lng", type: "number", description: "Lonxitude" },
    ],
  );

  const geojson = {
    type: "FeatureCollection" as const,
    features: facilities
      .map((f) => {
        const lat = Number(f.lat);
        const lng = Number(f.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return {
          type: "Feature" as const,
          geometry: {
            type: "Point" as const,
            coordinates: [lng, lat] as [number, number],
          },
          properties: {
            id: f.id,
            name: f.name,
            type: f.type,
            address: f.address,
            outdoor: f.outdoor ?? false,
            active: f.active,
          },
        };
      })
      .filter((x): x is NonNullable<typeof x> => x != null),
  };
  files.push({
    name: "data/instalacions.geojson",
    data: Buffer.from(JSON.stringify(geojson, null, 2), "utf8"),
  });
  resources.push({
    name: "instalacions-geojson",
    path: "data/instalacions.geojson",
    profile: "data-resource",
    format: "geojson",
    mediatype: "application/geo+json",
    schema: {
      fields: [
        { name: "id", type: "string", description: "Identificador" },
        { name: "name", type: "string", description: "Nome" },
        { name: "type", type: "string", description: "Tipo" },
        { name: "address", type: "string", description: "Enderezo" },
      ],
    },
  });

  pushCsv(
    files,
    resources,
    "unidades",
    "data/unidades.csv",
    toCsv(
      ["id", "facilityId", "name", "capacity", "slotMinutes", "active"],
      unitsRows.map((u) => [
        u.id,
        u.facilityId,
        u.name,
        u.capacity,
        u.slotMinutes,
        u.active,
      ]),
    ),
    [
      { name: "id", type: "string", description: "Identificador da unidade" },
      { name: "facilityId", type: "string", description: "Instalación pai" },
      { name: "name", type: "string", description: "Nome" },
      { name: "capacity", type: "integer", description: "Capacidade" },
      { name: "slotMinutes", type: "integer", description: "Duración da franxa" },
      { name: "active", type: "boolean", description: "Activa" },
    ],
  );
  pushCsv(
    files,
    resources,
    "horarios",
    "data/horarios.csv",
    toCsv(
      ["id", "facilityId", "unitId", "weekday", "open", "close", "validFrom", "validTo"],
      hours.map((h) => [
        h.id,
        h.facilityId,
        h.unitId,
        h.weekday,
        h.open,
        h.close,
        h.validFrom,
        h.validTo,
      ]),
    ),
    [
      { name: "id", type: "string" },
      { name: "facilityId", type: "string" },
      { name: "unitId", type: "string" },
      { name: "weekday", type: "integer", description: "0=domingo … 6=sábado" },
      { name: "open", type: "string", description: "HH:MM" },
      { name: "close", type: "string", description: "HH:MM" },
      { name: "validFrom", type: "date" },
      { name: "validTo", type: "date" },
    ],
  );
  pushCsv(
    files,
    resources,
    "peches",
    "data/peches.csv",
    toCsv(
      ["id", "facilityId", "unitId", "startsAt", "endsAt", "reason"],
      closures.map((c) => [
        c.id,
        c.facilityId,
        c.unitId,
        c.startsAt,
        c.endsAt,
        c.reason,
      ]),
    ),
    [
      { name: "id", type: "string" },
      { name: "facilityId", type: "string" },
      { name: "unitId", type: "string" },
      { name: "startsAt", type: "datetime" },
      { name: "endsAt", type: "datetime" },
      { name: "reason", type: "string" },
    ],
  );
  pushCsv(
    files,
    resources,
    "actividades",
    "data/actividades.csv",
    toCsv(
      ["id", "name", "facilityId", "days", "hours", "places", "method", "deadline"],
      activities.map((a) => [
        a.id,
        a.name,
        a.facilityId,
        a.days,
        a.hours,
        a.places,
        a.method,
        a.deadline,
      ]),
    ),
    [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "facilityId", type: "string" },
      { name: "days", type: "string" },
      { name: "hours", type: "string" },
      { name: "places", type: "integer" },
      { name: "method", type: "string", description: "first_come | lottery" },
      { name: "deadline", type: "date" },
    ],
  );
  pushCsv(
    files,
    resources,
    "clubs",
    "data/clubs.csv",
    toCsv(
      ["id", "name", "shortName", "email", "sport"],
      clubs.map((c) => [
        c.id,
        c.name,
        c.shortName,
        c.email ?? "",
        c.sport ?? "",
      ]),
    ),
    [
      { name: "id", type: "string" },
      { name: "name", type: "string" },
      { name: "shortName", type: "string" },
      { name: "email", type: "string" },
      { name: "sport", type: "string" },
    ],
  );

  /* Imaxes das instalacións (data URL → ficheiros). */
  const imageIndex: Array<{ facilityId: string; path: string }> = [];
  for (const f of facilities) {
    const raw = f.imageDataUrl;
    if (!raw) continue;
    const parsed = parseDataUrl(raw);
    if (!parsed) continue;
    const rel = `media/${f.id}.${parsed.ext}`;
    files.push({ name: rel, data: parsed.body });
    imageIndex.push({ facilityId: f.id, path: rel });
    resources.push({
      name: `imaxe-${f.id}`,
      path: rel,
      profile: "data-resource",
      format: parsed.ext,
      mediatype: `image/${parsed.ext}`,
    });
  }
  if (imageIndex.length) {
    pushCsv(
      files,
      resources,
      "imaxes",
      "data/imaxes.csv",
      toCsv(
        ["facilityId", "path"],
        imageIndex.map((i) => [i.facilityId, i.path]),
      ),
    );
  }

  if (opts?.persoais) {
    const full = await exportFullMunicipality(municipalityId);
    const people =
      (full as { users?: Array<Record<string, unknown>> }).users ?? [];
    pushCsv(
      files,
      resources,
      "persoas",
      "data/persoas.csv",
      toCsv(
        ["id", "displayName", "email", "role"],
        people.map((p) => [p.id, p.displayName, p.email, p.role]),
      ),
    );
    await audit(
      municipalityId,
      opts.actor ?? "admin",
      "export.personal",
      `frictionless.zip persoas=${people.length}`,
    );
  }

  const datapackage = {
    profile: "data-package",
    name: `pista-aberta-${muni.slug}`,
    title: muni.name,
    licenses: [
      {
        name: muni.settings.openData?.license ?? "CC-BY-4.0",
        path: "https://creativecommons.org/licenses/by/4.0/",
      },
    ],
    resources,
  };
  files.unshift({
    name: "datapackage.json",
    data: Buffer.from(JSON.stringify(datapackage, null, 2), "utf8"),
  });

  return {
    buffer: zipStore(files),
    filename: `pista-aberta-${muni.slug}-frictionless.zip`,
  };
}
