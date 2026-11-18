/**
 * REVISION-40 — Partidos abertos ligados a reserva (P2 + M1–M13).
 */
import { randomBytes } from "node:crypto";
import { and, eq, gte, lt, ne, notInArray, sql, count } from "drizzle-orm";
import {
  assertDisplayNameForMatch,
  formatDayChip,
  isEmailLocalPartName,
  shortPublicName,
} from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import { assertFacilityUnitInMuni } from "./tenancy-assert.js";
import {
  createBooking,
  getBooking,
  getFacility,
  getMunicipalityById,
} from "./db.js";
import {
  DEFAULT_TIMEZONE,
  localDateIso,
  slotInstant,
} from "./business-rules.js";
import { overlapsSlot as overlaps } from "./booking-overlap.js";

/**
 * REVISION-42 Q6 — se o nome da sesión é o local-part do correo, esixe un nome real
 * e gárdao en `users.display_name`.
 */
async function resolveMatchDisplayName(opts: {
  userId: string;
  displayName: string;
  email?: string | null;
  proposedDisplayName?: string | null;
}): Promise<string> {
  const email =
    opts.email ??
    (
      await getDb()
        .select({ email: t.users.email })
        .from(t.users)
        .where(eq(t.users.id, opts.userId))
        .limit(1)
    )[0]?.email;

  if (!isEmailLocalPartName(opts.displayName, email)) {
    if (opts.proposedDisplayName?.trim()) {
      /* Permitir actualizar mesmo se xa tiña nome real. */
      const name = assertDisplayNameForMatch(opts.proposedDisplayName, email);
      await getDb()
        .update(t.users)
        .set({ displayName: name })
        .where(eq(t.users.id, opts.userId));
      return name;
    }
    return opts.displayName;
  }

  const name = assertDisplayNameForMatch(opts.proposedDisplayName, email);
  await getDb()
    .update(t.users)
    .set({ displayName: name })
    .where(eq(t.users.id, opts.userId));
  return name;
}

function muniTz(muni: { settings?: { timezone?: string } } | null | undefined): string {
  return muni?.settings?.timezone ?? DEFAULT_TIMEZONE;
}

function nid(prefix: string): string {
  return `${prefix}-${randomBytes(6).toString("hex")}`;
}

function qrToken(): string {
  return randomBytes(16).toString("hex");
}

function assertNameConsent(ok: boolean | undefined): void {
  if (!ok) throw new Error("consent_required");
}

export type OpenMatchPlayerPublic = {
  displayName: string;
  role: string;
};

/** REVISION-46 D4 — partidos do usuario en «As miñas reservas». */
export type OpenMatchForUser = {
  id: string;
  role: "organizer" | "player";
  title: string;
  date: string;
  start: string;
  end: string;
  spotsTaken: number;
  spotsTotal: number;
  facilityName?: string;
  status: string;
  organizerName?: string;
  bookingId?: string | null;
};

export type OpenMatchPublic = {
  id: string;
  municipalityId: string;
  facilityId: string;
  facilityName?: string;
  unitId: string;
  unitName?: string;
  bookingId: string | null;
  title: string;
  sport: string;
  date: string;
  start: string;
  end: string;
  spotsTotal: number;
  spotsTaken: number;
  level: string | null;
  notes: string | null;
  status: string;
  /** Nome público segundo privacidade (sen userId). */
  organizerName?: string;
  players: OpenMatchPlayerPublic[];
  iAmOrganizer?: boolean;
  iAmJoined?: boolean;
};

type Viewer = { userId?: string; isOrganizer?: boolean };

function assertSafeTitle(raw: string): string {
  const title = raw.trim().slice(0, 120);
  if (title.length < 2) throw new Error("title_required");
  if (/[<>]/.test(title)) throw new Error("title_invalid");
  if (/https?:\/\//i.test(title) || /\bwww\./i.test(title)) {
    throw new Error("title_invalid");
  }
  return title;
}

async function unitCapacity(unitId: string): Promise<number> {
  const [u] = await getDb()
    .select({ capacity: t.units.capacity })
    .from(t.units)
    .where(eq(t.units.id, unitId))
    .limit(1);
  return Math.max(2, u?.capacity ?? 4);
}

async function facilityAllowsOpenMatches(facilityId: string): Promise<boolean> {
  const fac = await getFacility(facilityId);
  if (!fac) return false;
  if (fac.openMatchesAllowed === false) return false;
  if (fac.openMatchesAllowed === true) return true;
  /* Por defecto si en pistas, pavillóns e campos. */
  return fac.type === "pista" || fac.type === "pavillon" || fac.type === "campo";
}

