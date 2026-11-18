/**
 * REVISION-21 Q4: exportación/importación completa dun concello (JSON versionado).
 */
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { getMunicipalityById } from "./db.js";

export const MUNI_EXPORT_VERSION = 1 as const;

export type MunicipalityExport = {
  version: typeof MUNI_EXPORT_VERSION;
  exportedAt: string;
  slug: string;
  municipality: typeof t.municipalities.$inferSelect;
  users: Array<typeof t.users.$inferSelect>;
  facilities: Array<typeof t.facilities.$inferSelect>;
  units: Array<typeof t.units.$inferSelect>;
  openingHours: Array<typeof t.openingHours.$inferSelect>;
  closures: Array<typeof t.closures.$inferSelect>;
  timeSlots: Array<typeof t.timeSlots.$inferSelect>;
  bookings: Array<typeof t.bookings.$inferSelect>;
  clubs: Array<typeof t.clubs.$inferSelect>;
  teams: Array<typeof t.teams.$inferSelect>;
  matches: Array<typeof t.matches.$inferSelect>;
  seasons: Array<typeof t.seasons.$inferSelect>;
  seasonSlots: Array<typeof t.seasonSlots.$inferSelect>;
  clubMembers: Array<typeof t.clubMembers.$inferSelect>;
  clubRequests: Array<typeof t.clubRequests.$inferSelect>;
  activities: Array<typeof t.activities.$inferSelect>;
  activityApplications: Array<typeof t.activityApplications.$inferSelect>;
  notices: Array<typeof t.notices.$inferSelect>;
  familyMembers: Array<typeof t.familyMembers.$inferSelect>;
  waitlistEntries: Array<typeof t.waitlistEntries.$inferSelect>;
  incidents: Array<typeof t.incidents.$inferSelect>;
  fixedGroups: Array<typeof t.fixedGroups.$inferSelect>;
  auditEvents: Array<typeof t.auditEvents.$inferSelect>;
  slotSwaps: Array<typeof t.slotSwaps.$inferSelect>;
  openMatches: Array<typeof t.openMatches.$inferSelect>;
  openMatchPlayers: Array<typeof t.openMatchPlayers.$inferSelect>;
  openMatchInvites: Array<typeof t.openMatchInvites.$inferSelect>;
  userRoles: Array<typeof t.userRoles.$inferSelect>;
};

