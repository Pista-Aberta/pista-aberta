/**
 * Ganchos de ciclo de vida da reserva → correos 1 / 1b.
 */
import { formatDayChip, type Locale } from "@pista-aberta/shared";
import type { Booking } from "@pista-aberta/shared";
import { getFacility, getMunicipalityById } from "../../store/db.js";
import { getDb } from "../../db/client.js";
import * as t from "../../db/schema.js";
import { eq } from "drizzle-orm";
import {
  sendUserNotice,
  type UserNoticeOptions,
} from "../send-notice.js";
import { newId } from "../../lib/ids.js";
import { sportFromFacility } from "./booking-helpers.js";
import {
  antesDeIrLines,
  unitNameForBooking,
} from "./booking-content.js";

async function userLocale(userId: string): Promise<Locale> {
  const rows = await getDb()
    .select()
    .from(t.users)
    .where(eq(t.users.id, userId))
    .limit(1);
  return rows[0]?.locale === "es" ? "es" : "gl";
}

/** Avisos de ciclo de vida requiren titular; reservas anonimizadas non se notifican. */
function requireBookingUserId(booking: Booking): string | null {
  return booking.userId;
}

async function enrichBookingMail(booking: Booking, locale: Locale) {
  const muni = await getMunicipalityById(booking.municipalityId);
  const fac = await getFacility(booking.facilityId);
  const unitName = await unitNameForBooking(booking.facilityId, booking.unitId);
  const dayLabel = formatDayChip(booking.date, locale);
  const antesDeIr = muni ? antesDeIrLines(muni, locale, fac) : [];
  return {
    muni,
    fac,
    base: {
      sport: sportFromFacility(fac),
      facilityName: fac?.name ?? "Instalación",
      facilityId: booking.facilityId,
      facilityAddress: fac?.address,
      facilityLat: fac?.lat,
      facilityLng: fac?.lng,
      facilityPhone: fac?.contactPhone ?? undefined,
      facilityEmail: fac?.contactEmail ?? undefined,
      facilityPerson: fac?.contactPerson ?? undefined,
      parkingInfo: fac?.parkingInfo ?? undefined,
      entranceInfo: fac?.entranceInfo ?? undefined,
      unitName: unitName || undefined,
      dayLabel,
      timeLabel: `${booking.start}–${booking.end}`,
      date: booking.date,
      start: booking.start,
      end: booking.end,
      shortCode: booking.shortCode,
      qrPayload: booking.qrPayload,
      bookingId: booking.id,
      icsSequence: booking.icsSequence ?? 0,
      antesDeIr,
    },
  };
}

export async function notifyBookingCreated(booking: Booking): Promise<void> {
  const userId = requireBookingUserId(booking);
  if (!userId) return;
  const locale = await userLocale(userId);
  const { fac, base } = await enrichBookingMail(booking, locale);

  if (booking.status === "pending") {
    await sendUserNotice({
      id: newId("n-pend"),
      municipalityId: booking.municipalityId,
      userId,
      noticeType: "change",
      notifyType: "confirmacion",
      title: "Reserva pendente de aprobar",
      body: `${base.facilityName} · ${formatDayChip(booking.date, locale)} · ${booking.start}`,
      payload: {
        facilityName: base.facilityName,
        date: booking.date,
        start: booking.start,
        facilityId: booking.facilityId,
        shortCode: booking.shortCode,
      },
      email: { kind: "booking_pending", data: base },
    });
    return;
  }

  await sendUserNotice({
    id: newId("n-conf"),
    municipalityId: booking.municipalityId,
    userId,
    noticeType: "change",
    notifyType: "confirmacion",
    title: "Reserva confirmada",
    body: `${fac?.name ?? "Instalación"} · ${formatDayChip(booking.date, locale)} · ${booking.start} · ${booking.shortCode}`,
    payload: {
      facilityName: fac?.name ?? "Instalación",
      date: booking.date,
      start: booking.start,
      facilityId: booking.facilityId,
      shortCode: booking.shortCode,
    },
    email: { kind: "booking_confirmed", data: base },
  });
}

export async function bookingApprovedNotice(
  booking: Booking,
  localeHint?: Locale,
): Promise<UserNoticeOptions> {
  const userId = requireBookingUserId(booking);
  if (!userId) throw new Error("booking_anonymized");
  /*
   * localeHint evita userLocale→getDb() cando se constrúe o aviso dentro dunha
   * transacción (PGlite non admite consultas fóra do tx na mesma conexión).
   */
  const locale = localeHint ?? (await userLocale(userId));
  const { fac, base } = await enrichBookingMail(booking, locale);
  return {
    id: newId("n-appr"),
    municipalityId: booking.municipalityId,
    userId,
    noticeType: "change",
    notifyType: "confirmacion",
    title: "Reserva aprobada",
    body: `${fac?.name ?? "Instalación"} · ${formatDayChip(booking.date, locale)} · ${booking.start}`,
    payload: {
      facilityName: fac?.name ?? "Instalación",
      date: booking.date,
      start: booking.start,
      facilityId: booking.facilityId,
      shortCode: booking.shortCode,
    },
    email: {
      kind: "booking_approved",
      data: base,
    },
  };
}

export async function notifyBookingApproved(booking: Booking): Promise<void> {
  await sendUserNotice(await bookingApprovedNotice(booking));
}

export async function notifyBookingRejected(
  booking: Booking,
  reason?: string,
): Promise<void> {
  const userId = requireBookingUserId(booking);
  if (!userId) return;
  const fac = await getFacility(booking.facilityId);
  const locale = await userLocale(userId);
  await sendUserNotice({
    id: newId("n-rej"),
    municipalityId: booking.municipalityId,
    userId,
    noticeType: "change",
    notifyType: "confirmacion",
    title: "Reserva rexeitada",
    body: `${fac?.name ?? "Instalación"} · ${formatDayChip(booking.date, locale)} · ${booking.start}`,
    payload: {
      facilityName: fac?.name ?? "Instalación",
      date: booking.date,
      start: booking.start,
      facilityId: booking.facilityId,
    },
    email: {
      kind: "booking_rejected",
      data: {
        sport: sportFromFacility(fac),
        facilityName: fac?.name ?? "Instalación",
        dayLabel: formatDayChip(booking.date, locale),
        timeLabel: `${booking.start}–${booking.end}`,
        reason,
      },
    },
  });
}
