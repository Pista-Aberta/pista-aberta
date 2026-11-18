/**
 * Importar partidos CSV (MELLORAS-UX §11): parse → preview (erros/choques) → confirm.
 *
 * Formato (cabeceira flexible, ; ou ,):
 *   date,start,home,away,club,category,unit
 * Proba:
 *   2026-11-01,18:00,CD Exemplo Senior,Visitante FC,Club Deportivo Exemplo,senior,Pista completa
 */
import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { mapMatch } from "../db/mappers.js";
import { audit } from "./extra.js";
import {
  getFacility,
  listClubs,
  listFacilities,
  listTeams,
  listUnits,
} from "./db.js";

export const DEFAULT_CATEGORY_MINUTES: Record<string, number> = {
  senior: 90,
  xuvenil: 75,
  juvenil: 75,
  cadete: 75,
  infantil: 60,
  alevin: 60,
  alevín: 60,
  default: 90,
};

export type MatchCsvPreviewRow = {
  line: number;
  date: string;
  start: string;
  end: string;
  home: string;
  away: string;
  club: string;
  category: string;
  unit: string;
  clubId?: string;
  homeTeamId?: string;
  awayTeamId?: string;
  facilityId?: string;
  unitId?: string;
  errors: string[];
  conflicts: string[];
  ok: boolean;
};

export type MatchCsvPreview = {
  rows: MatchCsvPreviewRow[];
  okCount: number;
  errorCount: number;
  conflictCount: number;
  categoryMinutes: Record<string, number>;
  sampleHeaders: string[];
};

function nid(prefix: string) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function normalizeKey(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/g, " ");
}

function parseCsv(text: string): string[][] {
  const raw = text.replace(/^\uFEFF/, "").trim();
  if (!raw) return [];
  const firstLine = raw.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === '"') {
        if (inQ && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQ = !inQ;
        }
        continue;
      }
      if (ch === delim && !inQ) {
        cells.push(cur.trim());
        cur = "";
        continue;
      }
      cur += ch;
    }
    cells.push(cur.trim());
    rows.push(cells);
  }
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  date: "date",
  data: "date",
  fecha: "date",
  start: "start",
  hora: "start",
  inicio: "start",
  home: "home",
  local: "home",
  equipo_local: "home",
  away: "away",
  visitante: "away",
  equipo_visitante: "away",
  club: "club",
  club_local: "club",
  category: "category",
  categoria: "category",
  unit: "unit",
  pista: "unit",
  unidade: "unit",
  end: "end",
  fin: "end",
  fin_hora: "end",
};

function mapHeaders(header: string[]): Record<string, number> {
  const idx: Record<string, number> = {};
  header.forEach((h, i) => {
    const key = HEADER_ALIASES[normalizeKey(h).replace(/ /g, "_")] ?? HEADER_ALIASES[normalizeKey(h)];
    if (key && idx[key] === undefined) idx[key] = i;
  });
  return idx;
}

function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = (h ?? 0) * 60 + (m ?? 0) + minutes;
  const hh = Math.floor(total / 60) % 24;
  const mm = total % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function unitsConflict(
  aId: string,
  bId: string,
  incompat: Map<string, string[]>,
): boolean {
  if (aId === bId) return true;
  const a = incompat.get(aId) ?? [];
  const b = incompat.get(bId) ?? [];
  return a.includes(bId) || b.includes(aId);
}

export function resolveCategoryMinutes(
  category: string,
  overrides?: Record<string, number>,
): number {
  const key = normalizeKey(category);
  const merged = { ...DEFAULT_CATEGORY_MINUTES, ...(overrides ?? {}) };
  for (const [k, v] of Object.entries(merged)) {
    if (normalizeKey(k) === key) return v;
  }
  return merged.default ?? 90;
}

