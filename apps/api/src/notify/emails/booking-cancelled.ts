import type { Locale, Municipality } from "@pista-aberta/shared";
import { buildBookingCancelIcs } from "../../lib/booking-ics.js";
import { absolutePath, buildEmailContext } from "./context.js";
import { dataCard, helpBox, primaryButton } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type BookingCancelledData = {
  userName: string;
  facilityName: string;
  dayLabel: string;
  timeLabel: string;
  date: string;
  start: string;
  end: string;
  bookingId: string;
  icsSequence?: number;
  reason?: string;
  byStaff?: boolean;
  unsubscribeUrl?: string;
};

export function renderBookingCancelled(
  muni: Municipality,
  locale: Locale,
  data: BookingCancelledData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `Reserva cancelada · ${data.dayLabel} a las ${data.timeLabel}`
      : `Reserva cancelada · ${data.dayLabel} ás ${data.timeLabel}`;
  const reason =
    data.reason?.trim() ||
    (data.byStaff
      ? locale === "es"
        ? "El ayuntamiento canceló la reserva."
        : "O concello cancelou a reserva."
      : locale === "es"
        ? "Cancelaste la reserva."
        : "Cancelaches a reserva.");
  const ics = buildBookingCancelIcs({
    id: data.bookingId,
    facilityName: data.facilityName,
    date: data.date,
    start: data.start,
    end: data.end,
    sequence: (data.icsSequence ?? 0) + 1,
  });
  const home = absolutePath(ctx, `/c/${muni.slug}/`);

  return finalizeKind(ctx, {
    subject,
    preheader: reason.slice(0, 90),
    title: locale === "es" ? "Reserva cancelada" : "Reserva cancelada",
    pill: "cancelled",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, [
        { label: emailT(locale, "card.facility"), value: data.facilityName },
        {
          label: emailT(locale, "card.when"),
          value: `${data.dayLabel} · ${data.timeLabel}`,
        },
      ]) +
      helpBox(reason) +
      primaryButton(
        ctx,
        locale === "es" ? "Reservar otra hora" : "Reservar outra hora",
        home,
      ),
    textParts: [reason, home],
    footerKind: "A",
    notifyType: "cancelacion",
    unsubscribeUrl: data.unsubscribeUrl,
    attachments: [
      {
        filename: "cancelacion.ics",
        content: Buffer.from(ics, "utf8"),
        contentType: "text/calendar; method=CANCEL",
        contentDisposition: "attachment",
      },
    ],
  });
}
