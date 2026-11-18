/**
 * Actividade «viva» da demo baleira (PA_DEMO_EMPTY=1).
 * Xérase tras restaurar a foto / ao arrancar / nos jobs; non vai na foto.
 * Idempotente por ids fixos `live-*`.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, like, ne } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { isDemoEmptyMode, isDemoMode } from "../env.js";
import { getLoadedDemoFileUsers } from "../identity/demo-users-file.js";
import {
  addDaysIso,
  DEFAULT_TIMEZONE,
  localDateIso,
} from "./business-rules.js";
import { DEPUTACION_PLATFORM_MUNI_ID } from "./deputacion-org.js";
import { makeShortCode, signQrPayload } from "./qr.js";

const GENERIC_NAMES = [
  "Antía Rivas",
  "Breixo Castro",
  "Carla Míguez",
  "Elena Pazos",
  "Fiz Lamas",
  "Iago Vidal",
  "Noa Ferreiro",
  "Sara Lamas",
] as const;

export type DemoLiveActivitySummary = {
  bookingsCreated: number;
  openMatchesCreated: number;
  activitiesCreated: number;
  incidentsCreated: number;
  seasonSlotsCreated: number;
  matchesCreated: number;
};

function emptySummary(): DemoLiveActivitySummary {
  return {
    bookingsCreated: 0,
    openMatchesCreated: 0,
    activitiesCreated: 0,
    incidentsCreated: 0,
    seasonSlotsCreated: 0,
    matchesCreated: 0,
  };
}

function stablePick(seed: string, mod: number): number {
  const h = createHash("sha256").update(seed).digest();
  return h[0]! % Math.max(1, mod);
}

function nextWeekendSaturday(today: string): string {
  const [y, mo, d] = today.split("-").map(Number);
  const noon = new Date(Date.UTC(y!, mo! - 1, d!, 12, 0, 0));
  const day = noon.getUTCDay();
  const toSat = day === 6 ? 7 : (6 - day + 7) % 7 || 7;
  return addDaysIso(today, toSat);
}

function sportForFacilityType(type: string): string {
  switch (type) {
    case "tenis":
      return "tenis";
    case "futbol":
    case "campo":
      return "futbol_sala";
    case "pavillon":
    case "multi":
      return "futbol_sala";
    case "baloncesto":
      return "baloncesto";
    default:
      return "tenis";
  }
}

type MuniRow = {
  id: string;
  slug: string;
  name: string;
};

type UnitRow = {
  id: string;
  facilityId: string;
  facilityType: string;
  facilityName: string;
};

async function listDemoMunicipalities(): Promise<MuniRow[]> {
  const db = getDb();
  const rows = await db.select().from(t.municipalities);
  return rows
    .filter((m) => m.id !== DEPUTACION_PLATFORM_MUNI_ID)
    .filter((m) => !(m.settings as { sandbox?: boolean })?.sandbox)
    .map((m) => ({ id: m.id, slug: m.slug, name: m.name }));
}

async function listActiveUnits(municipalityId: string): Promise<UnitRow[]> {
  const db = getDb();
  const units = await db
    .select({
      id: t.units.id,
      facilityId: t.units.facilityId,
      facilityType: t.facilities.type,
      facilityName: t.facilities.name,
      unitActive: t.units.active,
      facActive: t.facilities.active,
    })
    .from(t.units)
    .innerJoin(t.facilities, eq(t.facilities.id, t.units.facilityId))
    .where(eq(t.units.municipalityId, municipalityId));
  return units
    .filter((u) => u.unitActive && u.facActive)
    .map((u) => ({
      id: u.id,
      facilityId: u.facilityId,
      facilityType: u.facilityType,
      facilityName: u.facilityName,
    }));
}

function preferBookableUnits(units: UnitRow[]): UnitRow[] {
  const scored = [...units].sort((a, b) => {
    const score = (u: UnitRow) => {
      const n = `${u.facilityType} ${u.facilityName}`.toLowerCase();
      if (/pavill|pabell/.test(n)) return 0;
      if (/tenis/.test(n)) return 1;
      if (/futbol|sala|multi/.test(n)) return 2;
      return 3;
    };
    return score(a) - score(b);
  });
  return scored;
}

function vecinoForSlug(slug: string): {
  userId: string;
  displayName: string;
} | null {
  const users = getLoadedDemoFileUsers();
  const v = users?.find((u) => u.role === "vecino" && u.municipalitySlug === slug);
  if (v) {
    return { userId: v.id, displayName: v.displayName };
  }
  return null;
}

function clubUserForSlug(slug: string): {
  userId: string;
  displayName: string;
  clubName?: string;
} | null {
  const users = getLoadedDemoFileUsers();
  const c = users?.find((u) => u.role === "club" && u.municipalitySlug === slug);
  if (c) {
    return {
      userId: c.id,
      displayName: c.displayName,
      clubName: c.clubName,
    };
  }
  return null;
}

async function ensureOccupancyForDay(
  muni: MuniRow,
  date: string,
  units: UnitRow[],
  ratio: number,
  now: Date,
  forceAfternoonSlot: boolean,
): Promise<number> {
  const db = getDb();
  const unitIds = new Set(units.map((u) => u.id));
  const unitById = new Map(units.map((u) => [u.id, u]));
  const slots = await db
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.municipalityId, muni.id),
        eq(t.timeSlots.date, date),
        eq(t.timeSlots.closed, false),
      ),
    );
  const freeish = slots.filter((s) => unitIds.has(s.unitId));
  if (!freeish.length) return 0;

  const occupied = await db
    .select({ slotId: t.bookings.slotId, status: t.bookings.status })
    .from(t.bookings)
    .where(
      and(eq(t.bookings.municipalityId, muni.id), eq(t.bookings.date, date)),
    );
  const busy = new Set(
    occupied
      .filter((b) => b.status !== "cancelled" && b.status !== "no_show")
      .map((b) => b.slotId),
  );

  const vecino = vecinoForSlug(muni.slug);
  let created = 0;
  const target = Math.max(1, Math.floor(freeish.length * ratio));

  const candidates = [...freeish].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const picked: typeof candidates = [];
  for (const slot of candidates) {
    if (picked.length >= target) break;
    if (stablePick(`${muni.slug}:${slot.id}`, 10) < Math.round(ratio * 10)) {
      picked.push(slot);
    }
  }
  while (picked.length < target && picked.length < candidates.length) {
    const next = candidates.find((s) => !picked.includes(s));
    if (!next) break;
    picked.push(next);
  }

  if (forceAfternoonSlot) {
    const mid =
      candidates.find(
        (s) =>
          s.start >= "16:00" &&
          s.start <= "18:00" &&
          !picked.some((p) => p.id === s.id),
      ) ??
      candidates.find(
        (s) => s.start >= "16:00" && s.start <= "18:00",
      );
    if (mid && !picked.some((p) => p.id === mid.id)) {
      picked.unshift(mid);
    }
  }

  let i = 0;
  for (const slot of picked) {
    const id = `live-bk-${muni.slug}-${date.replace(/-/g, "")}-${slot.id.slice(-10)}`;
    const existing = await db
      .select({ id: t.bookings.id })
      .from(t.bookings)
      .where(eq(t.bookings.id, id))
      .limit(1);
    if (existing.length) continue;
    if (busy.has(slot.id)) continue;

    const unit = unitById.get(slot.unitId);
    if (!unit) continue;

    const useVecino = i === 0 && vecino;
    const displayName = useVecino
      ? vecino.displayName
      : GENERIC_NAMES[i % GENERIC_NAMES.length]!;
    const userId = useVecino
      ? vecino.userId
      : `live-citizen-${muni.slug}-${(i % 8) + 1}`;
    const shortCode = makeShortCode();
    try {
      await db.insert(t.bookings).values({
        id,
        municipalityId: muni.id,
        unitId: slot.unitId,
        facilityId: unit.facilityId,
        userId,
        userDisplayName: displayName,
        slotId: slot.id,
        date,
        start: slot.start,
        end: slot.end,
        status: "confirmed",
        shortCode,
        qrPayload: signQrPayload(id, date, shortCode),
        forMemberId: null,
        forMemberName: null,
        bookedByStaff: false,
        rulesVersion: null,
        createdAt: now,
      });
      busy.add(slot.id);
      created += 1;
      i += 1;
    } catch {
      /* unique / race */
    }
  }
  return created;
}

