/**
 * Extensións D sobre Drizzle: avisos, familia, tempada, auditoría, waitlist.
 */
import {
  and,
  asc,
  desc,
  eq,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  notInArray,
  or,
} from "drizzle-orm";
import type {
  AuditEvent,
  ClubMember,
  FamilyMember,
  Notice,
  NoticePayload,
  SeasonSlot,
  WaitlistEntry,
} from "@pista-aberta/shared";
import { formatDate } from "@pista-aberta/shared";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  mapAudit,
  mapClubMember,
  mapFamily,
  mapNotice,
  mapSeason,
  mapWaitlist,
} from "../db/mappers.js";
import { DEFAULT_TIMEZONE, slotInstant } from "./business-rules.js";
import { getFacility, getMunicipalityById } from "./db.js";
import { newId } from "../lib/ids.js";

/** Máximo de colas activas por persoa (AVISOS §3). */
export const WAITLIST_MAX_QUEUES = 3;
/** Minutos que a franxa queda apartada para a primeira da cola. */
export const WAITLIST_HOLD_MINUTES = 30;
/** Se faltan menos de N horas, avísase a toda a cola. */
export const WAITLIST_RUSH_HOURS = 2;
export const LIST_DEFAULT_LIMIT = 100;
export const LIST_MAX_LIMIT = 500;

export type ListBounds = {
  limit?: number;
  offset?: number;
  from?: Date;
  to?: Date;
};

function bounds(opts?: ListBounds) {
  return {
    limit: Math.min(
      LIST_MAX_LIMIT,
      Math.max(1, Math.trunc(opts?.limit ?? LIST_DEFAULT_LIMIT)),
    ),
    offset: Math.max(0, Math.trunc(opts?.offset ?? 0)),
  };
}

export async function listNotices(
  municipalityId: string,
  userId?: string,
  opts?: ListBounds & { unread?: boolean },
): Promise<Notice[]> {
  const db = getDb();
  const page = bounds(opts);
  const visibility = userId
    ? or(isNull(t.notices.userId), eq(t.notices.userId, userId))
    : isNull(t.notices.userId);
  const rows = await db
    .select({ notice: t.notices, readAt: t.noticeReads.readAt })
    .from(t.notices)
    .leftJoin(
      t.noticeReads,
      and(
        eq(t.noticeReads.noticeId, t.notices.id),
        eq(t.noticeReads.userId, userId ?? "__anonymous__"),
      ),
    )
    .where(
      and(
        eq(t.notices.municipalityId, municipalityId),
        visibility,
        opts?.from ? gte(t.notices.createdAt, opts.from) : undefined,
        opts?.to ? lte(t.notices.createdAt, opts.to) : undefined,
        opts?.unread && userId ? isNull(t.noticeReads.noticeId) : undefined,
      ),
    )
    .orderBy(desc(t.notices.createdAt))
    .limit(page.limit)
    .offset(page.offset);

  return rows
    .map((r) => {
      const n = mapNotice(r.notice);
      return {
        ...n,
        read: userId ? r.readAt !== null : false,
      };
    });
}

/** Lista só pendentes (non lidos) para a caixa de entrada. */
export async function listUnreadNotices(
  municipalityId: string,
  userId?: string,
  opts?: ListBounds,
): Promise<Notice[]> {
  return listNotices(municipalityId, userId, { ...opts, unread: true });
}

/**
 * Marca un aviso como lido **para ese usuario** (táboa notice_reads).
 * Non muda o booleano global `notices.read` (deprecated).
 */
export async function markNoticeRead(
  id: string,
  userId: string,
  municipalityId?: string,
): Promise<void> {
  const db = getDb();
  const [row] = await db
    .select()
    .from(t.notices)
    .where(eq(t.notices.id, id))
    .limit(1);
  if (!row) throw new Error("notice_not_found");
  if (municipalityId && row.municipalityId !== municipalityId) {
    throw new Error("notice_not_found");
  }
  if (row.userId != null && row.userId !== userId) {
    throw new Error("notice_forbidden");
  }
  await db
    .insert(t.noticeReads)
    .values({ noticeId: id, userId, readAt: new Date() })
    .onConflictDoNothing();
}

