import type { Locale, Municipality } from "@pista-aberta/shared";
import { buildBookingCancelIcs } from "../../lib/booking-ics.js";
import {
  absolutePath,
  buildEmailContext,
  reserveSlotPath,
} from "./context.js";
import { dataCard, helpBox, hourChips, primaryButton } from "./blocks.js";
import { bookingCardRows, timeRangeLabel } from "./booking-content.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type FacilityClosureData = {
  userName: string;
  sport: string;
  facilityName: string;
  facilityId: string;
  facilityAddress?: string;
  unitName?: string;
  dayLabel: string;
  timeLabel: string;
  date: string;
  start: string;
  end: string;
  bookingId: string;
  icsSequence?: number;
  reason?: string;
  alternatives?: { label: string; sublabel?: string; date: string; slotId: string }[];
  unsubscribeUrl?: string;
};

export function renderFacilityClosure(
  muni: Municipality,
  locale: Locale,
  data: FacilityClosureData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const range = timeRangeLabel(data.start, data.end);
  const reason =
    data.reason?.trim() ||
    (locale === "es" ? "Cierre de la instalación." : "Peche da instalación.");
  const subject =
    locale === "es"
      ? `Cierre: el ${data.dayLabel} no hay ${data.sport} · tu reserva se canceló`
      : `Peche: o ${data.dayLabel} non hai ${data.sport} · a túa reserva cancelouse`;
  const preheader = reason.slice(0, 90);
  const ics = buildBookingCancelIcs({
    id: data.bookingId,
    facilityName: data.facilityName,
    date: data.date,
    start: data.start,
    end: data.end,
    sequence: (data.icsSequence ?? 0) + 1,
  });
  const alts = (data.alternatives ?? []).slice(0, 3);
  const hrefs = alts.map((a) =>
    absolutePath(
      ctx,
      reserveSlotPath(muni.slug, data.facilityId, a.date, a.slotId),
    ),
  );
  const home = absolutePath(ctx, `/c/${muni.slug}/reservar/${data.facilityId}`);
  const propose =
    locale === "es"
      ? "Te proponemos otras horas libres parecidas."
      : "Propómosche outras horas libres parecidas.";
  const rows = [
    ...bookingCardRows(locale, {
      facilityName: data.facilityName,
      unitName: data.unitName,
      address: data.facilityAddress,
      date: data.date,
      start: data.start,
      end: data.end,
    }),
    { label: emailT(locale, "card.reason"), value: reason },
  ];

  return finalizeKind(ctx, {
    subject,
    preheader,
    title: locale === "es" ? "Cierre de instalación" : "Peche da instalación",
    pill: "closure",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, rows) +
      helpBox(alts.length ? propose : reason) +
      (alts.length
        ? hourChips(
            alts.map((a) => a.label),
            hrefs,
            alts.map((a) => a.sublabel),
          )
        : "") +
      primaryButton(
        ctx,
        locale === "es" ? "Ver horas libres" : "Ver horas libres",
        home,
      ),
    textParts: [
      reason,
      data.facilityName,
      data.facilityAddress ?? "",
      `${data.date} · ${range}`,
      propose,
      ...hrefs,
      home,
    ],
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
