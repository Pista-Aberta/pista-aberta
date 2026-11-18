/**
 * Rev4 día a día: recordatorios, Estou aquí, persoas, informe, no-show.
 */
import { createHash, createHmac } from "node:crypto";
import { and, asc, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db/client.js";
import * as t from "../db/schema.js";
import {
  addDaysIso,
  DEFAULT_TIMEZONE,
  localDateIso,
  slotInstant,
} from "./business-rules.js";
import {
  cancelBooking,
  getBooking,
  getFacility,
  getMunicipalityById,
  listBookings,
  listFacilities,
} from "./db.js";
import { audit } from "./extra.js";
import { newId } from "../lib/ids.js";

const DOOR_SECRET = () =>
  process.env.SESSION_SECRET ?? process.env.PA_DOOR_SECRET ?? "pista-aberta-demo-door";

/** Código diario do cartel da porta (cambia cada día civil). */
export function dailyDoorCode(facilityId: string, dateIso: string): string {
  const raw = createHmac("sha256", DOOR_SECRET())
    .update(`${facilityId}|${dateIso}`)
    .digest("hex")
    .slice(0, 8)
    .toUpperCase();
  return raw;
}

export function doorCheckUrl(
  slug: string,
  facilityId: string,
  dateIso: string,
  base = "",
): string {
  const code = dailyDoorCode(facilityId, dateIso);
  return `${base}/c/${slug}/porta/${facilityId}?code=${code}&d=${dateIso}`;
}

export async function markNoShow(
  municipalityId: string,
  bookingId: string,
  actor: string,
  opts?: { penalize?: boolean },
): Promise<{
  id: string;
  status: string;
  penaltyApplied?: boolean;
  blockedUntil?: string;
  warningSent?: boolean;
}> {
  const b = await getBooking(bookingId);
  if (!b || b.municipalityId !== municipalityId) throw new Error("not_found");
  if (b.status !== "confirmed") throw new Error("invalid_status");
  const db = getDb();
  await db
    .update(t.bookings)
    .set({ status: "no_show" })
    .where(eq(t.bookings.id, bookingId));
  await audit(municipalityId, actor, "booking.no_show", bookingId);
  const { offerWaitlistOnCancel } = await import("./extra.js");
  await offerWaitlistOnCancel(b.slotId, municipalityId);

  const penalize = opts?.penalize !== false;
  const penalty =
    penalize && b.userId
      ? await applyNoShowPenaltyIfNeeded(municipalityId, b.userId, actor)
      : null;
  return {
    id: bookingId,
    status: "no_show",
    ...(penalty?.blockedUntil
      ? { penaltyApplied: true, blockedUntil: penalty.blockedUntil }
      : {}),
    ...(penalty?.warningSent ? { warningSent: true } : {}),
  };
}

/**
 * REVISION-21 Q3 + REVISION-23 R11:
 * - aviso no 2.º non presentado (count-1) se o limiar é ≥3;
 * - xanela configurable (`noShowPenaltyWindowDays`, default 30).
 */
async function applyNoShowPenaltyIfNeeded(
  municipalityId: string,
  userId: string,
  actor: string,
): Promise<{ blockedUntil?: string; warningSent?: boolean } | null> {
  const muni = await getMunicipalityById(municipalityId);
  if (!muni) return null;
  const count = muni.settings.noShowPenaltyCount ?? 0;
  const days = muni.settings.noShowPenaltyDays ?? 0;
  const windowDays = muni.settings.noShowPenaltyWindowDays ?? 30;
  if (count <= 0 || days <= 0) return null;

  const tz = muni.settings.timezone ?? DEFAULT_TIMEZONE;
  const today = localDateIso(new Date(), tz);
  const from = (() => {
    const [y, mo, d] = today.split("-").map(Number);
    const noon = new Date(Date.UTC(y!, mo! - 1, d!, 12, 0, 0));
    noon.setUTCDate(noon.getUTCDate() - windowDays);
    return noon.toISOString().slice(0, 10);
  })();

  const db = getDb();
  const noShows = await db
    .select({ id: t.bookings.id, date: t.bookings.date })
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        eq(t.bookings.userId, userId),
        eq(t.bookings.status, "no_show"),
        gte(t.bookings.date, from),
      ),
    );

  const { sendUserNotice } = await import("../notify/send-notice.js");

  /* Aviso preventivo no (count - 1)-ésimo non presentado. */
  if (noShows.length === count - 1 && count >= 2) {
    const remaining = 1;
    const body =
      `Levas ${noShows.length} non presentados nos últimos ${windowDays} días. ` +
      `Se chegas a ${count}, non poderás reservar durante ${days} días.`;
    await sendUserNotice({
      id: newId("n-penalty-warn"),
      municipalityId,
      userId,
      noticeType: "change",
      notifyType: null,
      title: "Aviso por non presentados",
      body,
      email: {
        kind: "no_show_warning",
        data: {
          count: noShows.length,
          limit: count,
          windowDays,
          penaltyDays: days,
        },
      },
    });
    await audit(
      municipalityId,
      actor,
      "booking.no_show_warning",
      `${userId}:count=${noShows.length}:limit=${count}:remaining=${remaining}`,
    );
    return { warningSent: true };
  }

  if (noShows.length < count) return null;

  const blockedUntil = new Date();
  blockedUntil.setUTCDate(blockedUntil.getUTCDate() + days);
  await db
    .update(t.users)
    .set({ bookingBlockedUntil: blockedUntil })
    .where(eq(t.users.id, userId));

  const untilIso = blockedUntil.toISOString();
  const untilDate = untilIso.slice(0, 10);
  const body = `Acumulaches ${noShows.length} non presentados en ${windowDays} días. Non podes reservar ata o ${untilDate} (${days} días). Contacta co concello se precisas reversión.`;
  await sendUserNotice({
    id: newId("n-penalty"),
    municipalityId,
    userId,
    noticeType: "change",
    notifyType: null,
    title: "Penalización por non presentados",
    body,
      email: {
        kind: "no_show_pause",
        data: {
          untilLabel: untilDate,
          noShowDates: noShows.map((n) => n.date).filter(Boolean).slice(0, 8),
        },
      },
    });
  await audit(
    municipalityId,
    actor,
    "booking.no_show_penalty",
    `${userId}:until=${untilIso}:count=${noShows.length}`,
  );
  return { blockedUntil: untilIso };
}