export async function listFamily(userId: string): Promise<FamilyMember[]> {
  const rows = await getDb()
    .select()
    .from(t.familyMembers)
    .where(eq(t.familyMembers.userId, userId));
  return rows.map(mapFamily);
}

export async function addFamilyMember(
  input: Omit<FamilyMember, "id">,
): Promise<FamilyMember> {
  const { assertDisplayNameForMatch } = await import("@pista-aberta/shared");
  const safeName = assertDisplayNameForMatch(input.displayName);
  const m: FamilyMember = { ...input, id: newId("fam"), displayName: safeName };
  await getDb().insert(t.familyMembers).values({
    id: m.id,
    userId: m.userId,
    municipalityId: m.municipalityId,
    displayName: safeName,
    birthYear: m.birthYear ?? null,
    relation: m.relation,
  });
  return m;
}

export async function removeFamilyMember(
  userId: string,
  memberId: string,
): Promise<void> {
  const existing = await getDb()
    .select({ id: t.familyMembers.id })
    .from(t.familyMembers)
    .where(
      and(eq(t.familyMembers.id, memberId), eq(t.familyMembers.userId, userId)),
    )
    .limit(1);
  if (!existing.length) throw new Error("not_found");
  await getDb()
    .delete(t.familyMembers)
    .where(
      and(eq(t.familyMembers.id, memberId), eq(t.familyMembers.userId, userId)),
    );
}

/** REVISION-58 K7 — engadir ano de nacemento a un familiar existente. */
export async function updateFamilyMember(
  userId: string,
  memberId: string,
  patch: { birthYear: number },
): Promise<FamilyMember> {
  const year = Number(patch.birthYear);
  const maxY = new Date().getFullYear();
  if (!Number.isInteger(year) || year < 1900 || year > maxY) {
    throw new Error("invalid_birth_year");
  }
  const existing = await getDb()
    .select()
    .from(t.familyMembers)
    .where(
      and(eq(t.familyMembers.id, memberId), eq(t.familyMembers.userId, userId)),
    )
    .limit(1);
  if (!existing[0]) throw new Error("not_found");
  await getDb()
    .update(t.familyMembers)
    .set({ birthYear: year })
    .where(
      and(eq(t.familyMembers.id, memberId), eq(t.familyMembers.userId, userId)),
    );
  return mapFamily({ ...existing[0], birthYear: year });
}

export async function getConsent(userId: string) {
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  const u = rows[0];
  if (!u?.consentAt) return null;
  return { at: u.consentAt.toISOString(), version: u.consentVersion ?? "2026-10-rxpd-v1" };
}

export async function setConsent(userId: string, version = "2026-10-rxpd-v1") {
  const at = new Date();
  await getDb()
    .update(t.users)
    .set({ consentAt: at, consentVersion: version })
    .where(eq(t.users.id, userId));
  return { at: at.toISOString(), version };
}

export async function listSeasonSlots(
  municipalityId: string,
  clubId?: string,
): Promise<SeasonSlot[]> {
  const rows = clubId
    ? await getDb()
        .select()
        .from(t.seasonSlots)
        .where(
          and(
            eq(t.seasonSlots.municipalityId, municipalityId),
            eq(t.seasonSlots.clubId, clubId),
          ),
        )
    : await getDb()
        .select()
        .from(t.seasonSlots)
        .where(eq(t.seasonSlots.municipalityId, municipalityId));
  return rows.map(mapSeason);
}

export async function listClubMembers(clubId: string): Promise<ClubMember[]> {
  const rows = await getDb()
    .select()
    .from(t.clubMembers)
    .where(eq(t.clubMembers.clubId, clubId));
  return rows.map(mapClubMember);
}

export async function inviteClubMember(
  input: Omit<ClubMember, "id">,
): Promise<ClubMember> {
  const m: ClubMember = { ...input, id: newId("cm") };
  await getDb().insert(t.clubMembers).values({
    id: m.id,
    clubId: m.clubId,
    municipalityId: m.municipalityId,
    displayName: m.displayName,
    email: m.email,
    role: m.role,
  });
  await audit(input.municipalityId, input.email, "club.invite", `Invitado ${input.displayName}`);
  return m;
}