async function mapOpenMatch(
  row: typeof t.openMatches.$inferSelect,
  opts?: Viewer,
): Promise<OpenMatchPublic> {
  const players = await getDb()
    .select()
    .from(t.openMatchPlayers)
    .where(eq(t.openMatchPlayers.openMatchId, row.id));
  const fac = await getFacility(row.facilityId);
  const [unit] = await getDb()
    .select({ name: t.units.name })
    .from(t.units)
    .where(eq(t.units.id, row.unitId))
    .limit(1);
  const [org] = await getDb()
    .select({ displayName: t.users.displayName })
    .from(t.users)
    .where(eq(t.users.id, row.organizerUserId))
    .limit(1);

  const isOrganizer = !!opts?.userId && opts.userId === row.organizerUserId;
  const isJoined = !!opts?.userId && players.some((p) => p.userId === opts.userId);
  const hasSession = !!opts?.userId;
  /* Só amosar nomes con consentimento; ao saír/cancelar deixan de verse. */
  const consented = players.filter((p) => !!p.nameConsentAt);
  const orgPlayer = consented.find((p) => p.userId === row.organizerUserId);
  const orgLabel = orgPlayer?.displayName ?? org?.displayName;

  let organizerName: string | undefined;
  let playerPublic: OpenMatchPlayerPublic[] = [];
  if (!hasSession) {
    organizerName = undefined;
    playerPublic = [];
  } else if (isOrganizer) {
    organizerName = orgPlayer ? orgLabel : undefined;
    playerPublic = consented.map((p) => ({
      displayName: p.displayName,
      role: p.role,
    }));
  } else {
    organizerName = orgPlayer && orgLabel ? shortPublicName(orgLabel) : undefined;
    playerPublic = consented.map((p) => ({
      displayName: shortPublicName(p.displayName),
      role: p.role,
    }));
  }

  return {
    id: row.id,
    municipalityId: row.municipalityId,
    facilityId: row.facilityId,
    facilityName: fac?.name,
    unitId: row.unitId,
    unitName: unit?.name,
    bookingId: isOrganizer || isJoined ? row.bookingId : null,
    title: row.title,
    sport: row.sport,
    date: row.date,
    start: row.start,
    end: row.end,
    spotsTotal: row.spotsTotal,
    spotsTaken: players.length,
    level: row.level,
    notes: row.notes,
    status: row.status,
    organizerName,
    players: playerPublic,
    iAmOrganizer: hasSession ? isOrganizer : undefined,
    iAmJoined: hasSession ? isJoined : undefined,
  };
}

async function assertCanJoin(
  municipalityId: string,
  userId: string,
  row: typeof t.openMatches.$inferSelect,
  now: Date,
): Promise<void> {
  const muni = await getMunicipalityById(municipalityId);
  const tz = muniTz(muni);
  const startAt = slotInstant(row.date, row.start, tz);
  if (startAt.getTime() <= now.getTime()) throw new Error("match_in_past");

  const [user] = await getDb()
    .select({ bookingBlockedUntil: t.users.bookingBlockedUntil })
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  if (
    user?.bookingBlockedUntil &&
    user.bookingBlockedUntil.getTime() > now.getTime()
  ) {
    throw new Error("booking_blocked");
  }

  const bookings = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.userId, userId),
        eq(t.bookings.municipalityId, municipalityId),
        notInArray(t.bookings.status, ["cancelled", "no_show"]),
      ),
    );
  for (const b of bookings) {
    if (overlaps(row.date, row.start, row.end, b.date, b.start, b.end)) {
      throw new Error("schedule_conflict");
    }
  }

  const myMatches = await getDb()
    .select({
      date: t.openMatches.date,
      start: t.openMatches.start,
      end: t.openMatches.end,
      status: t.openMatches.status,
      id: t.openMatches.id,
    })
    .from(t.openMatchPlayers)
    .innerJoin(
      t.openMatches,
      eq(t.openMatchPlayers.openMatchId, t.openMatches.id),
    )
    .where(
      and(
        eq(t.openMatchPlayers.userId, userId),
        eq(t.openMatches.municipalityId, municipalityId),
        ne(t.openMatches.status, "cancelled"),
      ),
    );
  for (const m of myMatches) {
    if (m.id === row.id) continue;
    if (overlaps(row.date, row.start, row.end, m.date, m.start, m.end)) {
      throw new Error("schedule_conflict");
    }
  }
}

async function dayLabel(date: string, locale: "gl" | "es" = "gl"): Promise<string> {
  return formatDayChip(date, locale);
}

async function notifyPlayers(opts: {
  municipalityId: string;
  match: { id: string; title: string; date: string; start: string; end: string; facilityId: string };
  playerUserIds: string[];
  skipUserId?: string;
  noticeTitleGl: string;
  noticeBodyGl: string;
  emailKind:
    | "open_match_cancelled"
    | "open_match_moved"
    | "open_match_joined"
    | "open_match_invite"
    | "open_match_left";
  emailData: Record<string, unknown>;
}): Promise<void> {
  const { sendUserNotice } = await import("../notify/send-notice.js");
  const fac = await getFacility(opts.match.facilityId);
  const muni = await getMunicipalityById(opts.municipalityId);
  if (!muni?.slug) throw new Error("municipality_required");
  const slug = muni.slug;
  const day = await dayLabel(opts.match.date);
  const timeLabel = `${opts.match.start}–${opts.match.end}`;
  for (const uid of opts.playerUserIds) {
    if (opts.skipUserId && uid === opts.skipUserId) continue;
    await sendUserNotice({
      id: nid("n-om"),
      municipalityId: opts.municipalityId,
      userId: uid,
      noticeType: "info",
      /* REVISION-46 X7: tipo «Partidos abertos» desactivábel na conta. */
      notifyType: "partido_aberto",
      title: opts.noticeTitleGl,
      body: opts.noticeBodyGl,
      payload: { openMatchId: opts.match.id },
      email: {
        kind: opts.emailKind,
        data: {
          matchTitle: opts.match.title,
          dayLabel: day,
          timeLabel,
          facilityName: fac?.name,
          matchPath: `/c/${slug}/partidos-abertos/${opts.match.id}`,
          ...opts.emailData,
        },
      },
    });
  }
}