/** Reversión manual da penalización (persoal/admin). */
export async function clearBookingBlock(
  municipalityId: string,
  userId: string,
  actor: string,
): Promise<{ id: string; bookingBlockedUntil: string | null }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(t.users)
    .where(and(eq(t.users.id, userId), eq(t.users.municipalityId, municipalityId)))
    .limit(1);
  if (!rows[0]) throw new Error("not_found");
  const prevUntil = rows[0].bookingBlockedUntil
    ? rows[0].bookingBlockedUntil.toISOString().slice(0, 10)
    : undefined;
  await db
    .update(t.users)
    .set({ bookingBlockedUntil: null })
    .where(eq(t.users.id, userId));
  await audit(municipalityId, actor, "user.booking_block_clear", userId);
  const { sendUserNotice } = await import("../notify/send-notice.js");
  await sendUserNotice({
    id: newId("n-unban"),
    municipalityId,
    userId,
    noticeType: "info",
    notifyType: null,
    title: "Bloqueo de reservas levantado",
    body: "O persoal do concello levantou a penalización. Xa podes volver a reservar.",
    email: {
      kind: "pause_lifted",
      data: {
        pausedUntil: prevUntil,
      },
    },
  });
  return { id: userId, bookingBlockedUntil: null };
}

export async function adminCancelBooking(
  municipalityId: string,
  bookingId: string,
  actor: { id: string; displayName: string },
  reason: string,
) {
  const b = await getBooking(bookingId);
  if (!b || b.municipalityId !== municipalityId) throw new Error("not_found");
  const note = reason.trim() || "Cancelada polo concello";
  const cancelled = await cancelBooking(bookingId, actor.id, true, note);
  const { sendUserNotice } = await import("../notify/send-notice.js");
  if (b.userId) {
    const { getFacility } = await import("./db.js");
    const fac = await getFacility(b.facilityId);
    const { formatDayChip } = await import("@pista-aberta/shared");
    await sendUserNotice({
      id: newId("n-cancel"),
      municipalityId,
      userId: b.userId,
      noticeType: "change",
      notifyType: "cancelacion",
      title: "Reserva cancelada",
      body: `${note} (${formatDayChip(b.date, "gl")} · ${b.start}).`,
      email: {
        kind: "booking_cancelled",
        data: {
          facilityName: fac?.name ?? "Instalación",
          dayLabel: formatDayChip(b.date, "gl"),
          timeLabel: b.start,
          date: b.date,
          start: b.start,
          end: b.end,
          bookingId: b.id,
          icsSequence: b.icsSequence ?? 0,
          reason: note,
          byStaff: true,
        },
      },
    });
  }
  await audit(municipalityId, actor.displayName, "booking.admin_cancel", `${bookingId}:${note}`);
  return cancelled;
}