export async function audit(
  municipalityId: string,
  actor: string,
  action: string,
  detail: string,
): Promise<AuditEvent> {
  const ev: AuditEvent = {
    id: newId("au"),
    municipalityId,
    at: new Date().toISOString(),
    actor,
    action,
    detail,
  };
  await getDb().insert(t.auditEvents).values({
    id: ev.id,
    municipalityId: ev.municipalityId,
    at: new Date(ev.at),
    actor: ev.actor,
    action: ev.action,
    detail: ev.detail,
  });
  return ev;
}

export async function listAudit(
  municipalityId: string,
  opts?: ListBounds & { actor?: string },
): Promise<Array<AuditEvent & { actorLabel?: string; actorRole?: string | null }>> {
  const db = getDb();
  const page = bounds(opts);
  const rows = await db
    .select()
    .from(t.auditEvents)
    .where(
      and(
        eq(t.auditEvents.municipalityId, municipalityId),
        opts?.actor ? eq(t.auditEvents.actor, opts.actor) : undefined,
        opts?.from ? gte(t.auditEvents.at, opts.from) : undefined,
        opts?.to ? lte(t.auditEvents.at, opts.to) : undefined,
      ),
    )
    .orderBy(desc(t.auditEvents.at))
    .limit(page.limit)
    .offset(page.offset);
  const actorIds = [...new Set(rows.map((row) => row.actor))];
  const users = await db
    .select({
      id: t.users.id,
      displayName: t.users.displayName,
      role: t.users.role,
    })
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        actorIds.length ? inArray(t.users.id, actorIds) : undefined,
      ),
    )
    .limit(actorIds.length || 1);
  const byId = new Map(users.map((u) => [u.id, u]));
  return rows.map((r) => {
    const ev = mapAudit(r);
    const u = byId.get(ev.actor);
    if (u) {
      return {
        ...ev,
        actorLabel: u.role === "citizen" ? "citizen" : u.displayName,
        actorRole: u.role,
      };
    }
    if (ev.actor === "sistema" || ev.actor === "system") {
      return { ...ev, actorLabel: "sistema", actorRole: null };
    }
    return { ...ev, actorLabel: ev.actor, actorRole: null };
  });
}

function activeWaitStatuses() {
  return ["waiting", "offered"] as const;
}

async function notifyWaitlistOffer(opts: {
  municipalityId: string;
  userId: string;
  slotId: string;
  body: string;
  payload?: NoticePayload | null;
  holdUntil?: Date | null;
}): Promise<void> {
  const holdLine = opts.holdUntil
    ? `Apartámosche a praza ata as ${opts.holdUntil.toLocaleTimeString("gl-ES", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: DEFAULT_TIMEZONE,
      })}.`
    : "Quen reserve primeiro lévaa.";
  const noticeId = newId("n-wl");
  const { sendUserNotice } = await import("../notify/send-notice.js");
  const holdUntilLabel = opts.holdUntil
    ? opts.holdUntil.toLocaleTimeString("gl-ES", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: DEFAULT_TIMEZONE,
      })
    : "—";
  const payload = (opts.payload ?? {}) as Record<string, unknown>;
  const muni = await getMunicipalityById(opts.municipalityId);
  const slug = muni?.slug ?? "";
  await sendUserNotice({
    id: noticeId,
    municipalityId: opts.municipalityId,
    userId: opts.userId,
    noticeType: "waitlist",
    notifyType: "praza_liberada",
    title: "Praza liberada",
    body: opts.body,
    payload: opts.payload ?? null,
    email: {
      kind: "waitlist_offer",
      data: {
        sport: String(
          payload.unitName ?? payload.facilityName ?? payload.sport ?? "Deporte",
        ),
        facilityName: String(
          payload.unitName ?? payload.facilityName ?? "Instalación",
        ),
        facilityId: String(payload.facilityId ?? ""),
        dayLabel: String(payload.dayLabel ?? payload.date ?? ""),
        timeLabel: String(payload.start ?? payload.timeLabel ?? ""),
        date: String(payload.date ?? ""),
        slotId: opts.slotId,
        holdUntilLabel,
        declineUrl: `/c/${slug}/reservas?deixar=${encodeURIComponent(opts.slotId)}`,
      },
    },
  });
}