export async function listOpenMatches(
  municipalityId: string,
  opts?: {
    fromDate?: string;
    userId?: string;
    includeClosed?: boolean;
    /** Lista pública: agocha «full» agás se a persoa vai xogar. */
    publicList?: boolean;
  },
): Promise<OpenMatchPublic[]> {
  const rows = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.municipalityId, municipalityId),
        opts?.fromDate ? gte(t.openMatches.date, opts.fromDate) : undefined,
        opts?.includeClosed ? undefined : ne(t.openMatches.status, "cancelled"),
      ),
    );
  const mapped = await Promise.all(
    rows.map((r) => mapOpenMatch(r, { userId: opts?.userId })),
  );
  const filtered = mapped.filter((m) => {
    if (!opts?.publicList) return true;
    if (m.status === "full") {
      return !!(m.iAmOrganizer || m.iAmJoined);
    }
    return m.status === "open";
  });
  return filtered.sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
  );
}

/** Partidos onde a persoa organiza ou xoga (non cancelados). */
export async function listOpenMatchesForUser(
  municipalityId: string,
  userId: string,
): Promise<OpenMatchForUser[]> {
  const asPlayer = await getDb()
    .select({ match: t.openMatches })
    .from(t.openMatchPlayers)
    .innerJoin(
      t.openMatches,
      eq(t.openMatchPlayers.openMatchId, t.openMatches.id),
    )
    .where(
      and(
        eq(t.openMatchPlayers.userId, userId),
        eq(t.openMatches.municipalityId, municipalityId),
        ne(t.openMatches.status, "cancelled"),
      ),
    );
  const asOrganizer = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.organizerUserId, userId),
        eq(t.openMatches.municipalityId, municipalityId),
        ne(t.openMatches.status, "cancelled"),
      ),
    );

  const byId = new Map<string, typeof t.openMatches.$inferSelect>();
  for (const row of asOrganizer) byId.set(row.id, row);
  for (const { match } of asPlayer) byId.set(match.id, match);

  const sorted = [...byId.values()].sort(
    (a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start),
  );

  const out: OpenMatchForUser[] = [];
  for (const row of sorted) {
    const mapped = await mapOpenMatch(row, { userId });
    out.push({
      id: mapped.id,
      role: row.organizerUserId === userId ? "organizer" : "player",
      title: mapped.title,
      date: mapped.date,
      start: mapped.start,
      end: mapped.end,
      spotsTaken: mapped.spotsTaken,
      spotsTotal: mapped.spotsTotal,
      facilityName: mapped.facilityName,
      status: mapped.status,
      organizerName: mapped.organizerName,
      bookingId: mapped.bookingId,
    });
  }
  return out;
}

export async function getOpenMatch(
  municipalityId: string,
  id: string,
  userId?: string,
): Promise<OpenMatchPublic | null> {
  const [row] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, id),
        eq(t.openMatches.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const mapped = await mapOpenMatch(row, { userId });
  if (
    mapped.status === "full" &&
    userId &&
    !mapped.iAmOrganizer &&
    !mapped.iAmJoined
  ) {
    /* Completo: só org + apuntados (e admin vía includeClosed). */
    return null;
  }
  if (mapped.status === "full" && !userId) return null;
  return mapped;
}

export async function createOpenMatch(input: {
  municipalityId: string;
  userId: string;
  displayName: string;
  email?: string | null;
  bookingId: string;
  title: string;
  sport?: string;
  spotsTotal?: number;
  level?: string;
  notes?: string;
  /** Obrigatorio: consentimento para amosar o nome na lista. */
  nameDisplayConsent?: boolean;
  /** REVISION-42 Q6 — nome real se o da sesión é o do correo. */
  proposedDisplayName?: string | null;
  now?: Date;
}): Promise<OpenMatchPublic> {
  if (!input.bookingId) throw new Error("booking_required");
  assertNameConsent(input.nameDisplayConsent);
  const displayName = await resolveMatchDisplayName({
    userId: input.userId,
    displayName: input.displayName,
    email: input.email,
    proposedDisplayName: input.proposedDisplayName,
  });
  const title = assertSafeTitle(input.title);
  const booking = await getBooking(input.bookingId);
  if (!booking || booking.municipalityId !== input.municipalityId) {
    throw new Error("not_found");
  }
  if (booking.userId !== input.userId) throw new Error("forbidden");
  if (booking.status !== "confirmed") throw new Error("booking_not_confirmed");

  const muni = await getMunicipalityById(input.municipalityId);
  if (!muni) throw new Error("municipality_not_found");
  const tz = muniTz(muni);
  const now = input.now ?? new Date();
  const startAt = slotInstant(booking.date, booking.start, tz);
  if (startAt.getTime() <= now.getTime()) throw new Error("booking_in_past");

  if (!(await facilityAllowsOpenMatches(booking.facilityId))) {
    throw new Error("open_matches_disabled");
  }

  const [existing] = await getDb()
    .select({ id: t.openMatches.id })
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.bookingId, booking.id),
        ne(t.openMatches.status, "cancelled"),
      ),
    )
    .limit(1);
  if (existing) throw new Error("match_already_exists");

  await assertFacilityUnitInMuni(
    input.municipalityId,
    booking.facilityId,
    booking.unitId,
  );

  const cap = await unitCapacity(booking.unitId);
  const spots = Math.min(cap, Math.max(2, input.spotsTotal ?? Math.min(4, cap)));
  if (spots > cap) throw new Error("spots_exceed_capacity");

  const id = nid("om");
  const token = qrToken();
  await getDb().insert(t.openMatches).values({
    id,
    municipalityId: input.municipalityId,
    facilityId: booking.facilityId,
    unitId: booking.unitId,
    bookingId: booking.id,
    organizerUserId: input.userId,
    title,
    sport: (input.sport ?? "padel").slice(0, 40),
    date: booking.date,
    start: booking.start,
    end: booking.end,
    spotsTotal: spots,
    level: input.level?.trim() || null,
    notes: input.notes?.trim()?.slice(0, 500) || null,
    status: "open",
    qrToken: token,
  });
  const consentAt = input.now ?? new Date();
  await getDb().insert(t.openMatchPlayers).values({
    openMatchId: id,
    userId: input.userId,
    displayName,
    role: "organizer",
    nameConsentAt: consentAt,
  });
  const m = await getOpenMatch(input.municipalityId, id, input.userId);
  if (!m) throw new Error("create_failed");
  return m;
}