async function markBookingCheckedIn(
  municipalityId: string,
  userId: string,
  bookingId: string,
  now: Date,
) {
  const b = await getBooking(bookingId);
  if (!b || b.municipalityId !== municipalityId) throw new Error("not_found");
  if (b.userId !== userId) throw new Error("forbidden");
  if (b.status === "checked_in") return b;
  if (b.status !== "confirmed") throw new Error("invalid_status");

  const muni = await getMunicipalityById(municipalityId);
  const tz = muni?.settings.timezone ?? DEFAULT_TIMEZONE;
  const start = slotInstant(b.date, b.start, tz);
  const end = slotInstant(b.date, b.end, tz);
  const openMs = start.getTime() - 10 * 60_000;
  if (now.getTime() < openMs) throw new Error("too_early");
  if (now.getTime() > end.getTime()) throw new Error("too_late");

  await getDb()
    .update(t.bookings)
    .set({ status: "checked_in" })
    .where(eq(t.bookings.id, bookingId));
  return { ...(await getBooking(bookingId))! };
}

/**
 * Check-in da propia persoa («Estou aquí»):
 * activo desde 10 min antes do comezo ata o final da franxa (REVISION-6 A10 / R8 D).
 */
export async function selfCheckIn(
  municipalityId: string,
  userId: string,
  bookingId: string,
  now: Date = new Date(),
) {
  const b = await getBooking(bookingId);
  if (!b || b.municipalityId !== municipalityId) throw new Error("not_found");
  if (b.userId !== userId) throw new Error("forbidden");
  if (b.status === "checked_in") return b;
  if (b.status !== "confirmed") throw new Error("invalid_status");

  /* REVISION-56 H7: con check-in obrigatorio só porta/persoal, non o botón da app. */
  const facility = await getFacility(b.facilityId);
  if (facility?.checkInRequired) {
    throw new Error("door_checkin_required");
  }

  return markBookingCheckedIn(municipalityId, userId, bookingId, now);
}

export type DoorCheckInState =
  | {
      state: "checked_in";
      facilityName: string;
      start: string;
      end: string;
      bookingId: string;
    }
  | {
      state: "no_reservation";
      facilityName: string;
      nextBooking?: {
        facilityName: string;
        date: string;
        start: string;
        end: string;
      };
    }
  | {
      state: "too_early";
      facilityName: string;
      start: string;
      end: string;
      checkInFrom: string;
      bookingId: string;
    }
  | {
      state: "passed";
      facilityName: string;
      start: string;
      end: string;
      bookingId: string;
    };

function hhmmInTz(d: Date, tz: string): string {
  return d.toLocaleTimeString("gl-ES", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  });
}