export async function addWaitlist(
  input: Omit<WaitlistEntry, "id" | "status" | "createdAt" | "offeredUntil">,
): Promise<WaitlistEntry> {
  const db = getDb();
  const slots = await db
    .select()
    .from(t.timeSlots)
    .where(
      and(
        eq(t.timeSlots.id, input.slotId),
        eq(t.timeSlots.municipalityId, input.municipalityId),
      ),
    )
    .limit(1);
  if (!slots[0]) throw new Error("slot_not_found");

  const existingBooking = await db
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.slotId, input.slotId),
        eq(t.bookings.userId, input.userId),
        eq(t.bookings.status, "confirmed"),
      ),
    )
    .limit(1);
  if (existingBooking[0]) throw new Error("already_booked");

  /* REVISION-42 Q9b: non apuntarse se xa tes reserva persoal a esa hora. */
  {
    const slot = slots[0]!;
    const { assertNoPersonalOverlap } = await import("./booking-overlap.js");
    await assertNoPersonalOverlap({
      municipalityId: input.municipalityId,
      userId: input.userId,
      date: slot.date,
      start: slot.start,
      end: slot.end,
    });
  }

  const dup = await db
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, input.municipalityId),
        eq(t.waitlistEntries.slotId, input.slotId),
        eq(t.waitlistEntries.userId, input.userId),
        inArray(t.waitlistEntries.status, [...activeWaitStatuses()]),
      ),
    )
    .limit(1);
  if (dup[0]) throw new Error("waitlist_duplicate");

  const active = await db
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, input.municipalityId),
        eq(t.waitlistEntries.userId, input.userId),
        inArray(t.waitlistEntries.status, [...activeWaitStatuses()]),
      ),
    );
  if (active.length >= WAITLIST_MAX_QUEUES) throw new Error("waitlist_limit");

  const w: WaitlistEntry = {
    ...input,
    id: newId("wl"),
    status: "waiting",
    createdAt: new Date().toISOString(),
    offeredUntil: null,
  };
  await db.insert(t.waitlistEntries).values({
    id: w.id,
    municipalityId: w.municipalityId,
    slotId: w.slotId,
    userId: w.userId,
    userDisplayName: w.userDisplayName,
    status: w.status,
    offeredUntil: null,
    createdAt: new Date(w.createdAt),
  });
  return w;
}

export async function leaveWaitlist(
  municipalityId: string,
  userId: string,
  slotId: string,
): Promise<void> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, municipalityId),
        eq(t.waitlistEntries.userId, userId),
        eq(t.waitlistEntries.slotId, slotId),
        inArray(t.waitlistEntries.status, [...activeWaitStatuses()]),
      ),
    )
    .limit(1);
  const entry = rows[0];
  if (!entry) throw new Error("not_found");
  await db
    .update(t.waitlistEntries)
    .set({ status: "cancelled", offeredUntil: null })
    .where(eq(t.waitlistEntries.id, entry.id));

  // Se tiña a franxa apartada, liberar e pasar á seguinte.
  const slotRows = await db
    .select()
    .from(t.timeSlots)
    .where(eq(t.timeSlots.id, slotId))
    .limit(1);
  const slot = slotRows[0];
  if (slot?.heldForUserId === userId) {
    await db
      .update(t.timeSlots)
      .set({ heldForUserId: null, heldUntil: null })
      .where(eq(t.timeSlots.id, slotId));
    await offerWaitlistOnCancel(slotId, municipalityId);
  }
}

export async function listMyWaitlist(
  municipalityId: string,
  userId: string,
): Promise<WaitlistEntry[]> {
  const rows = await getDb()
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, municipalityId),
        eq(t.waitlistEntries.userId, userId),
        inArray(t.waitlistEntries.status, [...activeWaitStatuses()]),
      ),
    )
    .orderBy(asc(t.waitlistEntries.createdAt));
  return rows.map(mapWaitlist);
}

