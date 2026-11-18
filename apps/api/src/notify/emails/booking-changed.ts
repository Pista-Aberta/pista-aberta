import type { Locale, Municipality } from "@pista-aberta/shared";
import { buildBookingIcs } from "../../lib/booking-ics.js";
import {
  absolutePath,
  bookingPath,
  buildEmailContext,
} from "./context.js";
import {
  beforeAfter,
  dataCard,
  primaryButton,
  secondaryButton,
} from "./blocks.js";
import {
  bookingCalendarIcsUrl,
  bookingCardRows,
} from "./booking-content.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type BookingChangedData = {
  userName: string;
  facilityName: string;
  /** REVISION-39 L11 — mesmos datos ca confirmación. */
  unitName?: string;
  facilityAddress?: string;
  beforeLabel: string;
  afterDayLabel: string;
  afterTimeLabel: string;
  date: string;
  start: string;
  end: string;
  shortCode: string;
  bookingId: string;
  icsSequence: number;
  byStaff?: boolean;
  unsubscribeUrl?: string;
};

export function renderBookingChanged(
  muni: Municipality,
  locale: Locale,
  data: BookingChangedData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `Reserva cambiada · ahora ${data.afterDayLabel} a las ${data.afterTimeLabel}`
      : `Reserva cambiada · agora ${data.afterDayLabel} ás ${data.afterTimeLabel}`;
  const preheader =
    locale === "es"
      ? `El código sigue siendo ${data.shortCode}.`
      : `O código segue sendo ${data.shortCode}.`;
  const title =
    data.byStaff
      ? locale === "es"
        ? "El ayuntamiento cambió tu reserva"
        : "O concello cambiou a túa reserva"
      : locale === "es"
        ? "Cambiaste tu reserva"
        : "Cambiaches a túa reserva";
  const after = `${data.afterDayLabel} · ${data.afterTimeLabel}`;
  const ics = buildBookingIcs({
    id: data.bookingId,
    facilityName: data.facilityName,
    date: data.date,
    start: data.start,
    end: data.end,
    shortCode: data.shortCode,
    sequence: data.icsSequence,
  });
  const viewHref = absolutePath(ctx, bookingPath(muni.slug, data.bookingId));
  /* REVISION-38 K6: botón «Engadir ao calendario» (como na confirmación). */
  const calHref = bookingCalendarIcsUrl({
    slug: muni.slug,
    bookingId: data.bookingId,
  });

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "changed",
    helloName: data.userName,
    bodyHtml:
      beforeAfter(ctx, data.beforeLabel, after) +
      dataCard(ctx, [
        ...bookingCardRows(locale, {
          facilityName: data.facilityName,
          unitName: data.unitName,
          address: data.facilityAddress,
          date: data.date,
          start: data.start,
          end: data.end,
        }),
        { label: emailT(locale, "card.code"), value: data.shortCode },
      ]) +
      primaryButton(ctx, emailT(locale, "cta.viewBooking"), viewHref) +
      secondaryButton(emailT(locale, "cta.addToCalendar"), calHref, ctx),
    textParts: [
      preheader,
      `${data.beforeLabel} → ${after}`,
      data.unitName ? `Pista: ${data.unitName}` : "",
      data.facilityName,
      data.facilityAddress ?? "",
      `${data.date} · ${data.start}–${data.end}`,
      `Código ${data.shortCode}`,
      viewHref,
      calHref,
    ].filter(Boolean),
    footerKind: "A",
    notifyType: "cambio",
    unsubscribeUrl: data.unsubscribeUrl,
    attachments: [
      {
        filename: "reserva.ics",
        content: Buffer.from(ics, "utf8"),
        contentType: "text/calendar; method=PUBLISH",
        contentDisposition: "attachment",
      },
    ],
  });
}