/** Check-in vía QR diario da porta (código do día). Devolve estado claro para a UI. */
export async function doorSelfCheckIn(
  municipalityId: string,
  userId: string,
  facilityId: string,
  code: string,
  dateIso: string,
  now: Date = new Date(),
): Promise<DoorCheckInState> {
  const fac = await getFacility(facilityId);
  if (!fac || fac.municipalityId !== municipalityId) throw new Error("not_found");
  const expected = dailyDoorCode(facilityId, dateIso);
  if (code.trim().toUpperCase() !== expected) throw new Error("bad_code");

  const muni = await getMunicipalityById(municipalityId);
  const tz = muni?.settings.timezone ?? DEFAULT_TIMEZONE;
  const today = localDateIso(now, tz);
  if (dateIso !== today) throw new Error("wrong_day");

  const bookings = await listBookings({ municipalityId, userId });
  const atFacilityToday = bookings.filter(
    (b) => b.facilityId === facilityId && b.date === today,
  );
  const already = atFacilityToday.find((b) => b.status === "checked_in");
  if (already) {
    return {
      state: "checked_in",
      facilityName: fac.name,
      start: already.start,
      end: already.end,
      bookingId: already.id,
    };
  }

  const candidates = atFacilityToday.filter((b) => b.status === "confirmed");
  const earlyMarginMs = 10 * 60_000;

  async function nextElsewhere(): Promise<
    | { facilityName: string; date: string; start: string; end: string }
    | undefined
  > {
    const upcoming = bookings
      .filter((b) => b.status === "confirmed")
      .map((b) => ({ b, at: slotInstant(b.date, b.start, tz), endAt: slotInstant(b.date, b.end, tz) }))
      .filter((x) => x.endAt.getTime() >= now.getTime())
      .sort((a, b) => a.at.getTime() - b.at.getTime());
    const n = upcoming[0]?.b;
    if (!n) return undefined;
    const nf = await getFacility(n.facilityId);
    return {
      facilityName: nf?.name ?? n.facilityId,
      date: n.date,
      start: n.start,
      end: n.end,
    };
  }

  if (candidates.length === 0) {
    return {
      state: "no_reservation",
      facilityName: fac.name,
      nextBooking: await nextElsewhere(),
    };
  }
  candidates.sort((a, b) => {
    const da = Math.abs(slotInstant(a.date, a.start, tz).getTime() - now.getTime());
    const db = Math.abs(slotInstant(b.date, b.start, tz).getTime() - now.getTime());
    return da - db;
  });
  const pick = candidates[0]!;
  const start = slotInstant(pick.date, pick.start, tz);
  const end = slotInstant(pick.date, pick.end, tz);
  const windowOpen = new Date(start.getTime() - earlyMarginMs);
  if (now.getTime() < windowOpen.getTime()) {
    return {
      state: "too_early",
      facilityName: fac.name,
      start: pick.start,
      end: pick.end,
      checkInFrom: hhmmInTz(windowOpen, tz),
      bookingId: pick.id,
    };
  }
  if (now.getTime() > end.getTime()) {
    return {
      state: "no_reservation",
      facilityName: fac.name,
      nextBooking: await nextElsewhere(),
    };
  }

  const done = await markBookingCheckedIn(municipalityId, userId, pick.id, now);
  return {
    state: "checked_in",
    facilityName: fac.name,
    start: done.start,
    end: done.end,
    bookingId: done.id,
  };
}

export async function searchPeople(
  municipalityId: string,
  q: string,
): Promise<
  Array<{
    id: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    personIdentifier: string | null;
    role: string;
    bookingBlockedUntil: string | null;
    bookings: Array<{
      id: string;
      date: string;
      start: string;
      end: string;
      status: string;
      facilityId: string;
    }>;
  }>
> {
  const term = q.trim();
  if (term.length < 2) return [];
  const like = `%${term}%`;
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(
      and(
        eq(t.users.municipalityId, municipalityId),
        or(
          ilike(t.users.displayName, like),
          ilike(t.users.email, like),
          ilike(t.users.phone, like),
          ilike(t.users.personIdentifier, like),
        ),
      ),
    )
    .limit(20);

  if (rows.length === 0) return [];

  const userIds = rows.map((u) => u.id);
  const bookingRows = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        inArray(t.bookings.userId, userIds),
        eq(t.bookings.status, "confirmed"),
      ),
    )
    .orderBy(desc(t.bookings.date), asc(t.bookings.start))
    .limit(200);

  const byUser = new Map<string, typeof bookingRows>();
  for (const b of bookingRows) {
    if (!b.userId) continue;
    const list = byUser.get(b.userId) ?? [];
    if (list.length >= 10) continue;
    list.push(b);
    byUser.set(b.userId, list);
  }

  return rows.map((u) => ({
    id: u.id,
    displayName: u.displayName,
    email: u.email,
    phone: u.phone ?? null,
    personIdentifier: u.personIdentifier,
    role: u.role,
    bookingBlockedUntil: u.bookingBlockedUntil
      ? u.bookingBlockedUntil.toISOString()
      : null,
    bookings: (byUser.get(u.id) ?? []).map((b) => ({
      id: b.id,
      date: b.date,
      start: b.start,
      end: b.end,
      status: b.status,
      facilityId: b.facilityId,
    })),
  }));
}