export async function exportFullMunicipality(
  municipalityId: string,
): Promise<MunicipalityExport> {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) throw new Error("not_found");
  const db = getDb();
  const municipalityRows = await db
    .select()
    .from(t.municipalities)
    .where(eq(t.municipalities.id, municipalityId))
    .limit(1);
  const municipality = municipalityRows[0];
  if (!municipality) throw new Error("not_found");

  const mid = eq;
  const [
    users,
    facilities,
    units,
    openingHours,
    closures,
    timeSlots,
    bookings,
    clubs,
    teams,
    matches,
    seasons,
    seasonSlots,
    clubMembers,
    clubRequests,
    activities,
    activityApplications,
    notices,
    familyMembers,
    waitlistEntries,
    incidents,
    fixedGroups,
    auditEvents,
    slotSwaps,
    openMatches,
    userRoles,
  ] = await Promise.all([
    db.select().from(t.users).where(mid(t.users.municipalityId, municipalityId)),
    db.select().from(t.facilities).where(mid(t.facilities.municipalityId, municipalityId)),
    db.select().from(t.units).where(mid(t.units.municipalityId, municipalityId)),
    db.select().from(t.openingHours).where(mid(t.openingHours.municipalityId, municipalityId)),
    db.select().from(t.closures).where(mid(t.closures.municipalityId, municipalityId)),
    db.select().from(t.timeSlots).where(mid(t.timeSlots.municipalityId, municipalityId)),
    db.select().from(t.bookings).where(mid(t.bookings.municipalityId, municipalityId)),
    db.select().from(t.clubs).where(mid(t.clubs.municipalityId, municipalityId)),
    db.select().from(t.teams).where(mid(t.teams.municipalityId, municipalityId)),
    db.select().from(t.matches).where(mid(t.matches.municipalityId, municipalityId)),
    db.select().from(t.seasons).where(mid(t.seasons.municipalityId, municipalityId)),
    db.select().from(t.seasonSlots).where(mid(t.seasonSlots.municipalityId, municipalityId)),
    db.select().from(t.clubMembers).where(mid(t.clubMembers.municipalityId, municipalityId)),
    db.select().from(t.clubRequests).where(mid(t.clubRequests.municipalityId, municipalityId)),
    db.select().from(t.activities).where(mid(t.activities.municipalityId, municipalityId)),
    db
      .select()
      .from(t.activityApplications)
      .where(mid(t.activityApplications.municipalityId, municipalityId)),
    db.select().from(t.notices).where(mid(t.notices.municipalityId, municipalityId)),
    db.select().from(t.familyMembers).where(mid(t.familyMembers.municipalityId, municipalityId)),
    db
      .select()
      .from(t.waitlistEntries)
      .where(mid(t.waitlistEntries.municipalityId, municipalityId)),
    db.select().from(t.incidents).where(mid(t.incidents.municipalityId, municipalityId)),
    db.select().from(t.fixedGroups).where(mid(t.fixedGroups.municipalityId, municipalityId)),
    db.select().from(t.auditEvents).where(mid(t.auditEvents.municipalityId, municipalityId)),
    db.select().from(t.slotSwaps).where(mid(t.slotSwaps.municipalityId, municipalityId)),
    db.select().from(t.openMatches).where(mid(t.openMatches.municipalityId, municipalityId)),
    db.select().from(t.userRoles).where(mid(t.userRoles.municipalityId, municipalityId)),
  ]);

  const openMatchIds = openMatches.map((om) => om.id);
  const openMatchPlayers =
    openMatchIds.length > 0
      ? await db
          .select()
          .from(t.openMatchPlayers)
          .where(inArray(t.openMatchPlayers.openMatchId, openMatchIds))
      : [];
  const openMatchInvites = await db
    .select()
    .from(t.openMatchInvites)
    .where(mid(t.openMatchInvites.municipalityId, municipalityId));

  const scrubbedUsers = users.map((u) => ({
    ...u,
    calendarFeedToken: null,
  }));

  return {
    version: MUNI_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    slug: muni.slug,
    municipality,
    users: scrubbedUsers,
    facilities,
    units,
    openingHours,
    closures,
    timeSlots,
    bookings,
    clubs,
    teams,
    matches,
    seasons,
    seasonSlots,
    clubMembers,
    clubRequests,
    /* REVISION-56 H6: non exportar segredo do sorteo antes de drawn. */
    activities: activities.map((a) =>
      a.lotteryStatus === "drawn" ? a : { ...a, lotterySecret: null },
    ),
    activityApplications,
    notices,
    familyMembers,
    waitlistEntries,
    incidents,
    fixedGroups,
    auditEvents,
    slotSwaps,
    openMatches,
    openMatchPlayers,
    openMatchInvites,
    userRoles,
  };
}

function remapId(oldId: string, map: Map<string, string>, prefix: string): string {
  const existing = map.get(oldId);
  if (existing) return existing;
  const next = `${prefix}-${randomUUID().slice(0, 10)}`;
  map.set(oldId, next);
  return next;
}

function parseExport(raw: unknown): MunicipalityExport {
  if (!raw || typeof raw !== "object") throw new Error("invalid_export");
  const o = raw as Record<string, unknown>;
  if (o.version !== MUNI_EXPORT_VERSION) throw new Error("unsupported_version");
  if (!o.municipality || typeof o.municipality !== "object") {
    throw new Error("invalid_export");
  }
  /* Retrocompat: dumps v1 antigos sen as táboas novas. */
  const withDefaults = {
    ...o,
    seasons: Array.isArray(o.seasons) ? o.seasons : [],
    openMatches: Array.isArray(o.openMatches) ? o.openMatches : [],
    openMatchPlayers: Array.isArray(o.openMatchPlayers) ? o.openMatchPlayers : [],
    openMatchInvites: Array.isArray(o.openMatchInvites) ? o.openMatchInvites : [],
    userRoles: Array.isArray(o.userRoles) ? o.userRoles : [],
  };
  return withDefaults as MunicipalityExport;
}

function asDate(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}


export type ImportConflictReport = {
  emails: Array<{ email: string; existingUserId: string; existingMunicipalityId: string }>;
  identifiers: Array<{
    personIdentifier: string;
    existingUserId: string;
    existingMunicipalityId: string;
  }>;
};