/**
 * Liberación de franxa → oferta á cola (AVISOS §3).
 * >2 h: primeira da cola + hold 30 min.
 * <2 h: avisar a toda a cola (sen hold).
 */
export async function offerWaitlistOnCancel(
  slotId: string,
  municipalityId: string,
  now: Date = new Date(),
): Promise<WaitlistEntry | null> {
  const db = getDb();
  const slots = await db
    .select()
    .from(t.timeSlots)
    .where(
      and(eq(t.timeSlots.id, slotId), eq(t.timeSlots.municipalityId, municipalityId)),
    )
    .limit(1);
  const slot = slots[0];
  if (!slot) return null;

  /* REVISION-56 H9: franxa pechada → non ofertar; pechar entradas da cola. */
  if (slot.closed) {
    await db
      .update(t.waitlistEntries)
      .set({ status: "expired", offeredUntil: null })
      .where(
        and(
          eq(t.waitlistEntries.slotId, slotId),
          eq(t.waitlistEntries.municipalityId, municipalityId),
          inArray(t.waitlistEntries.status, ["waiting", "offered"]),
        ),
      );
    await db
      .update(t.timeSlots)
      .set({ heldForUserId: null, heldUntil: null })
      .where(eq(t.timeSlots.id, slotId));
    return null;
  }

  /* Non ofertar se a franxa xa ten reserva activa (carreira con nova reserva). */
  const occupied = await db
    .select({ id: t.bookings.id })
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.slotId, slotId),
        eq(t.bookings.municipalityId, municipalityId),
        notInArray(t.bookings.status, ["cancelled", "no_show"]),
      ),
    )
    .limit(1);
  if (occupied[0]) return null;

  const muni = await getMunicipalityById(municipalityId);
  const tz = muni?.settings.timezone ?? DEFAULT_TIMEZONE;
  const startAt = slotInstant(slot.date, slot.start, tz);
  const hoursLeft = (startAt.getTime() - now.getTime()) / 3_600_000;

  const waiting = await db
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.slotId, slotId),
        eq(t.waitlistEntries.municipalityId, municipalityId),
        eq(t.waitlistEntries.status, "waiting"),
      ),
    )
    .orderBy(asc(t.waitlistEntries.createdAt));

  if (waiting.length === 0) {
    await db
      .update(t.timeSlots)
      .set({ heldForUserId: null, heldUntil: null })
      .where(eq(t.timeSlots.id, slotId));
    return null;
  }

  const dateLabel = formatDate(slot.date, "gl");
  const unitRows = await db
    .select()
    .from(t.units)
    .where(eq(t.units.id, slot.unitId))
    .limit(1);
  const facilityId = unitRows[0]?.facilityId;
  const unitName = unitRows[0]?.name?.trim() || undefined;
  const fac = facilityId ? await getFacility(facilityId) : null;
  const { formatDayChip } = await import("@pista-aberta/shared");
  /* REVISION-38 J2: slotId no payload para aceptar a oferta correcta.
   * REVISION-43 R3: unitName para a faixa/aviso/correo. */
  const payloadBase: NoticePayload = {
    date: slot.date,
    start: slot.start,
    facilityId,
    facilityName: fac?.name,
    unitName,
    dayLabel: formatDayChip(slot.date, "gl"),
    slotId,
  };

  if (hoursLeft < WAITLIST_RUSH_HOURS) {
    // Rush: avisar a todos; sen apartar. holdUntil = inicio da franxa (J3).
    await db
      .update(t.timeSlots)
      .set({ heldForUserId: null, heldUntil: null })
      .where(eq(t.timeSlots.id, slotId));
    const body = `Liberouse a franxa do ${dateLabel} ás ${slot.start}. Quen reserve primeiro lévaa.`;
    for (const next of waiting) {
      await db
        .update(t.waitlistEntries)
        .set({ status: "offered", offeredUntil: startAt })
        .where(eq(t.waitlistEntries.id, next.id));
      await notifyWaitlistOffer({
        municipalityId,
        userId: next.userId,
        slotId,
        body,
        payload: {
          ...payloadBase,
          holdUntil: startAt.toISOString(),
        },
        holdUntil: startAt,
      });
    }
    return { ...mapWaitlist(waiting[0]!), status: "offered", offeredUntil: startAt.toISOString() };
  }

  const next = waiting[0]!;
  const holdUntil = new Date(now.getTime() + WAITLIST_HOLD_MINUTES * 60_000);
  await db
    .update(t.waitlistEntries)
    .set({ status: "offered", offeredUntil: holdUntil })
    .where(eq(t.waitlistEntries.id, next.id));
  await db
    .update(t.timeSlots)
    .set({ heldForUserId: next.userId, heldUntil: holdUntil })
    .where(eq(t.timeSlots.id, slotId));

  const holdLabel = holdUntil.toLocaleTimeString("gl-ES", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: tz,
  });
  await notifyWaitlistOffer({
    municipalityId,
    userId: next.userId,
    slotId,
    body: `Liberouse a franxa do ${dateLabel} ás ${slot.start}. Apartámosche a praza ata as ${holdLabel}.`,
    payload: {
      ...payloadBase,
      holdUntil: holdUntil.toISOString(),
    },
    holdUntil,
  });
  return {
    ...mapWaitlist(next),
    status: "offered",
    offeredUntil: holdUntil.toISOString(),
  };
}