async function ensureOpenMatch(
  muni: MuniRow,
  units: UnitRow[],
  today: string,
  now: Date,
): Promise<number> {
  const db = getDb();
  const id = `live-om-${muni.slug}`;
  const existing = await db
    .select({ id: t.openMatches.id, status: t.openMatches.status })
    .from(t.openMatches)
    .where(eq(t.openMatches.id, id))
    .limit(1);
  if (existing[0]?.status === "open") return 0;

  if (existing[0]) {
    await db.delete(t.openMatchPlayers).where(eq(t.openMatchPlayers.openMatchId, id));
    await db.delete(t.openMatches).where(eq(t.openMatches.id, id));
  }

  const preferred = preferBookableUnits(units);
  if (!preferred.length) return 0;

  const vecino = vecinoForSlug(muni.slug);
  const organizerId = vecino?.userId ?? `live-org-${muni.slug}`;
  const organizerName = vecino?.displayName ?? "Veciña demo";

  for (const dayOffset of [2, 3, 1, 4]) {
    const matchDate = addDaysIso(today, dayOffset);
    for (const unit of preferred) {
      const slots = await db
        .select()
        .from(t.timeSlots)
        .where(
          and(
            eq(t.timeSlots.municipalityId, muni.id),
            eq(t.timeSlots.date, matchDate),
            eq(t.timeSlots.unitId, unit.id),
            eq(t.timeSlots.closed, false),
          ),
        );
      const freeSlots = [];
      for (const s of slots) {
        const occupied = await db
          .select({ id: t.bookings.id })
          .from(t.bookings)
          .where(
            and(
              eq(t.bookings.slotId, s.id),
              ne(t.bookings.status, "cancelled"),
              ne(t.bookings.status, "no_show"),
            ),
          )
          .limit(1);
        if (!occupied.length) freeSlots.push(s);
      }
      const slot =
        freeSlots.find((s) => s.start === "19:00") ??
        freeSlots.find((s) => s.start >= "18:00") ??
        freeSlots[0];
      if (!slot) continue;

      const sport = sportForFacilityType(unit.facilityType);
      const title =
        sport === "tenis"
          ? "Buscamos 2 para tenis"
          : sport === "baloncesto"
            ? "Buscamos 2 para baloncesto"
            : "Buscamos 2 para fútbol sala";

      try {
        await db.insert(t.openMatches).values({
          id,
          municipalityId: muni.id,
          facilityId: unit.facilityId,
          unitId: unit.id,
          bookingId: null,
          organizerUserId: organizerId,
          title,
          sport,
          date: matchDate,
          start: slot.start,
          end: slot.end,
          spotsTotal: 4,
          level: "intermedio",
          notes: null,
          status: "open",
          qrToken: randomBytes(16).toString("hex"),
          createdAt: now,
        });
        await db.insert(t.openMatchPlayers).values({
          openMatchId: id,
          userId: organizerId,
          displayName: organizerName,
          role: "organizer",
          joinedAt: now,
          nameConsentAt: now,
        });
        return 1;
      } catch (err) {
        console.warn(
          `[demo-live] open match ${muni.slug}:`,
          err instanceof Error ? err.message : err,
        );
      }
    }
  }
  return 0;
}