/** Reserva + partido na mesma secuencia (P2). Se o partido falla, cancela a reserva. */
export async function createBookingWithOpenMatch(input: {
  municipalityId: string;
  slotId: string;
  userId: string;
  displayName: string;
  email?: string | null;
  userRole?: string;
  rulesVersion?: string;
  title: string;
  sport?: string;
  spotsTotal?: number;
  level?: string;
  notes?: string;
  nameDisplayConsent?: boolean;
  proposedDisplayName?: string | null;
  now?: Date;
}): Promise<{ booking: Awaited<ReturnType<typeof createBooking>>; match: OpenMatchPublic }> {
  /* REVISION-41 O3: validar título / prazas / instalación ANTES da reserva
   * (se non, chega «Reserva confirmada» + .ics dunha reserva que se cancela). */
  assertNameConsent(input.nameDisplayConsent);
  const displayName = await resolveMatchDisplayName({
    userId: input.userId,
    displayName: input.displayName,
    email: input.email,
    proposedDisplayName: input.proposedDisplayName,
  });
  assertSafeTitle(input.title);
  const [slotRow] = await getDb()
    .select()
    .from(t.timeSlots)
    .where(eq(t.timeSlots.id, input.slotId))
    .limit(1);
  if (!slotRow || slotRow.municipalityId !== input.municipalityId) {
    throw new Error("slot_not_found");
  }
  const [unitRow] = await getDb()
    .select()
    .from(t.units)
    .where(eq(t.units.id, slotRow.unitId))
    .limit(1);
  if (!unitRow) throw new Error("unit_not_found");
  if (!(await facilityAllowsOpenMatches(unitRow.facilityId))) {
    throw new Error("open_matches_disabled");
  }
  const cap = await unitCapacity(slotRow.unitId);
  if (input.spotsTotal != null && input.spotsTotal > cap) {
    throw new Error("spots_exceed_capacity");
  }
  if (input.spotsTotal != null && input.spotsTotal < 2) {
    throw new Error("spots_exceed_capacity");
  }

  const booking = await createBooking({
    municipalityId: input.municipalityId,
    slotId: input.slotId,
    userId: input.userId,
    userDisplayName: displayName,
    userRole: input.userRole,
    rulesVersion: input.rulesVersion,
    now: input.now,
    skipNotify: true,
  });
  try {
    const match = await createOpenMatch({
      municipalityId: input.municipalityId,
      userId: input.userId,
      displayName,
      email: input.email,
      bookingId: booking.id,
      title: input.title,
      sport: input.sport,
      spotsTotal: input.spotsTotal,
      level: input.level,
      notes: input.notes,
      nameDisplayConsent: true,
      /* Xa resolto arriba; non volver esixir. */
      proposedDisplayName: displayName,
      now: input.now,
    });
    try {
      const { notifyBookingCreated } = await import(
        "../notify/emails/send-booking-lifecycle.js"
      );
      await notifyBookingCreated(booking);
    } catch (err) {
      console.warn(
        `[mail] confirmación reserva+partido ${booking.id}: ${(err as Error).message}`,
      );
    }
    return { booking, match };
  } catch (err) {
    const { cancelBooking } = await import("./db.js");
    await cancelBooking(booking.id, input.userId, true, "open_match_create_failed");
    throw err;
  }
}

export async function joinOpenMatch(input: {
  municipalityId: string;
  openMatchId: string;
  userId: string;
  displayName: string;
  email?: string | null;
  nameDisplayConsent?: boolean;
  proposedDisplayName?: string | null;
  now?: Date;
}): Promise<OpenMatchPublic> {
  assertNameConsent(input.nameDisplayConsent);
  const displayName = await resolveMatchDisplayName({
    userId: input.userId,
    displayName: input.displayName,
    email: input.email,
    proposedDisplayName: input.proposedDisplayName,
  });
  const now = input.now ?? new Date();
  const [pre] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, input.openMatchId),
        eq(t.openMatches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!pre) throw new Error("not_found");
  if (pre.status === "cancelled") throw new Error("closed");
  if (pre.status === "full") throw new Error("full");
  if (pre.status !== "open") throw new Error("closed");
  /* Comprobacións fóra do FOR UPDATE (PGlite: evitar autobloqueo). */
  await assertCanJoin(input.municipalityId, input.userId, pre, now);

  const db = getDb();
  await db.transaction(async (tx) => {
    await tx.execute(
      sql`select id from open_matches where id = ${input.openMatchId} and municipality_id = ${input.municipalityId} for update`,
    );
    const [row] = await tx
      .select()
      .from(t.openMatches)
      .where(
        and(
          eq(t.openMatches.id, input.openMatchId),
          eq(t.openMatches.municipalityId, input.municipalityId),
        ),
      )
      .limit(1);
    if (!row) throw new Error("not_found");
    if (row.status === "cancelled") throw new Error("closed");
    if (row.status === "full") throw new Error("full");
    if (row.status !== "open") throw new Error("closed");

    const players = await tx
      .select()
      .from(t.openMatchPlayers)
      .where(eq(t.openMatchPlayers.openMatchId, input.openMatchId));
    if (players.some((p) => p.userId === input.userId)) return;
    if (players.length >= row.spotsTotal) throw new Error("full");

    await tx.insert(t.openMatchPlayers).values({
      openMatchId: input.openMatchId,
      userId: input.userId,
      displayName,
      role: "player",
      nameConsentAt: now,
    });
    if (players.length + 1 >= row.spotsTotal) {
      await tx
        .update(t.openMatches)
        .set({ status: "full" })
        .where(eq(t.openMatches.id, input.openMatchId));
    }
  });

  const row = await getOpenMatch(
    input.municipalityId,
    input.openMatchId,
    input.userId,
  );
  if (!row) throw new Error("not_found");
  const [raw] = await getDb()
    .select()
    .from(t.openMatches)
    .where(eq(t.openMatches.id, input.openMatchId))
    .limit(1);
  if (raw) {
    await notifyPlayers({
      municipalityId: input.municipalityId,
      match: raw,
      playerUserIds: [raw.organizerUserId],
      skipUserId: input.userId,
      noticeTitleGl: "Alguén apuntouse ao teu partido",
      noticeBodyGl: `${shortPublicName(displayName)} apuntouse a «${raw.title}».`,
      emailKind: "open_match_joined",
      emailData: { playerName: shortPublicName(displayName) },
    });
  }
  return row;
}