function findClub<T extends { id: string; name: string; shortName: string }>(
  clubs: readonly T[],
  name: string,
): { club: T | undefined; ambiguous: boolean } {
  const n = normalizeKey(name);
  if (!n) return { club: undefined, ambiguous: false };

  const exact =
    clubs.find((c) => normalizeKey(c.id) === n) ??
    clubs.find(
      (c) => normalizeKey(c.name) === n || normalizeKey(c.shortName) === n,
    );
  if (exact) return { club: exact, ambiguous: false };

  const partials = clubs.filter((c) => {
    const cName = normalizeKey(c.name);
    const cShort = normalizeKey(c.shortName);
    return (
      (cName.length > 0 && (cName.includes(n) || n.includes(cName))) ||
      (cShort.length > 0 && (cShort.includes(n) || n.includes(cShort)))
    );
  });

  if (partials.length === 1) return { club: partials[0], ambiguous: false };
  if (partials.length > 1) return { club: undefined, ambiguous: true };
  return { club: undefined, ambiguous: false };
}

export async function previewMatchCsv(
  municipalityId: string,
  csvText: string,
  categoryMinutes?: Record<string, number>,
): Promise<MatchCsvPreview> {
  const table = parseCsv(csvText);
  if (table.length < 2) {
    return {
      rows: [],
      okCount: 0,
      errorCount: 1,
      conflictCount: 0,
      categoryMinutes: { ...DEFAULT_CATEGORY_MINUTES, ...categoryMinutes },
      sampleHeaders: ["date", "start", "home", "away", "club", "category", "unit"],
    };
  }

  const header = table[0]!;
  const idx = mapHeaders(header);
  const required = ["date", "start", "home", "away", "club"] as const;
  const missingRequired = required.filter((k) => idx[k] === undefined);
  if (missingRequired.length) {
    return {
      rows: [
        {
          line: 1,
          date: "",
          start: "",
          end: "",
          home: "",
          away: "",
          club: "",
          category: "",
          unit: "",
          errors: [`missing_headers:${missingRequired.join(",")}`],
          conflicts: [],
          ok: false,
        },
      ],
      okCount: 0,
      errorCount: 1,
      conflictCount: 0,
      categoryMinutes: { ...DEFAULT_CATEGORY_MINUTES, ...categoryMinutes },
      sampleHeaders: ["date", "start", "home", "away", "club", "category", "unit"],
    };
  }

  const clubs = await listClubs(municipalityId);
  const teams = await listTeams(municipalityId);
  const facilities = await listFacilities(municipalityId);
  const pav =
    facilities.find((f) => f.type === "pavillon") ?? facilities[0] ?? null;

  const unitByFacility = new Map<string, Awaited<ReturnType<typeof listUnits>>>();
  const incompat = new Map<string, string[]>();
  for (const f of facilities) {
    const us = await listUnits(f.id);
    unitByFacility.set(f.id, us);
    for (const u of us) incompat.set(u.id, u.incompatibleWith ?? []);
  }

  const existing = await getDb()
    .select()
    .from(t.matches)
    .where(eq(t.matches.municipalityId, municipalityId));
  const existingMapped = existing.map(mapMatch);

  const findTeam = (clubId: string | null, name: string) => {
    const n = normalizeKey(name);
    const pool = clubId ? teams.filter((tm) => tm.clubId === clubId) : teams;
    return (
      pool.find((tm) => normalizeKey(tm.name) === n) ||
      pool.find((tm) => normalizeKey(tm.name).includes(n) || n.includes(normalizeKey(tm.name)))
    );
  };

  const findUnit = (label: string, facilityId: string) => {
    const us = unitByFacility.get(facilityId) ?? [];
    if (!label.trim()) {
      return us.find((u) => /full|completa/i.test(u.name)) ?? us[0];
    }
    const n = normalizeKey(label);
    return (
      us.find((u) => normalizeKey(u.name) === n || normalizeKey(u.id) === n) ??
      us.find((u) => normalizeKey(u.name).includes(n) || n.includes(normalizeKey(u.name)))
    );
  };

  const rows: MatchCsvPreviewRow[] = [];
  for (let i = 1; i < table.length; i++) {
    const cells = table[i]!;
    const get = (k: string) => {
      const j = idx[k];
      return j === undefined ? "" : (cells[j] ?? "").trim();
    };
    const date = get("date");
    const start = get("start");
    const home = get("home");
    const away = get("away");
    const clubName = get("club");
    const category = get("category") || "senior";
    const unitLabel = get("unit");
    const endGiven = get("end");
    const minutes = resolveCategoryMinutes(category, categoryMinutes);
    const end = endGiven || (start ? addMinutes(start, minutes) : "");

    const errors: string[] = [];
    const conflicts: string[] = [];

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push("bad_date");
    const validStart = /^\d{2}:\d{2}$/.test(start);
    const validEnd = /^\d{2}:\d{2}$/.test(end);
    if (!validStart) errors.push("bad_start");
    if (!validEnd) errors.push("bad_end");
    if (validStart && validEnd) {
      const [sh, sm] = start.split(":").map(Number);
      const crossedMidnight =
        !endGiven && (sh ?? 0) * 60 + (sm ?? 0) + minutes >= 24 * 60;
      if (end <= start || crossedMidnight) errors.push("bad_range");
    }
    if (!home) errors.push("missing_home");
    if (!away) errors.push("missing_away");
    if (!clubName) errors.push("missing_club");

    const clubLookup = clubName
      ? findClub(clubs, clubName)
      : { club: undefined, ambiguous: false };
    let club = clubLookup.club;
    // Infer club from home team name when club label is legacy / renamed
    const homeTeamGuess =
      !clubLookup.ambiguous && home ? findTeam(club?.id ?? null, home) : undefined;
    if (!club && !clubLookup.ambiguous && homeTeamGuess) {
      club = clubs.find((c) => c.id === homeTeamGuess.clubId);
    }
    if (clubLookup.ambiguous) errors.push("ambiguous_club");
    else if (clubName && !club) errors.push("unknown_club");

    let homeTeamId: string | undefined;
    let awayTeamId: string | undefined;
    let facilityId = pav?.id;
    let unitId: string | undefined;

    if (club) {
      const ht = homeTeamGuess?.clubId === club.id ? homeTeamGuess : findTeam(club.id, home);
      const at = away ? findTeam(club.id, away) : undefined;
      // Away may be external — create on confirm; home should exist or create
      homeTeamId = ht?.id;
      awayTeamId = at?.id;
      if (!facilityId) errors.push("no_facility");
      else {
        const unit = findUnit(unitLabel, facilityId);
        if (!unit) errors.push("unknown_unit");
        else {
          unitId = unit.id;
          const fac = await getFacility(facilityId);
          if (fac && fac.municipalityId !== municipalityId) errors.push("bad_facility");
        }
      }
    }

    const row: MatchCsvPreviewRow = {
      line: i + 1,
      date,
      start,
      end,
      home,
      away,
      club: clubName,
      category,
      unit: unitLabel || unitId || "",
      clubId: club?.id,
      homeTeamId,
      awayTeamId,
      facilityId,
      unitId,
      errors,
      conflicts,
      ok: false,
    };

    if (!errors.length && facilityId && unitId) {
      for (const ex of existingMapped) {
        if (ex.date !== date) continue;
        if (!overlaps(start, end, ex.start, ex.end)) continue;
        if (!unitsConflict(unitId, ex.unitId, incompat)) continue;
        conflicts.push(`existing:${ex.id}`);
      }
      for (const other of rows) {
        if (other.errors.length || !other.unitId) continue;
        if (other.date !== date) continue;
        if (!overlaps(start, end, other.start, other.end)) continue;
        if (!unitsConflict(unitId, other.unitId, incompat)) continue;
        conflicts.push(`csv_line:${other.line}`);
        other.conflicts.push(`csv_line:${row.line}`);
      }
    }

    row.ok = errors.length === 0;
    rows.push(row);
  }

  return {
    rows,
    okCount: rows.filter((r) => r.ok).length,
    errorCount: rows.filter((r) => !r.ok).length,
    conflictCount: rows.filter((r) => r.conflicts.length > 0).length,
    categoryMinutes: { ...DEFAULT_CATEGORY_MINUTES, ...categoryMinutes },
    sampleHeaders: ["date", "start", "home", "away", "club", "category", "unit"],
  };
}