/** REVISION-23 R10 — conflitos antes de escribir nada. */
export async function findImportConflicts(
  raw: unknown,
): Promise<ImportConflictReport> {
  const dump = parseExport(raw);
  const db = getDb();
  const emails: ImportConflictReport["emails"] = [];
  const identifiers: ImportConflictReport["identifiers"] = [];
  for (const u of dump.users ?? []) {
    const email = (u.email ?? "").trim().toLowerCase();
    if (email) {
      const rows = await db
        .select({
          id: t.users.id,
          municipalityId: t.users.municipalityId,
        })
        .from(t.users)
        .where(eq(t.users.email, email))
        .limit(1);
      if (rows[0]) {
        emails.push({
          email,
          existingUserId: rows[0].id,
          existingMunicipalityId: rows[0].municipalityId,
        });
      }
    }
    const pid = (u.personIdentifier ?? "").trim();
    if (pid) {
      const rows = await db
        .select({
          id: t.users.id,
          municipalityId: t.users.municipalityId,
        })
        .from(t.users)
        .where(eq(t.users.personIdentifier, pid))
        .limit(1);
      if (rows[0]) {
        identifiers.push({
          personIdentifier: pid,
          existingUserId: rows[0].id,
          existingMunicipalityId: rows[0].municipalityId,
        });
      }
    }
  }
  return { emails, identifiers };
}

/**
 * Importa un dump versionado. Con `--slug novo` crea un concello novo
 * (IDs remapeados). Fallo se o slug destino xa existe.
 */
