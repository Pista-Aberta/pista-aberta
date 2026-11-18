import type { Locale, Municipality } from "@pista-aberta/shared";
import { buildBookingIcs } from "../../lib/booking-ics.js";
import { absolutePath, buildEmailContext } from "./context.js";
import { bodyText, dataCard, primaryButton } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type MatchMovedData = {
  userName: string;
  clubName: string;
  clubId: string;
  homeTeam: string;
  awayTeam: string;
  dayLabel: string;
  start: string;
  end: string;
  date: string;
  courtName: string;
  facilityName?: string;
  matchId: string;
  icsSequence?: number;
  unsubscribeUrl?: string;
  /** REVISION-50 X3 */
  beforeLabel?: string;
};

/** REVISION-49 Z1 — o concello moveu o partido: aviso + .ics aos clubs. */
export function renderMatchMoved(
  muni: Municipality,
  locale: Locale,
  data: MatchMovedData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "clubs" });
  const matchLabel = `${data.homeTeam} – ${data.awayTeam}`;
  const when = `${data.dayLabel} ás ${data.start}`;
  const bodyLine =
    locale === "es"
      ? `Vuestro partido ${matchLabel} pasa al ${data.dayLabel} a las ${data.start}, ${data.courtName}`
      : `O voso partido ${matchLabel} pasa ao ${data.dayLabel} ás ${data.start}, ${data.courtName}`;
  const subject =
    locale === "es"
      ? `${data.clubName}: partido movido · ${data.dayLabel} ${data.start}`
      : `${data.clubName}: partido movido · ${data.dayLabel} ${data.start}`;
  const preheader = data.beforeLabel
    ? `${bodyLine}. ${data.beforeLabel}`
    : bodyLine;
  const clubHref = absolutePath(ctx, `/c/${muni.slug}/clubs/${data.clubId}`);
  const ics = buildBookingIcs({
    id: data.matchId,
    facilityName: data.facilityName ?? data.courtName,
    date: data.date,
    start: data.start,
    end: data.end,
    sequence: data.icsSequence ?? 1,
    clubMatchTitle: matchLabel,
  });

  return finalizeKind(ctx, {
    subject,
    preheader,
    title: locale === "es" ? "Partido movido" : "Partido movido",
    pill: "changed",
    helloName: data.userName,
    bodyHtml:
      bodyText(data.beforeLabel ? [bodyLine, data.beforeLabel] : [bodyLine]) +
      dataCard(ctx, [
        {
          label: locale === "es" ? "Partido" : "Partido",
          value: matchLabel,
        },
        ...(data.beforeLabel
          ? [
              {
                label: locale === "es" ? "Antes" : "Antes",
                value: data.beforeLabel.replace(/^Antes:\s*/i, ""),
              },
            ]
          : []),
        {
          label: locale === "es" ? "Nueva hora" : "Nova hora",
          value: `${when}–${data.end}`,
        },
        {
          label: emailT(locale, "card.court"),
          value: data.courtName,
        },
        ...(data.facilityName
          ? [
              {
                label: locale === "es" ? "Instalación" : "Instalación",
                value: data.facilityName,
              },
            ]
          : []),
      ]) +
      primaryButton(
        ctx,
        locale === "es" ? "Abrir panel del club" : "Abrir panel do club",
        clubHref,
      ),
    textParts: data.beforeLabel
      ? [bodyLine, data.beforeLabel, clubHref]
      : [bodyLine, clubHref],
    footerKind: "A",
    notifyType: "partido_club",
    unsubscribeUrl: data.unsubscribeUrl,
    attachments: [
      {
        filename: "partido.ics",
        content: Buffer.from(ics, "utf8"),
        contentType: "text/calendar; method=PUBLISH",
        contentDisposition: "attachment",
      },
    ],
  });
}