export async function confirmMatchCsv(
  municipalityId: string,
  actor: string,
  csvText: string,
  categoryMinutes?: Record<string, number>,
): Promise<{ inserted: number; conflicts: number; skipped: number; matchIds: string[] }> {
  const preview = await previewMatchCsv(municipalityId, csvText, categoryMinutes);
  const toInsert = preview.rows.filter((r) => r.ok);
  if (!toInsert.length) {
    return { inserted: 0, conflicts: 0, skipped: preview.rows.length, matchIds: [] };
  }

  const teams = await listTeams(municipalityId);
  const matchIds: string[] = [];
  let conflictCount = 0;

  for (const row of toInsert) {
    const clubId = row.clubId!;
    const facilityId = row.facilityId!;
    const unitId = row.unitId!;

    let homeTeamId = row.homeTeamId;
    let awayTeamId = row.awayTeamId;

    if (!homeTeamId) {
      homeTeamId = nid("team");
      await getDb().insert(t.teams).values({
        id: homeTeamId,
        clubId,
        municipalityId,
        name: row.home,
        category: row.category || "senior",
      });
      teams.push({
        id: homeTeamId,
        clubId,
        municipalityId,
        name: row.home,
        category: row.category || "senior",
      });
    }
    if (!awayTeamId) {
      awayTeamId = nid("team");
      await getDb().insert(t.teams).values({
        id: awayTeamId,
        clubId,
        municipalityId,
        name: row.away,
        category: row.category || "senior",
      });
    }

    const id = nid("match");
    const hasConflict = row.conflicts.length > 0;
    if (hasConflict) conflictCount++;

    // Resolve conflictWith ids for existing matches mentioned
    const conflictWith: string[] = [];
    for (const c of row.conflicts) {
      if (c.startsWith("existing:")) conflictWith.push(c.slice("existing:".length));
    }

    await getDb().insert(t.matches).values({
      id,
      municipalityId,
      facilityId,
      unitId,
      date: row.date,
      start: row.start,
      end: row.end,
      homeTeamId,
      awayTeamId,
      clubId,
      status: hasConflict ? "conflict" : "scheduled",
      conflictWith,
      notes: hasConflict ? `Import CSV: choque ${row.conflicts.join(", ")}` : "Import CSV",
    });

    // Update existing matches to point back
    for (const otherId of conflictWith) {
      const rows = await getDb()
        .select()
        .from(t.matches)
        .where(and(eq(t.matches.id, otherId), eq(t.matches.municipalityId, municipalityId)))
        .limit(1);
      const ex = rows[0];
      if (!ex) continue;
      const mapped = mapMatch(ex);
      const next = [...new Set([...(mapped.conflictWith ?? []), id])];
      await getDb()
        .update(t.matches)
        .set({ status: "conflict", conflictWith: next })
        .where(eq(t.matches.id, otherId));
    }

    matchIds.push(id);
  }

  // Link csv_line conflicts between newly inserted matches
  const byLine = new Map<number, string>();
  toInsert.forEach((r, i) => byLine.set(r.line, matchIds[i]!));
  for (let i = 0; i < toInsert.length; i++) {
    const row = toInsert[i]!;
    const id = matchIds[i]!;
    const csvPeers = row.conflicts
      .filter((c) => c.startsWith("csv_line:"))
      .map((c) => byLine.get(Number(c.slice("csv_line:".length))))
      .filter((x): x is string => !!x);
    if (!csvPeers.length) continue;
    const rows = await getDb().select().from(t.matches).where(eq(t.matches.id, id)).limit(1);
    const cur = rows[0];
    if (!cur) continue;
    const mapped = mapMatch(cur);
    const next = [...new Set([...(mapped.conflictWith ?? []), ...csvPeers])];
    await getDb()
      .update(t.matches)
      .set({ status: "conflict", conflictWith: next })
      .where(eq(t.matches.id, id));
  }

  await audit(
    municipalityId,
    actor,
    "admin.matches.import_csv",
    `inserted=${matchIds.length}; conflicts=${conflictCount}; skipped=${preview.rows.length - toInsert.length}`,
  );

  return {
    inserted: matchIds.length,
    conflicts: conflictCount,
    skipped: preview.rows.length - toInsert.length,
    matchIds,
  };
}

/** Exported for unit tests without DB. */
export const __test = {
  parseCsv,
  mapHeaders,
  addMinutes,
  overlaps,
  normalizeKey,
  resolveCategoryMinutes,
  findClub,
};