export async function monthlyReport(
  municipalityId: string,
  year: number,
  month: number,
) {
  const from = `${year}-${String(month).padStart(2, "0")}-01`;
  const nextM = month === 12 ? 1 : month + 1;
  const nextY = month === 12 ? year + 1 : year;
  const to = `${nextY}-${String(nextM).padStart(2, "0")}-01`;

  const bookings = await getDb()
    .select()
    .from(t.bookings)
    .where(
      and(
        eq(t.bookings.municipalityId, municipalityId),
        gte(t.bookings.date, from),
        sql`${t.bookings.date} < ${to}`,
      ),
    );
  const facilities = await listFacilities(municipalityId);
  const byFacility: Record<string, { name: string; confirmed: number; checkedIn: number; noShow: number; cancelled: number }> =
    {};
  for (const f of facilities) {
    byFacility[f.id] = {
      name: f.name,
      confirmed: 0,
      checkedIn: 0,
      noShow: 0,
      cancelled: 0,
    };
  }
  let noShows = 0;
  let checkedIn = 0;
  let cancelled = 0;
  for (const b of bookings) {
    const bucket = byFacility[b.facilityId] ?? {
      name: b.facilityId,
      confirmed: 0,
      checkedIn: 0,
      noShow: 0,
      cancelled: 0,
    };
    byFacility[b.facilityId] = bucket;
    if (b.status === "checked_in") {
      bucket.checkedIn += 1;
      checkedIn += 1;
    } else if (b.status === "no_show") {
      bucket.noShow += 1;
      noShows += 1;
    } else if (b.status === "cancelled") {
      bucket.cancelled += 1;
      cancelled += 1;
    } else if (b.status === "confirmed") {
      bucket.confirmed += 1;
    }
  }

  /* REVISION-46 V3: mesma definición que dashboardStats.demandUnmet. */
  const waitlist = await getDb()
    .select()
    .from(t.waitlistEntries)
    .where(
      and(
        eq(t.waitlistEntries.municipalityId, municipalityId),
        inArray(t.waitlistEntries.status, ["waiting", "offered"]),
      ),
    );
  const incidents = await getDb()
    .select()
    .from(t.incidents)
    .where(eq(t.incidents.municipalityId, municipalityId));

  const hourHeat: Record<string, number> = {};
  for (const b of bookings) {
    if (b.status === "cancelled") continue;
    hourHeat[b.start] = (hourHeat[b.start] ?? 0) + 1;
  }

  return {
    year,
    month,
    from,
    to,
    totals: {
      bookings: bookings.length,
      checkedIn,
      noShows,
      cancelled,
      waitlistDemand: waitlist.length,
      incidents: incidents.length,
    },
    byFacility: Object.values(byFacility),
    hourHeat: Object.entries(hourHeat)
      .map(([start, count]) => ({ start, count }))
      .sort((a, b) => a.start.localeCompare(b.start)),
  };
}

export function monthlyReportCsv(report: Awaited<ReturnType<typeof monthlyReport>>): string {
  const lines = [
    "facility,confirmed,checked_in,no_show,cancelled",
    ...report.byFacility.map(
      (f) =>
        `"${f.name.replace(/"/g, '""')}",${f.confirmed},${f.checkedIn},${f.noShow},${f.cancelled}`,
    ),
    "",
    `totals,${report.totals.bookings},${report.totals.checkedIn},${report.totals.noShows},${report.totals.cancelled}`,
    `waitlist_demand,${report.totals.waitlistDemand}`,
    `incidents,${report.totals.incidents}`,
  ];
  return lines.join("\n");
}