export async function leaveOpenMatch(input: {
  municipalityId: string;
  openMatchId: string;
  userId: string;
  now?: Date;
  /** Saltar prazo (peche de conta / admin). */
  force?: boolean;
}): Promise<OpenMatchPublic> {
  const [raw] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, input.openMatchId),
        eq(t.openMatches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!raw) throw new Error("not_found");
  if (raw.organizerUserId === input.userId) {
    throw new Error("organizer_cannot_leave");
  }
  const [player] = await getDb()
    .select()
    .from(t.openMatchPlayers)
    .where(
      and(
        eq(t.openMatchPlayers.openMatchId, input.openMatchId),
        eq(t.openMatchPlayers.userId, input.userId),
      ),
    )
    .limit(1);
  if (!player) throw new Error("not_joined");

  /* REVISION-41 O12: mesmo prazo ca cancelar unha reserva (agás force). */
  if (!input.force) {
    const muni = await getMunicipalityById(input.municipalityId);
    if (!muni) throw new Error("municipality_not_found");
    const tz = muniTz(muni);
    const fac = await getFacility(raw.facilityId);
    const { resolveFacilityRules } = await import("./rules.js");
    const usage = resolveFacilityRules(muni, fac ?? null);
    const now = input.now ?? new Date();
    const startAt = slotInstant(raw.date, raw.start, tz);
    const minMs = (usage.cancelMinHours ?? 2) * 3_600_000;
    if (startAt.getTime() - now.getTime() < minMs) {
      throw new Error("leave_too_late");
    }
  }

  await getDb()
    .delete(t.openMatchPlayers)
    .where(
      and(
        eq(t.openMatchPlayers.openMatchId, input.openMatchId),
        eq(t.openMatchPlayers.userId, input.userId),
      ),
    );
  if (raw.status === "full") {
    await getDb()
      .update(t.openMatches)
      .set({ status: "open" })
      .where(eq(t.openMatches.id, input.openMatchId));
  }

  const remainingPlayers = await getDb()
    .select({ id: t.openMatchPlayers.userId })
    .from(t.openMatchPlayers)
    .where(eq(t.openMatchPlayers.openMatchId, input.openMatchId));
  const spotsLeft = Math.max(0, raw.spotsTotal - remainingPlayers.length);
  const who = shortPublicName(player.displayName);

  await notifyPlayers({
    municipalityId: input.municipalityId,
    match: raw,
    playerUserIds: [raw.organizerUserId],
    noticeTitleGl: "Alguén saíu do teu partido",
    noticeBodyGl:
      spotsLeft === 1
        ? `${who} saíu de «${raw.title}». Queda 1 praza libre.`
        : `${who} saíu de «${raw.title}». Quedan ${spotsLeft} prazas libres.`,
    emailKind: "open_match_left",
    emailData: {
      playerName: who,
      spotsLeft,
    },
  });

  return (await getOpenMatch(
    input.municipalityId,
    input.openMatchId,
    input.userId,
  ))!;
}

export async function cancelOpenMatch(input: {
  municipalityId: string;
  openMatchId: string;
  userId: string;
  asAdmin?: boolean;
  reason?: string;
  /** Omitir correo/aviso a este usuario (REVISION-41 O6: organizador). */
  skipUserId?: string;
}): Promise<void> {
  const [raw] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, input.openMatchId),
        eq(t.openMatches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!raw) throw new Error("not_found");
  if (!input.asAdmin && raw.organizerUserId !== input.userId) {
    throw new Error("forbidden");
  }
  if (raw.status === "cancelled") return;

  const reason =
    input.reason?.trim() ||
    (input.asAdmin
      ? "O concello cancelou o partido."
      : "A persoa organizadora cancelou o partido.");

  const players = await getDb()
    .select()
    .from(t.openMatchPlayers)
    .where(eq(t.openMatchPlayers.openMatchId, input.openMatchId));

  await getDb()
    .update(t.openMatches)
    .set({ status: "cancelled" })
    .where(eq(t.openMatches.id, input.openMatchId));

  await notifyPlayers({
    municipalityId: input.municipalityId,
    match: raw,
    playerUserIds: players.map((p) => p.userId),
    skipUserId:
      input.skipUserId ?? (input.asAdmin ? undefined : input.userId),
    noticeTitleGl: "Partido cancelado",
    noticeBodyGl: `Cancelouse «${raw.title}». ${reason}`,
    emailKind: "open_match_cancelled",
    emailData: { reason },
  });
}

