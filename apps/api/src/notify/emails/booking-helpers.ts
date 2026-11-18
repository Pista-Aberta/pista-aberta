import { formatDayChip, formatDayTimeChip, type Locale } from "@pista-aberta/shared";
import type { Booking, Facility } from "@pista-aberta/shared";

export function bookingDayLabel(date: string, locale: Locale): string {
  return formatDayChip(date, locale);
}

export function bookingWhenLabel(
  date: string,
  start: string,
  locale: Locale,
): string {
  return formatDayTimeChip(date, start, locale);
}

export function sportFromFacility(fac: Facility | null | undefined): string {
  if (!fac) return "Deporte";
  return fac.name;
}

export function bookingEmailBase(
  booking: Booking,
  fac: Facility | null | undefined,
  locale: Locale = "gl",
) {
  return {
    sport: sportFromFacility(fac),
    facilityName: fac?.name ?? "Instalación",
    facilityId: booking.facilityId,
    dayLabel: bookingDayLabel(booking.date, locale),
    timeLabel: booking.start,
    date: booking.date,
    start: booking.start,
    end: booking.end,
    shortCode: booking.shortCode,
    qrPayload: booking.qrPayload,
    bookingId: booking.id,
    icsSequence: booking.icsSequence ?? 0,
  };
}
