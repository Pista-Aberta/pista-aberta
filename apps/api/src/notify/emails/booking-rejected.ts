import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { dataCard, helpBox, primaryButton } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type BookingRejectedData = {
  userName: string;
  sport: string;
  facilityName: string;
  dayLabel: string;
  timeLabel: string;
  reason?: string;
  unsubscribeUrl?: string;
};

export function renderBookingRejected(
  muni: Municipality,
  locale: Locale,
  data: BookingRejectedData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `No pudimos aprobar tu reserva · ${data.sport}, ${data.dayLabel}`
      : `Non puidemos aprobar a túa reserva · ${data.sport}, ${data.dayLabel}`;
  const reason =
    data.reason?.trim() ||
    (locale === "es"
      ? "El ayuntamiento no pudo aprobar esta reserva."
      : "O concello non puido aprobar esta reserva.");
  const reserveHref = absolutePath(ctx, `/c/${muni.slug}/`);

  return finalizeKind(ctx, {
    subject,
    preheader: reason.slice(0, 90),
    title:
      locale === "es"
        ? "No pudimos aprobar tu reserva"
        : "Non puidemos aprobar a túa reserva",
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
        locale === "es" ? "Buscar otra hora" : "Buscar outra hora",
        reserveHref,
      ),
    textParts: [reason, reserveHref],
    footerKind: "A",
    notifyType: "confirmacion",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