/** Partido aberto activo ligado a unha reserva (ou null). */
export async function findOpenMatchIdByBooking(
  bookingId: string,
): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: t.openMatches.id })
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.bookingId, bookingId),
        ne(t.openMatches.status, "cancelled"),
      ),
    )
    .limit(1);
  return row?.id ?? null;
}

/** Cancelar partido ligado a unha reserva (cancelamento / peche / desactivación). */
export async function cancelOpenMatchForBooking(
  bookingId: string,
  reason: string,
): Promise<number> {
  const rows = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.bookingId, bookingId),
        ne(t.openMatches.status, "cancelled"),
      ),
    );
  for (const row of rows) {
    /* REVISION-41 O6: o organizador xa recibe o correo da reserva/peche;
     * o de partido vai só a quen está apuntado. */
    await cancelOpenMatch({
      municipalityId: row.municipalityId,
      openMatchId: row.id,
      userId: row.organizerUserId,
      asAdmin: true,
      reason,
      skipUserId: row.organizerUserId,
    });
  }
  return rows.length;
}

/** Ao cambiar a reserva, mover o partido e avisar. */
export async function moveOpenMatchForBooking(input: {
  bookingId: string;
  date: string;
  start: string;
  end: string;
  facilityId: string;
  unitId: string;
}): Promise<number> {
  const rows = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.bookingId, input.bookingId),
        ne(t.openMatches.status, "cancelled"),
      ),
    );
  for (const row of rows) {
    const prev = `${await dayLabel(row.date)} · ${row.start}–${row.end}`;
    await getDb()
      .update(t.openMatches)
      .set({
        date: input.date,
        start: input.start,
        end: input.end,
        facilityId: input.facilityId,
        unitId: input.unitId,
      })
      .where(eq(t.openMatches.id, row.id));
    const players = await getDb()
      .select()
      .from(t.openMatchPlayers)
      .where(eq(t.openMatchPlayers.openMatchId, row.id));
    const updated = { ...row, ...input };
    await notifyPlayers({
      municipalityId: row.municipalityId,
      match: updated,
      playerUserIds: players.map((p) => p.userId),
      skipUserId: row.organizerUserId,
      noticeTitleGl: "O partido cambiou de hora",
      noticeBodyGl: `«${row.title}» moveuse a ${await dayLabel(input.date)} · ${input.start}–${input.end}.`,
      emailKind: "open_match_moved",
      emailData: { previousLabel: prev },
    });
  }
  return rows.length;
}

export async function inviteToOpenMatch(input: {
  municipalityId: string;
  openMatchId: string;
  fromUserId: string;
  toUserId?: string;
  toEmail?: string;
  now?: Date;
}): Promise<{ token: string; inviteId: string }> {
  const email = input.toEmail?.trim().toLowerCase() || "";
  if (!input.toUserId && !email) throw new Error("recipient_required");
  const [raw] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, input.openMatchId),
        eq(t.openMatches.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!raw) throw new Error("not_found");
  if (raw.organizerUserId !== input.fromUserId) throw new Error("forbidden");
  if (raw.status !== "open") throw new Error("closed");

  const now = input.now ?? new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const [perMatch] = await getDb()
    .select({ n: count() })
    .from(t.openMatchInvites)
    .where(eq(t.openMatchInvites.openMatchId, input.openMatchId));
  if ((perMatch?.n ?? 0) >= 10) throw new Error("invite_limit_match");

  const [perDay] = await getDb()
    .select({ n: count() })
    .from(t.openMatchInvites)
    .where(
      and(
        eq(t.openMatchInvites.fromUserId, input.fromUserId),
        gte(t.openMatchInvites.createdAt, dayStart),
        lt(t.openMatchInvites.createdAt, dayEnd),
      ),
    );
  if ((perDay?.n ?? 0) >= 20) throw new Error("invite_limit_day");

  const inviteId = nid("omi");
  const token = randomBytes(12).toString("hex");
  await getDb().insert(t.openMatchInvites).values({
    id: inviteId,
    openMatchId: input.openMatchId,
    municipalityId: input.municipalityId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId ?? null,
    toEmail: email || null,
    token,
    status: "pending",
  });

  let toUserId = input.toUserId ?? null;
  if (!toUserId && email) {
    const [byEmail] = await getDb()
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.email, email))
      .limit(1);
    if (byEmail) toUserId = byEmail.id;
  }

  const muni = await getMunicipalityById(input.municipalityId);
  if (!muni?.slug) throw new Error("municipality_required");
  const slug = muni.slug;
  const fac = await getFacility(raw.facilityId);
  const [org] = await getDb()
    .select({ displayName: t.users.displayName })
    .from(t.users)
    .where(eq(t.users.id, input.fromUserId))
    .limit(1);
  const day = await dayLabel(raw.date);
  const timeLabel = `${raw.start}–${raw.end}`;
  const matchPath = `/c/${slug}/partidos-abertos/${raw.id}`;

  if (toUserId) {
    const { sendUserNotice } = await import("../notify/send-notice.js");
    await sendUserNotice({
      id: nid("n-om"),
      municipalityId: input.municipalityId,
      userId: toUserId,
      noticeType: "info",
      notifyType: null,
      title: "Convite a un partido aberto",
      body: `Convidáronte a «${raw.title}» o ${day} ás ${raw.start}.`,
      payload: { openMatchId: raw.id, token },
      email: {
        kind: "open_match_invite",
        data: {
          matchTitle: raw.title,
          dayLabel: day,
          timeLabel,
          facilityName: fac?.name,
          matchPath,
          organizerName: org?.displayName
            ? shortPublicName(org.displayName)
            : undefined,
        },
      },
    });
  } else if (email) {
    const { renderEmail } = await import("../notify/emails/layout.js");
    const { sendMail } = await import("../notify/mail.js");
    const rendered = await renderEmail({
      muni: muni ?? null,
      locale: "gl",
      kind: "open_match_invite",
      data: {
        /* REVISION-41 O9: sen «Ola, amigo10@…»; saúdo «Ola!». */
        userName: "",
        helloBare: true,
        matchTitle: raw.title,
        dayLabel: day,
        timeLabel,
        facilityName: fac?.name,
        matchPath,
        organizerName: org?.displayName
          ? shortPublicName(org.displayName)
          : undefined,
      },
    });
    await sendMail({
      to: email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }
  return { token, inviteId };
}

export async function openMatchQrPayload(
  municipalityId: string,
  openMatchId: string,
): Promise<{ token: string; urlPath: string } | null> {
  const [row] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, openMatchId),
        eq(t.openMatches.municipalityId, municipalityId),
      ),
    )
    .limit(1);
  if (!row) return null;
  const muni = await getMunicipalityById(municipalityId);
  return {
    token: row.qrToken,
    urlPath: `/c/${muni?.slug ?? "exemplo"}/partidos-abertos/${row.id}?t=${row.qrToken}`,
  };
}