async function ensureActivity(
  muni: MuniRow,
  units: UnitRow[],
  today: string,
): Promise<number> {
  const db = getDb();
  const id = `live-act-${muni.slug}`;
  const existing = await db
    .select({ id: t.activities.id })
    .from(t.activities)
    .where(eq(t.activities.id, id))
    .limit(1);
  if (existing.length) return 0;
  const unit = preferBookableUnits(units)[0];
  if (!unit) return 0;
  const deadline = addDaysIso(today, 21);
  try {
    await db.insert(t.activities).values({
      id,
      municipalityId: muni.id,
      facilityId: unit.facilityId,
      name: `Escola deportiva · ${muni.name.replace(/^Concello de\s+/i, "")}`,
      description:
        "Inscricións abertas para a actividade de demostración. Praza limitada.",
      days: "Luns e mércores",
      hours: "17:00–18:00",
      places: 20,
      ageMin: 6,
      ageMax: 14,
      method: "order",
      deadline,
      lotteryStatus: "open",
      lotterySeedHash: null,
      lotterySecret: null,
      lotteryResultOrder: null,
    });
    return 1;
  } catch {
    return 0;
  }
}

async function ensureExemploIncident(
  muni: MuniRow,
  units: UnitRow[],
  now: Date,
): Promise<number> {
  if (muni.slug !== "exemplo") return 0;
  const db = getDb();
  const id = "live-inc-exemplo-open";
  const existing = await db
    .select({ id: t.incidents.id })
    .from(t.incidents)
    .where(eq(t.incidents.id, id))
    .limit(1);
  if (existing.length) return 0;
  const unit = preferBookableUnits(units)[0];
  const vecino = vecinoForSlug("exemplo");
  try {
    await db.insert(t.incidents).values({
      id,
      municipalityId: muni.id,
      facilityId: unit?.facilityId ?? null,
      userId: vecino?.userId ?? "live-citizen-exemplo-1",
      userDisplayName: vecino?.displayName ?? "Veciña A Lires",
      body: "Luz parpadeante no pavillón. Revisar antes da tarde.",
      status: "open",
      createdAt: now,
    });
    return 1;
  } catch {
    return 0;
  }
}