export async function listWaitlist(
  municipalityId: string,
  opts?: ListBounds & { status?: string; userId?: string },
): Promise<WaitlistEntry[]> {
  const page = bounds(opts);
  const rows = await getDb()
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, municipalityId),
        opts?.status ? eq(t.waitlistEntries.status, opts.status) : undefined,
        opts?.userId ? eq(t.waitlistEntries.userId, opts.userId) : undefined,
        opts?.from ? gte(t.waitlistEntries.createdAt, opts.from) : undefined,
        opts?.to ? lte(t.waitlistEntries.createdAt, opts.to) : undefined,
      ),
    )
    .orderBy(asc(t.waitlistEntries.createdAt))
    .limit(page.limit)
    .offset(page.offset);
  return rows.map(mapWaitlist);
}

/** Aceptar praza ofrecida → crea reserva e pecha a entrada. */
export async function acceptWaitlistOffer(
  municipalityId: string,
  userId: string,
  userDisplayName: string,
  now: Date = new Date(),
  /** REVISION-38 J2: aceptar a oferta do slotId do aviso (non a primeira). */
  slotId?: string | null,
): Promise<{
  bookingId: string;
  slotId: string;
  facilityName: string;
  facilityId: string;
  date: string;
  start: string;
  end: string;
}> {
  const conds = [
    eq(t.waitlistEntries.municipalityId, municipalityId),
    eq(t.waitlistEntries.userId, userId),
    eq(t.waitlistEntries.status, "offered"),
  ];
  if (slotId?.trim()) {
    conds.push(eq(t.waitlistEntries.slotId, slotId.trim()));
  }
  const rows = await getDb()
    .select()
    .from(t.waitlistEntries)
    .where(and(...conds))
    .limit(1);
  const entry = rows[0];
  if (!entry) throw new Error("no_offer");
  if (entry.offeredUntil && entry.offeredUntil.getTime() < now.getTime()) {
    throw new Error("offer_expired");
  }
  const { createBooking } = await import("./db.js");
  const booking = await createBooking({
    municipalityId,
    slotId: entry.slotId,
    userId,
    userDisplayName,
    now,
  });
  await getDb()
    .update(t.waitlistEntries)
    .set({ status: "accepted", offeredUntil: null })
    .where(eq(t.waitlistEntries.id, entry.id));
  // Caducar outras ofertas da mesma franxa (rush).
  await getDb()
    .update(t.waitlistEntries)
    .set({ status: "expired", offeredUntil: null })
    .where(
      and(
        eq(t.waitlistEntries.slotId, entry.slotId),
        eq(t.waitlistEntries.status, "offered"),
        ne(t.waitlistEntries.id, entry.id),
      ),
    );

  /* REVISION-42 Q9b: caducar outras colas/ofertas da persoa que solapan;
   * soltar apartados e ofrecer á seguinte. */
  {
    const { listOverlappingWaitlistEntries } = await import(
      "./booking-overlap.js"
    );
    const overlapping = await listOverlappingWaitlistEntries({
      municipalityId,
      userId,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      excludeEntryId: entry.id,
    });
    for (const other of overlapping) {
      await getDb()
        .update(t.waitlistEntries)
        .set({ status: "expired", offeredUntil: null })
        .where(eq(t.waitlistEntries.id, other.id));
      await getDb()
        .update(t.timeSlots)
        .set({ heldForUserId: null, heldUntil: null })
        .where(
          and(
            eq(t.timeSlots.id, other.slotId),
            eq(t.timeSlots.heldForUserId, userId),
          ),
        );
      await offerWaitlistOnCancel(other.slotId, municipalityId, now);
    }
  }

  const fac = await getFacility(booking.facilityId);
  return {
    bookingId: booking.id,
    slotId: entry.slotId,
    facilityName: fac?.name ?? "",
    facilityId: booking.facilityId,
    date: booking.date,
    start: booking.start,
    end: booking.end,
  };
}