export async function verifyOpenMatchQr(
  municipalityId: string,
  openMatchId: string,
  token: string,
  userId?: string,
): Promise<OpenMatchPublic | null> {
  const [row] = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.id, openMatchId),
        eq(t.openMatches.municipalityId, municipalityId),
        eq(t.openMatches.qrToken, token),
      ),
    )
    .limit(1);
  if (!row) return null;
  return mapOpenMatch(row, { userId });
}

/** Ao pechar a conta: sacar a persoa dos partidos (e cancelar se organiza). */
export async function detachUserFromOpenMatches(userId: string): Promise<void> {
  const organized = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.organizerUserId, userId),
        ne(t.openMatches.status, "cancelled"),
      ),
    );
  for (const row of organized) {
    await cancelOpenMatch({
      municipalityId: row.municipalityId,
      openMatchId: row.id,
      userId,
      asAdmin: true,
      reason: "A persoa organizadora pechou a conta.",
    });
  }
  const playing = await getDb()
    .select()
    .from(t.openMatchPlayers)
    .where(eq(t.openMatchPlayers.userId, userId));
  for (const p of playing) {
    const [row] = await getDb()
      .select()
      .from(t.openMatches)
      .where(eq(t.openMatches.id, p.openMatchId))
      .limit(1);
    if (!row || row.status === "cancelled") continue;
    if (row.organizerUserId === userId) continue;
    await leaveOpenMatch({
      municipalityId: row.municipalityId,
      openMatchId: row.id,
      userId,
      force: true,
    });
  }
}

/** Contar partidos abertos afectados por un peche (M3). */
export async function listOpenMatchesInRange(input: {
  municipalityId: string;
  startDate: string;
  endDate: string;
  facilityId?: string;
  unitIds?: string[] | null;
}): Promise<typeof t.openMatches.$inferSelect[]> {
  const rows = await getDb()
    .select()
    .from(t.openMatches)
    .where(
      and(
        eq(t.openMatches.municipalityId, input.municipalityId),
        gte(t.openMatches.date, input.startDate),
        sql`${t.openMatches.date} <= ${input.endDate}`,
        ne(t.openMatches.status, "cancelled"),
      ),
    );
  return rows.filter((m) => {
    if (input.facilityId && m.facilityId !== input.facilityId) return false;
    if (input.unitIds && !input.unitIds.includes(m.unitId)) return false;
    return true;
  });
}