async function ensureExemploFsClubExtras(
  muni: MuniRow,
  units: UnitRow[],
  today: string,
): Promise<{ season: number; matches: number }> {
  if (muni.slug !== "exemplo") return { season: 0, matches: 0 };
  const db = getDb();
  const clubs = await db
    .select()
    .from(t.clubs)
    .where(eq(t.clubs.municipalityId, muni.id));
  const clubUser = clubUserForSlug("exemplo");
  const club =
    clubs.find(
      (c) =>
        /exemplo\s*fs/i.test(c.name) ||
        (clubUser?.clubName &&
          c.name.toLowerCase() === clubUser.clubName.toLowerCase()),
    ) ?? clubs[0];
  if (!club) return { season: 0, matches: 0 };

  const pav =
    preferBookableUnits(units).find((u) =>
      /pavill|pabell|multi/i.test(`${u.facilityType} ${u.facilityName}`),
    ) ?? preferBookableUnits(units)[0];
  if (!pav) return { season: 0, matches: 0 };

  let season = 0;
  for (const [idx, weekday, start, end] of [
    [1, 2, "18:00", "19:30"],
    [2, 4, "19:00", "20:30"],
  ] as const) {
    const sid = `live-ss-exemplo-${idx}`;
    const exists = await db
      .select({ id: t.seasonSlots.id })
      .from(t.seasonSlots)
      .where(eq(t.seasonSlots.id, sid))
      .limit(1);
    if (exists.length) continue;
    try {
      await db.insert(t.seasonSlots).values({
        id: sid,
        municipalityId: muni.id,
        clubId: club.id,
        facilityId: pav.facilityId,
        unitId: pav.id,
        weekday,
        start,
        end,
        priority: 1,
        seasonId: null,
        validTo: null,
      });
      season += 1;
    } catch {
      /* ignore */
    }
  }

  const homeTeamId = "live-team-exemplo-fs-a";
  const awayTeamId = "live-team-exemplo-vis";
  const teams = [
    {
      id: homeTeamId,
      clubId: club.id,
      municipalityId: muni.id,
      name: "Club Deportivo Exemplo Senior",
      category: "senior",
    },
    {
      id: awayTeamId,
      clubId: club.id,
      municipalityId: muni.id,
      name: "Visitante Demo",
      category: "senior",
    },
  ];
  for (const team of teams) {
    await db.insert(t.teams).values(team).onConflictDoNothing();
  }

  const weekend = nextWeekendSaturday(today);
  const m1 = "live-match-exemplo-clash-a";
  const m2 = "live-match-exemplo-clash-b";
  const existingClash = await db
    .select({ id: t.matches.id })
    .from(t.matches)
    .where(like(t.matches.id, "live-match-exemplo-clash-%"));
  if (existingClash.length >= 2) {
    return { season, matches: 0 };
  }

  let matches = 0;
  try {
    await db.insert(t.matches).values({
      id: m1,
      municipalityId: muni.id,
      facilityId: pav.facilityId,
      unitId: pav.id,
      date: weekend,
      start: "10:00",
      end: "11:30",
      homeTeamId,
      awayTeamId,
      clubId: club.id,
      status: "conflict",
      conflictWith: [m2],
      notes: "Choque: dous partidos na mesma franxa",
    });
    matches += 1;
  } catch {
    /* ignore */
  }
  try {
    await db.insert(t.matches).values({
      id: m2,
      municipalityId: muni.id,
      facilityId: pav.facilityId,
      unitId: pav.id,
      date: weekend,
      start: "10:15",
      end: "11:45",
      homeTeamId: awayTeamId,
      awayTeamId: homeTeamId,
      clubId: club.id,
      status: "conflict",
      conflictWith: [m1],
      notes: "Coincide con Club Deportivo Exemplo Senior",
    });
    matches += 1;
  } catch {
    /* ignore */
  }

  /* Solicitude pendente de partido (panel do concello). */
  const reqId = "live-req-exemplo-fs-match";
  const reqExists = await db
    .select({ id: t.clubRequests.id })
    .from(t.clubRequests)
    .where(eq(t.clubRequests.id, reqId))
    .limit(1);
  if (!reqExists.length) {
    const clubPerson = clubUserForSlug("exemplo");
    try {
      await db.insert(t.clubRequests).values({
        id: reqId,
        municipalityId: muni.id,
        clubId: club.id,
        type: "match",
        status: "pending",
        payload: {
          facilityId: pav.facilityId,
          unitId: pav.id,
          date: weekend,
          start: "10:00",
          end: "11:30",
          homeTeam: "Club Deportivo Exemplo Senior",
          awayTeam: "Visitante Demo",
        },
        note: "Proposta demo: partido de fin de semana (choque)",
        createdByUserId: clubPerson?.userId ?? "live-club-exemplo",
        createdByName: clubPerson?.displayName ?? "Miguel Demo Sende",
      });
    } catch {
      /* ignore */
    }
  }

  return { season, matches };
}