/** Job: avisos 24 h e 2 h antes da reserva. */
export async function sendBookingReminders(now: Date = new Date()): Promise<number> {
  const db = getDb();
  const munis = await db.select().from(t.municipalities);
  let sent = 0;
  for (const m of munis) {
    const tz = (m.settings as { timezone?: string })?.timezone ?? DEFAULT_TIMEZONE;
    /* REVISION-58 H4-resto: só próximas 48 h (non todas as reservas). */
    const today = localDateIso(now, tz);
    const bookings = await listBookings({
      municipalityId: m.id,
      dateFrom: today,
      dateTo: addDaysIso(today, 2),
    });
    for (const b of bookings) {
      if (b.status !== "confirmed" || !b.userId) continue;
      const start = slotInstant(b.date, b.start, tz);
      const hours = (start.getTime() - now.getTime()) / 3_600_000;
      let kind: "24h" | "2h" | null = null;
      if (hours <= 24.5 && hours >= 23.5) kind = "24h";
      else if (hours <= 2.25 && hours >= 1.75) kind = "2h";
      if (!kind) continue;

      const dedupe = `reminder-${kind}-${b.id}`;
      const { shouldNotify } = await import("../notify/prefs.js");
      const users = await db
        .select()
        .from(t.users)
        .where(eq(t.users.id, b.userId))
        .limit(1);
      if (!users[0]) continue;
      const prefs = users[0].notifyPrefs;
      if (
        !shouldNotify(prefs, "recordatorio", "inApp") &&
        !shouldNotify(prefs, "recordatorio", "email")
      ) {
        continue;
      }

      const fac = await getFacility(b.facilityId);
      const muniFull = await getMunicipalityById(m.id);
      const { antesDeIrLines } = await import("../notify/emails/booking-content.js");
      let meteoRain: { period: "manha" | "tarde" | "noite"; chance: number } | null =
        null;
      if (fac && muniFull) {
        const {
          facilityIsOutdoor,
          resolveMunicipalityIne,
          fetchMeteoGalicia,
          rainWarningForSlot,
        } = await import("./meteogalicia.js");
        if (facilityIsOutdoor(fac)) {
          const ine = resolveMunicipalityIne(muniFull);
          const forecast = ine ? await fetchMeteoGalicia(ine, "gl") : null;
          meteoRain = rainWarningForSlot(forecast, b.date, b.start);
        }
      }
      const when =
        kind === "24h"
          ? `Mañá ás ${b.start}`
          : `En 2 h · ${b.start}`;
      const rainNote = meteoRain
        ? ` · Choiva ${meteoRain.chance}%`
        : "";
      const body = `${when} · ${fac?.name ?? "Instalación"}${rainNote} · Cancelar se non vas. [${dedupe}]`;
      const { sendUserNotice } = await import("../notify/send-notice.js");
      const { formatDayChip } = await import("@pista-aberta/shared");
      // A PK claim makes concurrent/retried jobs idempotent without scanning notices.
      const claimed = await db
        .insert(t.notificationDedupes)
        .values({
          key: dedupe,
          municipalityId: m.id,
          userId: b.userId,
          createdAt: now,
        })
        .onConflictDoNothing()
        .returning();
      if (!claimed[0]) continue;
      await sendUserNotice({
        id: `n-rem-${createHash("sha1").update(dedupe).digest("hex").slice(0, 12)}`,
        municipalityId: m.id,
        userId: b.userId,
        noticeType: "reminder",
        notifyType: "recordatorio",
        title: kind === "24h" ? "Recordatorio · mañá" : "Recordatorio · 2 h",
        body,
        email: {
          kind: "reminder",
          data: {
            facilityName: fac?.name ?? "Instalación",
            facilityId: b.facilityId,
            facilityAddress: fac?.address,
            facilityLat: fac?.lat,
            facilityLng: fac?.lng,
            parkingInfo: fac?.parkingInfo ?? undefined,
            entranceInfo: fac?.entranceInfo ?? undefined,
            dayLabel: formatDayChip(b.date, "gl"),
            timeLabel: `${b.start}–${b.end}`,
            date: b.date,
            start: b.start,
            end: b.end,
            bookingId: b.id,
            window: kind === "24h" ? "24h" : "2h",
            antesDeIr: muniFull
              ? antesDeIrLines(muniFull, "gl", fac)
              : undefined,
            meteoRain,
          },
        },
      });
      sent += 1;
    }
  }
  return sent;
}

export async function updateNotifyPrefs(
  userId: string,
  prefs: {
    notifyEmail?: boolean;
    notifyReminders?: boolean;
    notifyPrefs?: import("@pista-aberta/shared").NotifyPrefs;
  },
) {
  const {
    normalizeNotifyPrefs,
    derivedNotifyFlags,
    applyLegacyToggles,
  } = await import("../notify/prefs.js");
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  if (!rows[0]) return;
  let next = normalizeNotifyPrefs(rows[0].notifyPrefs);
  if (prefs.notifyPrefs) next = normalizeNotifyPrefs(prefs.notifyPrefs);
  else {
    next = applyLegacyToggles(next, {
      notifyEmail: prefs.notifyEmail,
      notifyReminders: prefs.notifyReminders,
    });
  }
  const flags = derivedNotifyFlags(next);
  await getDb()
    .update(t.users)
    .set({
      notifyPrefs: next,
      notifyEmail: flags.notifyEmail,
      notifyReminders: flags.notifyReminders,
    })
    .where(eq(t.users.id, userId));
}