/** Semente demo: 3 reservas reais + partidos (M12). */
export async function seedDemoOpenMatches(now = new Date()): Promise<number> {
  const day = localDateIso(now, DEFAULT_TIMEZONE);
  const addDays = (iso: string, n: number) => {
    const [y, m, d] = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(y!, m! - 1, d! + n));
    return dt.toISOString().slice(0, 10);
  };

  /* REVISION-41 O2: horas crible (18:00–20:00) en franxas da semente
   * (pádel xa ten grella 16–22; pavillón crea a franxa se falta). */
  const demos = [
    {
      id: "om-demo-padel-1",
      bookingId: "bk-om-demo-1",
      title: "Pádel aberto · nivel medio",
      sport: "padel",
      date: addDays(day, 2),
      start: "18:00",
      end: "19:00",
      spots: 4,
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-1",
      organizer: "user-cidada",
      name: "Ana Demo",
      joinAna: false,
      almostFull: false,
    },
    {
      id: "om-demo-padel-2",
      bookingId: "bk-om-demo-2",
      title: "Buscamos 2 para pádel",
      sport: "padel",
      date: addDays(day, 3),
      start: "19:00",
      end: "20:00",
      spots: 4,
      facilityId: "fac-exemplo-padel",
      unitId: "unit-padel-2",
      organizer: "user-brais",
      name: "Luis Demo",
      joinAna: true,
      almostFull: false,
    },
    {
      id: "om-demo-pav-1",
      bookingId: "bk-om-demo-3",
      title: "Partido amistoso no pavillón",
      sport: "futbol_sala",
      date: addDays(day, 4),
      start: "20:00",
      end: "21:00",
      spots: 4,
      facilityId: "fac-exemplo-pav",
      unitId: "unit-pav-a",
      /* Non Ana: evita esgotar o cupo de reservas activas da semente. */
      organizer: "user-brais",
      name: "Luis Demo",
      joinAna: true,
      almostFull: true,
    },
  ];

  let n = 0;
  for (const d of demos) {
    /* Preferir a franxa da semente (unit,date,start); se non existe, crear unha
     * dedicada (pavillón non ten grella rolling). */
    const [existingSlot] = await getDb()
      .select({ id: t.timeSlots.id })
      .from(t.timeSlots)
      .where(
        and(
          eq(t.timeSlots.unitId, d.unitId),
          eq(t.timeSlots.date, d.date),
          eq(t.timeSlots.start, d.start),
        ),
      )
      .limit(1);
    const slotId = existingSlot?.id ?? `slot-om-${d.id}`;
    if (!existingSlot) {
      await getDb()
        .insert(t.timeSlots)
        .values({
          id: slotId,
          unitId: d.unitId,
          municipalityId: "muni-exemplo",
          date: d.date,
          start: d.start,
          end: d.end,
          closed: false,
          closedReason: null,
        })
        .onConflictDoUpdate({
          target: t.timeSlots.id,
          set: {
            date: d.date,
            start: d.start,
            end: d.end,
            closed: false,
          },
        });
    }

    await getDb()
      .insert(t.bookings)
      .values({
        id: d.bookingId,
        municipalityId: "muni-exemplo",
        facilityId: d.facilityId,
        unitId: d.unitId,
        userId: d.organizer,
        userDisplayName: d.name,
        slotId,
        date: d.date,
        start: d.start,
        end: d.end,
        status: "confirmed",
        shortCode: `OM${n + 1}`.padEnd(5, "X").slice(0, 5),
        qrPayload: `pa:om:${d.bookingId}`,
      })
      .onConflictDoUpdate({
        target: t.bookings.id,
        set: {
          date: d.date,
          start: d.start,
          end: d.end,
          status: "confirmed",
          slotId,
        },
      });

    /* Limpar franxas demo vellas (05:xx) se reutilizamos a grella da semente. */
    const legacySlotId = `slot-om-${d.id}`;
    if (slotId !== legacySlotId) {
      await getDb()
        .delete(t.timeSlots)
        .where(eq(t.timeSlots.id, legacySlotId));
    }

    const [has] = await getDb()
      .select({ id: t.openMatches.id })
      .from(t.openMatches)
      .where(eq(t.openMatches.id, d.id))
      .limit(1);

    const token = has
      ? undefined
      : qrToken();

    if (has) {
      await getDb()
        .update(t.openMatches)
        .set({
          date: d.date,
          start: d.start,
          end: d.end,
          title: d.title,
          status: d.almostFull ? "full" : "open",
          bookingId: d.bookingId,
          notes: null,
          organizerUserId: d.organizer,
          spotsTotal: d.spots,
        })
        .where(eq(t.openMatches.id, d.id));
    } else {
      await getDb().insert(t.openMatches).values({
        id: d.id,
        municipalityId: "muni-exemplo",
        facilityId: d.facilityId,
        unitId: d.unitId,
        bookingId: d.bookingId,
        organizerUserId: d.organizer,
        title: d.title,
        sport: d.sport,
        date: d.date,
        start: d.start,
        end: d.end,
        spotsTotal: d.spots,
        level: "medio",
        notes: null,
        status: d.almostFull ? "full" : "open",
        qrToken: token!,
      });
      await getDb().insert(t.openMatchPlayers).values({
        openMatchId: d.id,
        userId: d.organizer,
        displayName: d.name,
        role: "organizer",
        nameConsentAt: now,
      });
    }

    if (d.joinAna && d.organizer !== "user-cidada") {
      await getDb()
        .insert(t.openMatchPlayers)
        .values({
          openMatchId: d.id,
          userId: "user-cidada",
          displayName: "Ana Demo",
          role: "player",
          nameConsentAt: now,
        })
        .onConflictDoNothing();
    }
    if (d.almostFull) {
      const fillers = [
        { id: "user-brais", name: "Luis Demo" },
        { id: "user-cidada", name: "Ana Demo" },
      ];
      for (const f of fillers) {
        if (f.id === d.organizer) continue;
        await getDb()
          .insert(t.openMatchPlayers)
          .values({
            openMatchId: d.id,
            userId: f.id,
            displayName: f.name,
            role: "player",
            nameConsentAt: now,
          })
          .onConflictDoNothing();
      }
      /* Encher ata spots-1 + org = case cheo, ou cheo con 3 extras */
      const extras = ["user-club"];
      for (const eid of extras) {
        const [u] = await getDb()
          .select({ displayName: t.users.displayName })
          .from(t.users)
          .where(eq(t.users.id, eid))
          .limit(1);
        if (!u) continue;
        await getDb()
          .insert(t.openMatchPlayers)
          .values({
            openMatchId: d.id,
            userId: eid,
            displayName: u.displayName,
            role: "player",
            nameConsentAt: now,
          })
          .onConflictDoNothing();
      }
    }
    /* Semilla demo: marcar consentimento en participantes existentes. */
    await getDb()
      .update(t.openMatchPlayers)
      .set({ nameConsentAt: now })
      .where(
        and(
          eq(t.openMatchPlayers.openMatchId, d.id),
          sql`${t.openMatchPlayers.nameConsentAt} is null`,
        ),
      );
    n += 1;
  }
  return n;
}