/**
 * Garante a actividade viva da demo baleira. Seguro chamar varias veces.
 */
export async function ensureDemoLiveActivity(
  now: Date = new Date(),
): Promise<DemoLiveActivitySummary> {
  const summary = emptySummary();
  if (!isDemoMode() || !isDemoEmptyMode()) return summary;

  const today = localDateIso(now, DEFAULT_TIMEZONE);
  const munis = await listDemoMunicipalities();
  if (!munis.length) return summary;

  for (const muni of munis) {
    const units = await listActiveUnits(muni.id);
    if (!units.length) continue;

    for (let d = 0; d <= 3; d++) {
      const date = addDaysIso(today, d);
      summary.bookingsCreated += await ensureOccupancyForDay(
        muni,
        date,
        units,
        0.3,
        now,
        d === 1,
      );
    }

    summary.openMatchesCreated += await ensureOpenMatch(
      muni,
      units,
      today,
      now,
    );
    summary.activitiesCreated += await ensureActivity(muni, units, today);
    summary.incidentsCreated += await ensureExemploIncident(muni, units, now);

    const clubExtras = await ensureExemploFsClubExtras(muni, units, today);
    summary.seasonSlotsCreated += clubExtras.season;
    summary.matchesCreated += clubExtras.matches;
  }

  return summary;
}