/**
 * Job: caducar ofertas vencidas (pasar á seguinte) e colas de franxas xa comezadas.
 */
export async function expireWaitlistOffers(now: Date = new Date()): Promise<{
  expiredOffers: number;
  expiredStarted: number;
  reoffered: number;
}> {
  const db = getDb();
  let expiredOffers = 0;
  let expiredStarted = 0;
  let reoffered = 0;

  const stale = await db
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.status, "offered"),
        lt(t.waitlistEntries.offeredUntil, now),
      ),
    );
  for (const entry of stale) {
    await db
      .update(t.waitlistEntries)
      .set({ status: "expired", offeredUntil: null })
      .where(eq(t.waitlistEntries.id, entry.id));
    expiredOffers += 1;
    await db
      .update(t.timeSlots)
      .set({ heldForUserId: null, heldUntil: null })
      .where(
        and(
          eq(t.timeSlots.id, entry.slotId),
          eq(t.timeSlots.heldForUserId, entry.userId),
        ),
      );
    // Só reofrecer se a franxa segue libre (pending conta como ocupada).
    const booked = await db
      .select()
      .from(t.bookings)
      .where(
        and(
          eq(t.bookings.slotId, entry.slotId),
          notInArray(t.bookings.status, ["cancelled", "no_show"]),
        ),
      )
      .limit(1);
    if (!booked[0]) {
      const next = await offerWaitlistOnCancel(entry.slotId, entry.municipalityId, now);
      if (next) reoffered += 1;
    }
  }

  // Colas de franxas xa comezadas.
  const active = await db
    .select()
    .from(t.waitlistEntries)
    .where(inArray(t.waitlistEntries.status, [...activeWaitStatuses()]));
  for (const entry of active) {
    const slots = await db
      .select()
      .from(t.timeSlots)
      .where(eq(t.timeSlots.id, entry.slotId))
      .limit(1);
    const slot = slots[0];
    if (!slot) continue;
    const muni = await getMunicipalityById(entry.municipalityId);
    const tz = muni?.settings.timezone ?? DEFAULT_TIMEZONE;
    const startAt = slotInstant(slot.date, slot.start, tz);
    if (startAt.getTime() <= now.getTime()) {
      await db
        .update(t.waitlistEntries)
        .set({ status: "expired", offeredUntil: null })
        .where(eq(t.waitlistEntries.id, entry.id));
      expiredStarted += 1;
      await db
        .update(t.timeSlots)
        .set({ heldForUserId: null, heldUntil: null })
        .where(eq(t.timeSlots.id, slot.id));
    }
  }

  return { expiredOffers, expiredStarted, reoffered };
}

/** Seed extra data só se aínda non hai avisos (idempotente). */
export async function ensureExtraSeed(): Promise<void> {
  const existing = await getDb().select().from(t.notices).limit(1);
  if (existing.length) return;
  // O seed principal (`seedDb`) xa inserta extras; este é no-op se baleiro raro.
  void or;
  void isNull;
}
