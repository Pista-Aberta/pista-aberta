import type { Locale, Municipality } from "@pista-aberta/shared";
import {
  absolutePath,
  bookingPath,
  buildEmailContext,
  cancelBookingPath,
} from "./context.js";
import { dataCard, helpBox, primaryButton, secondaryLink } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type BookingPendingData = {
  userName: string;
  sport: string;
  facilityName: string;
  dayLabel: string;
  timeLabel: string;
  bookingId: string;
  unsubscribeUrl?: string;
};

export function renderBookingPending(
  muni: Municipality,
  locale: Locale,
  data: BookingPendingData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `Reserva pendiente de aprobar · ${data.sport}, ${data.dayLabel} a las ${data.timeLabel}`
      : `Reserva pendente de aprobar · ${data.sport}, ${data.dayLabel} ás ${data.timeLabel}`;
  const preheader =
    locale === "es"
      ? "El ayuntamiento debe aprobar esta reserva."
      : "O concello debe aprobar esta reserva.";
  const title =
    locale === "es" ? "Reserva pendiente de aprobar" : "Reserva pendente de aprobar";
  const viewHref = absolutePath(ctx, bookingPath(muni.slug, data.bookingId));
  const cancelHref = absolutePath(
    ctx,
    cancelBookingPath(muni.slug, data.bookingId),
  );
  const body =
    locale === "es"
      ? "Recibirás otro correo cuando la revisen."
      : "Recibirás outro correo cando a revisen.";

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "pending",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, [
        { label: emailT(locale, "card.facility"), value: data.facilityName },
        {
          label: emailT(locale, "card.when"),
          value: `${data.dayLabel} · ${data.timeLabel}`,
        },
      ]) +
      helpBox(body) +
      primaryButton(ctx, emailT(locale, "cta.viewBooking"), viewHref) +
      secondaryLink(emailT(locale, "cta.cancel"), cancelHref),
    textParts: [body, viewHref],
    footerKind: "A",
    notifyType: "confirmacion",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