export async function importMunicipalityDump(
  raw: unknown,
  opts?: { slug?: string; dryRun?: boolean },
): Promise<{
  municipalityId: string;
  slug: string;
  remapped: boolean;
  dryRun?: boolean;
  conflicts?: ImportConflictReport;
}> {
  const dump = parseExport(raw);
  const conflicts = await findImportConflicts(dump);
  if (opts?.dryRun) {
    return {
      municipalityId: "",
      slug: (opts?.slug ?? dump.slug).trim().toLowerCase(),
      remapped: false,
      dryRun: true,
      conflicts,
    };
  }
  if (conflicts.emails.length > 0 || conflicts.identifiers.length > 0) {
    const emails = conflicts.emails.map((e) => e.email).join(", ");
    const ids = conflicts.identifiers.map((e) => e.personIdentifier).join(", ");
    throw new Error(
      `import_conflicts: hai persoas que xa existen noutro concello` +
        (emails ? ` · correos: ${emails}` : "") +
        (ids ? ` · identificadores: ${ids}` : "") +
        `. Resolve os conflitos e volve importar (ou --dry-run para o informe). Nada foi creado.`,
    );
  }

  const db = getDb();
  const newSlug = (opts?.slug ?? dump.slug).trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(newSlug)) throw new Error("invalid_slug");

  const existing = await db
    .select({ id: t.municipalities.id })
    .from(t.municipalities)
    .where(eq(t.municipalities.slug, newSlug))
    .limit(1);
  if (existing[0]) throw new Error("slug_exists");

  const remapped = Boolean(opts?.slug) && opts!.slug !== dump.slug;
  const maps = {
    muni: new Map<string, string>(),
    user: new Map<string, string>(),
    facility: new Map<string, string>(),
    unit: new Map<string, string>(),
    slot: new Map<string, string>(),
    booking: new Map<string, string>(),
    club: new Map<string, string>(),
    team: new Map<string, string>(),
    match: new Map<string, string>(),
    activity: new Map<string, string>(),
    season: new Map<string, string>(),
    openMatch: new Map<string, string>(),
    other: new Map<string, string>(),
  };

  const mapOr = (old: string, map: Map<string, string>, prefix: string) =>
    remapped ? remapId(old, map, prefix) : (map.set(old, old), old);

  const mid = remapped
    ? remapId(dump.municipality.id, maps.muni, `muni-${newSlug}`)
    : dump.municipality.id;
  if (!remapped) maps.muni.set(dump.municipality.id, mid);

  return await db.transaction(async (tx) => {
  const m = dump.municipality;
  await tx.insert(t.municipalities).values({
    id: mid,
    slug: newSlug,
    name: remapped ? `${m.name} (${newSlug})` : m.name,
    accentColor: m.accentColor,
    locales: m.locales,
    settings: m.settings,
    createdAt: asDate(m.createdAt) ?? new Date(),
  });

  /* Clubs primeiro (clubId en users). */
  for (const c of dump.clubs ?? []) {
    await tx.insert(t.clubs).values({
      id: mapOr(c.id, maps.club, "club"),
      municipalityId: mid,
      name: c.name,
      shortName: c.shortName,
      cif: (c as { cif?: string | null }).cif ?? null,
      sport: (c as { sport?: string | null }).sport ?? null,
      email: (c as { email?: string | null }).email ?? null,
    });
  }

  for (const u of dump.users ?? []) {
    await tx.insert(t.users).values({
      id: mapOr(u.id, maps.user, "user"),
      municipalityId: mid,
      role: u.role,
      displayName: u.displayName,
      email: u.email,
      phone: u.phone ?? null,
      personIdentifier: u.personIdentifier,
      locale: u.locale,
      active: u.active ?? true,
      clubId: u.clubId ? mapOr(u.clubId, maps.club, "club") : null,
      consentAt: asDate(u.consentAt),
      consentVersion: u.consentVersion,
      notifyEmail: u.notifyEmail ?? true,
      notifyReminders: u.notifyReminders ?? true,
      notifyPrefs: u.notifyPrefs ?? null,
      calendarFeedToken: null,
      bookingBlockedUntil: asDate(u.bookingBlockedUntil),
      createdAt: asDate(u.createdAt) ?? new Date(),
    });
  }

  for (const f of dump.facilities ?? []) {
    const fr = f as typeof f & {
      outdoor?: boolean;
      checkInRequired?: boolean;
      openMatchesAllowed?: boolean | null;
      imageAlt?: string | null;
    };
    await tx.insert(t.facilities).values({
      id: mapOr(f.id, maps.facility, "fac"),
      municipalityId: mid,
      name: f.name,
      type: f.type,
      address: f.address,
      lat: f.lat,
      lng: f.lng,
      accessibility: f.accessibility,
      services: f.services,
      rules: f.rules,
      active: f.active,
      outdoor: fr.outdoor ?? false,
      checkInRequired: fr.checkInRequired ?? false,
      openMatchesAllowed: fr.openMatchesAllowed ?? null,
      imageDataUrl: f.imageDataUrl,
      imageAlt: fr.imageAlt ?? null,
      rulesOverride: f.rulesOverride,
      rulesText: f.rulesText,
      contactPhone: f.contactPhone ?? null,
      contactEmail: f.contactEmail ?? null,
      contactPerson: f.contactPerson ?? null,
      parkingInfo: f.parkingInfo ?? null,
      publicTransport: f.publicTransport ?? null,
      entranceInfo: f.entranceInfo ?? null,
    });
  }

  for (const u of dump.units ?? []) {
    const incompatible = ((u.incompatibleWith as string[] | null) ?? []).map((x) =>
      mapOr(x, maps.unit, "unit"),
    );
    await tx.insert(t.units).values({
      id: mapOr(u.id, maps.unit, "unit"),
      facilityId: mapOr(u.facilityId, maps.facility, "fac"),
      municipalityId: mid,
      name: u.name,
      incompatibleWith: incompatible,
      bookingKind: u.bookingKind ?? "ambas",
      slotMinutes: u.slotMinutes ?? 60,
      capacity: u.capacity ?? 4,
      active: u.active ?? true,
    });
  }

  for (const h of dump.openingHours ?? []) {
    await tx.insert(t.openingHours).values({
      id: mapOr(h.id, maps.other, "oh"),
      municipalityId: mid,
      facilityId: h.facilityId ? mapOr(h.facilityId, maps.facility, "fac") : null,
      unitId: h.unitId ? mapOr(h.unitId, maps.unit, "unit") : null,
      weekday: h.weekday,
      open: h.open,
      close: h.close,
      validFrom: h.validFrom,
      validTo: h.validTo,
    });
  }

  for (const c of dump.closures ?? []) {
    await tx.insert(t.closures).values({
      id: mapOr(c.id, maps.other, "cl"),
      municipalityId: mid,
      facilityId: c.facilityId ? mapOr(c.facilityId, maps.facility, "fac") : null,
      unitId: c.unitId ? mapOr(c.unitId, maps.unit, "unit") : null,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      reason: c.reason,
      notifyCitizens: c.notifyCitizens ?? true,
      createdAt: asDate(c.createdAt) ?? new Date(),
    });
  }

  for (const s of dump.timeSlots ?? []) {
    await tx.insert(t.timeSlots).values({
      id: mapOr(s.id, maps.slot, "slot"),
      unitId: mapOr(s.unitId, maps.unit, "unit"),
      municipalityId: mid,
      date: s.date,
      start: s.start,
      end: s.end,
      closed: s.closed ?? false,
      closedReason: s.closedReason,
      heldForUserId: s.heldForUserId
        ? mapOr(s.heldForUserId, maps.user, "user")
        : null,
      heldUntil: asDate(s.heldUntil),
    });
  }

  for (const team of dump.teams ?? []) {
    await tx.insert(t.teams).values({
      id: mapOr(team.id, maps.team, "team"),
      clubId: mapOr(team.clubId, maps.club, "club"),
      municipalityId: mid,
      name: team.name,
      category: team.category,
    });
  }

  for (const mrow of dump.matches ?? []) {
    const conflictWith = ((mrow.conflictWith as string[] | null) ?? []).map((x) =>
      mapOr(x, maps.match, "match"),
    );
    await tx.insert(t.matches).values({
      id: mapOr(mrow.id, maps.match, "match"),
      municipalityId: mid,
      facilityId: mapOr(mrow.facilityId, maps.facility, "fac"),
      unitId: mapOr(mrow.unitId, maps.unit, "unit"),
      date: mrow.date,
      start: mrow.start,
      end: mrow.end,
      homeTeamId: mapOr(mrow.homeTeamId, maps.team, "team"),
      awayTeamId: mapOr(mrow.awayTeamId, maps.team, "team"),
      clubId: mapOr(mrow.clubId, maps.club, "club"),
      status: mrow.status,
      conflictWith,
      notes: mrow.notes,
    });
  }

  for (const season of dump.seasons ?? []) {
    const facilityIds = ((season.facilityIds as string[] | null) ?? []).map((x) =>
      mapOr(x, maps.facility, "fac"),
    );
    await tx.insert(t.seasons).values({
      id: mapOr(season.id, maps.season, "season"),
      municipalityId: mid,
      name: season.name,
      startsAt: season.startsAt,
      endsAt: season.endsAt,
      facilityIds,
      criteriaGl: season.criteriaGl ?? "",
      criteriaEs: season.criteriaEs ?? "",
      published: season.published ?? false,
      createdAt: asDate(season.createdAt) ?? new Date(),
    });
  }

  for (const s of dump.seasonSlots ?? []) {
    const sr = s as typeof s & { seasonId?: string | null; validTo?: string | null };
    await tx.insert(t.seasonSlots).values({
      id: mapOr(s.id, maps.other, "ss"),
      municipalityId: mid,
      clubId: mapOr(s.clubId, maps.club, "club"),
      facilityId: mapOr(s.facilityId, maps.facility, "fac"),
      unitId: mapOr(s.unitId, maps.unit, "unit"),
      weekday: s.weekday,
      start: s.start,
      end: s.end,
      priority: s.priority ?? 1,
      seasonId: sr.seasonId ? mapOr(sr.seasonId, maps.season, "season") : null,
      validTo: sr.validTo ?? null,
    });
  }

  for (const cm of dump.clubMembers ?? []) {
    const cmr = cm as typeof cm & { userId?: string | null };
    await tx.insert(t.clubMembers).values({
      id: mapOr(cm.id, maps.other, "cm"),
      clubId: mapOr(cm.clubId, maps.club, "club"),
      municipalityId: mid,
      displayName: cm.displayName,
      email: cm.email,
      role: cm.role,
      userId: cmr.userId ? mapOr(cmr.userId, maps.user, "user") : null,
    });
  }

  for (const cr of dump.clubRequests ?? []) {
    await tx.insert(t.clubRequests).values({
      id: mapOr(cr.id, maps.other, "cr"),
      municipalityId: mid,
      clubId: mapOr(cr.clubId, maps.club, "club"),
      type: cr.type,
      status: cr.status,
      payload: cr.payload,
      note: cr.note,
      rejectReason: cr.rejectReason,
      createdByUserId: mapOr(cr.createdByUserId, maps.user, "user"),
      createdByName: cr.createdByName,
      resolvedAt: asDate(cr.resolvedAt),
      createdAt: asDate(cr.createdAt) ?? new Date(),
    });
  }

  for (const a of dump.activities ?? []) {
    await tx.insert(t.activities).values({
      id: mapOr(a.id, maps.activity, "act"),
      municipalityId: mid,
      facilityId: mapOr(a.facilityId, maps.facility, "fac"),
      name: a.name,
      description: a.description,
      days: a.days,
      hours: a.hours,
      places: a.places,
      ageMin: a.ageMin,
      ageMax: a.ageMax,
      method: a.method,
      deadline: a.deadline,
      lotteryStatus: a.lotteryStatus,
      lotterySeedHash: a.lotterySeedHash,
      lotterySecret: a.lotterySecret,
      lotteryResultOrder: a.lotteryResultOrder,
    });
  }

  for (const b of dump.bookings ?? []) {
    const br = b as typeof b & { cancelReason?: string | null };
    await tx.insert(t.bookings).values({
      id: mapOr(b.id, maps.booking, "bk"),
      municipalityId: mid,
      unitId: mapOr(b.unitId, maps.unit, "unit"),
      facilityId: mapOr(b.facilityId, maps.facility, "fac"),
      userId: b.userId ? mapOr(b.userId, maps.user, "user") : null,
      userDisplayName: b.userDisplayName,
      slotId: mapOr(b.slotId, maps.slot, "slot"),
      date: b.date,
      start: b.start,
      end: b.end,
      status: b.status,
      shortCode: b.shortCode,
      qrPayload: b.qrPayload,
      forMemberId: b.forMemberId ? mapOr(b.forMemberId, maps.other, "fam") : null,
      forMemberName: b.forMemberName,
      bookedByStaff: b.bookedByStaff ?? false,
      rulesVersion: b.rulesVersion,
      icsSequence: b.icsSequence ?? 0,
      cancelReason: br.cancelReason ?? null,
      createdAt: asDate(b.createdAt) ?? new Date(),
    });
  }

  for (const aa of dump.activityApplications ?? []) {
    await tx.insert(t.activityApplications).values({
      id: mapOr(aa.id, maps.other, "aa"),
      activityId: mapOr(aa.activityId, maps.activity, "act"),
      municipalityId: mid,
      userId: mapOr(aa.userId, maps.user, "user"),
      forMemberId: aa.forMemberId
        ? mapOr(aa.forMemberId, maps.other, "fam")
        : null,
      forMemberName: aa.forMemberName ?? null,
      applicationNumber: aa.applicationNumber,
      priorityGroup: aa.priorityGroup,
      status: aa.status,
      createdAt: asDate(aa.createdAt) ?? new Date(),
    });
  }

  for (const n of dump.notices ?? []) {
    await tx.insert(t.notices).values({
      id: mapOr(n.id, maps.other, "n"),
      municipalityId: mid,
      userId: n.userId ? mapOr(n.userId, maps.user, "user") : null,
      type: n.type,
      title: n.title,
      body: n.body,
      payload: n.payload,
      read: n.read ?? false,
      createdAt: asDate(n.createdAt) ?? new Date(),
    });
  }

  for (const f of dump.familyMembers ?? []) {
    await tx.insert(t.familyMembers).values({
      id: mapOr(f.id, maps.other, "fam"),
      userId: mapOr(f.userId, maps.user, "user"),
      municipalityId: mid,
      displayName: f.displayName,
      birthYear: f.birthYear,
      relation: f.relation,
    });
  }

  for (const w of dump.waitlistEntries ?? []) {
    await tx.insert(t.waitlistEntries).values({
      id: mapOr(w.id, maps.other, "wl"),
      municipalityId: mid,
      slotId: mapOr(w.slotId, maps.slot, "slot"),
      userId: mapOr(w.userId, maps.user, "user"),
      userDisplayName: w.userDisplayName,
      status: w.status,
      offeredUntil: asDate(w.offeredUntil),
      createdAt: asDate(w.createdAt) ?? new Date(),
    });
  }

  for (const i of dump.incidents ?? []) {
    await tx.insert(t.incidents).values({
      id: mapOr(i.id, maps.other, "inc"),
      municipalityId: mid,
      facilityId: i.facilityId ? mapOr(i.facilityId, maps.facility, "fac") : null,
      userId: mapOr(i.userId, maps.user, "user"),
      userDisplayName: i.userDisplayName,
      body: i.body,
      photoDataUrl: i.photoDataUrl,
      status: i.status,
      createdAt: asDate(i.createdAt) ?? new Date(),
      resolvedAt: asDate(i.resolvedAt),
    });
  }

  for (const g of dump.fixedGroups ?? []) {
    await tx.insert(t.fixedGroups).values({
      id: mapOr(g.id, maps.other, "fg"),
      municipalityId: mid,
      facilityId: mapOr(g.facilityId, maps.facility, "fac"),
      unitId: mapOr(g.unitId, maps.unit, "unit"),
      name: g.name,
      weekday: g.weekday,
      start: g.start,
      end: g.end,
      validFrom: g.validFrom,
      validTo: g.validTo,
      clubId: g.clubId ? mapOr(g.clubId, maps.club, "club") : null,
      createdBy: g.createdBy,
      active: g.active ?? true,
      createdAt: asDate(g.createdAt) ?? new Date(),
    });
  }

  for (const a of dump.auditEvents ?? []) {
    await tx.insert(t.auditEvents).values({
      id: mapOr(a.id, maps.other, "aud"),
      municipalityId: mid,
      at: asDate(a.at) ?? new Date(),
      actor: a.actor,
      action: a.action,
      detail: a.detail,
    });
  }

  for (const s of dump.slotSwaps ?? []) {
    await tx.insert(t.slotSwaps).values({
      id: mapOr(s.id, maps.other, "sw"),
      municipalityId: mid,
      fromMatchId: mapOr(s.fromMatchId, maps.match, "match"),
      toMatchId: mapOr(s.toMatchId, maps.match, "match"),
      status: s.status,
    });
  }

  for (const om of dump.openMatches ?? []) {
    await tx.insert(t.openMatches).values({
      id: mapOr(om.id, maps.openMatch, "om"),
      municipalityId: mid,
      facilityId: mapOr(om.facilityId, maps.facility, "fac"),
      unitId: mapOr(om.unitId, maps.unit, "unit"),
      bookingId: om.bookingId ? mapOr(om.bookingId, maps.booking, "bk") : null,
      organizerUserId: mapOr(om.organizerUserId, maps.user, "user"),
      title: om.title,
      sport: om.sport ?? "padel",
      date: om.date,
      start: om.start,
      end: om.end,
      spotsTotal: om.spotsTotal ?? 4,
      level: om.level ?? null,
      notes: om.notes ?? null,
      status: om.status ?? "open",
      qrToken: remapped ? randomUUID() : om.qrToken,
      createdAt: asDate(om.createdAt) ?? new Date(),
    });
  }

  for (const p of dump.openMatchPlayers ?? []) {
    await tx.insert(t.openMatchPlayers).values({
      openMatchId: mapOr(p.openMatchId, maps.openMatch, "om"),
      userId: mapOr(p.userId, maps.user, "user"),
      displayName: p.displayName,
      role: p.role ?? "player",
      joinedAt: asDate(p.joinedAt) ?? new Date(),
      nameConsentAt: asDate(p.nameConsentAt),
    });
  }

  for (const inv of dump.openMatchInvites ?? []) {
    await tx.insert(t.openMatchInvites).values({
      id: mapOr(inv.id, maps.other, "omi"),
      openMatchId: mapOr(inv.openMatchId, maps.openMatch, "om"),
      municipalityId: mid,
      fromUserId: mapOr(inv.fromUserId, maps.user, "user"),
      toUserId: inv.toUserId ? mapOr(inv.toUserId, maps.user, "user") : null,
      toEmail: inv.toEmail ?? null,
      token: remapped ? randomUUID() : inv.token,
      status: inv.status ?? "pending",
      createdAt: asDate(inv.createdAt) ?? new Date(),
    });
  }

  for (const ur of dump.userRoles ?? []) {
    let targetUserId = maps.user.get(ur.userId);
    if (!targetUserId) {
      const [existingUser] = await tx
        .select({ id: t.users.id })
        .from(t.users)
        .where(eq(t.users.id, ur.userId))
        .limit(1);
      if (!existingUser) continue;
      targetUserId = existingUser.id;
    }
    await tx.insert(t.userRoles).values({
      userId: targetUserId,
      municipalityId: mid,
      role: ur.role,
      clubId: ur.clubId
        ? mapOr(ur.clubId, maps.club, "club")
        : "",
      active: ur.active ?? true,
      createdAt: asDate(ur.createdAt) ?? new Date(),
    });
  }

  return { municipalityId: mid, slug: newSlug, remapped };
  });
}

