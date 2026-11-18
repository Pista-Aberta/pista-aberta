import type { Locale, Municipality } from "@pista-aberta/shared";
import {
  absolutePath,
  bookingPath,
  buildEmailContext,
  cancelBookingPath,
} from "./context.js";
import {
  antesDeIrBlock,
  dataCard,
  primaryButton,
  secondaryButton,
  secondaryLink,
} from "./blocks.js";
import {
  bookingCalendarIcsUrl,
  bookingCardRows,
  designBookingTitle,
  timeRangeLabel,
} from "./booking-content.js";
import { comoChegarMailBlock } from "./como-chegar-block.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type ReminderData = {
  userName: string;
  facilityName: string;
  facilityId?: string;
  facilityAddress?: string;
  facilityLat?: number;
  facilityLng?: number;
  parkingInfo?: string;
  entranceInfo?: string;
  unitName?: string;
  dayLabel: string;
  timeLabel: string;
  date?: string;
  start?: string;
  end?: string;
  bookingId: string;
  /** "24h" | "2h" */
  window: "24h" | "2h";
  antesDeIr?: string[];
  unsubscribeUrl?: string;
  /** TANDA-1 — aviso MeteoGalicia se outdoor + choiva. */
  meteoRain?: { period: "manha" | "tarde" | "noite"; chance: number } | null;
};

export function renderReminder(
  muni: Municipality,
  locale: Locale,
  data: ReminderData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const start = data.start ?? data.timeLabel;
  const end = data.end ?? data.timeLabel;
  const range = timeRangeLabel(start, end);
  const subject =
    data.window === "24h"
      ? locale === "es"
        ? `Mañana a las ${start} · ${data.facilityName}`
        : `Mañá ás ${start} · ${data.facilityName}`
      : locale === "es"
        ? `En 2 horas · ${data.facilityName}, ${start}`
        : `En 2 horas · ${data.facilityName}, ${start}`;
  const preheader = emailT(locale, "help.cancelHint");
  const title =
    data.date != null
      ? designBookingTitle(locale, data.date, start)
      : data.window === "24h"
        ? locale === "es"
          ? "Mañana tienes reserva"
          : "Mañá tes reserva"
        : locale === "es"
          ? "En 2 horas"
          : "En 2 horas";
  const viewHref = absolutePath(ctx, bookingPath(muni.slug, data.bookingId));
  const cancelHref = absolutePath(
    ctx,
    cancelBookingPath(muni.slug, data.bookingId),
  );
  const rows = bookingCardRows(locale, {
    facilityName: data.facilityName,
    unitName: data.unitName,
    address: data.facilityAddress,
    date: data.date ?? "",
    start,
    end,
  }).filter((r) => r.value);

  const calHref =
    data.date != null
      ? bookingCalendarIcsUrl({
          slug: muni.slug,
          bookingId: data.bookingId,
        })
      : viewHref;

  const meteoHtml =
    data.meteoRain != null
      ? `<p style="margin:12px 0;padding:10px 12px;border-radius:8px;background:#E6F2FA;color:#00527F;font-size:14px;">${emailT(
          locale,
          "meteo.rain",
          {
            chance: String(data.meteoRain.chance),
            period: emailT(
              locale,
              `meteo.period.${data.meteoRain.period}`,
            ),
          },
        )}</p>`
      : "";
  const meteoText =
    data.meteoRain != null
      ? emailT(locale, "meteo.rain", {
          chance: String(data.meteoRain.chance),
          period: emailT(locale, `meteo.period.${data.meteoRain.period}`),
        })
      : "";

  const how = comoChegarMailBlock(ctx, locale, {
    facilityName: data.facilityName,
    facilityLat: data.facilityLat,
    facilityLng: data.facilityLng,
    parkingInfo: data.parkingInfo,
    entranceInfo: data.entranceInfo,
  });

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "reminder",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, rows) +
      meteoHtml +
      primaryButton(ctx, emailT(locale, "cta.viewBooking"), viewHref) +
      (data.date
        ? secondaryButton(emailT(locale, "cta.addToCalendar"), calHref, ctx)
        : "") +
      how.html +
      secondaryLink(emailT(locale, "cta.cancel"), cancelHref) +
      antesDeIrBlock(locale === "es" ? "es" : "gl", data.antesDeIr ?? []),
    textParts: [
      data.unitName ? `Pista: ${data.unitName}` : "",
      data.facilityName,
      data.facilityAddress ?? "",
      data.date ? `${data.date} · ${range}` : `${data.dayLabel} · ${range}`,
      meteoText,
      ...how.textParts,
      ...(data.antesDeIr ?? []),
      viewHref,
      cancelHref,
    ],
    footerKind: "A",
    notifyType: "recordatorio",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
