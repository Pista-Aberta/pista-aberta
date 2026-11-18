import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { dataCard, helpBox, primaryButton } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type MatchCancelledItem = {
  dayLabel: string;
  timeLabel: string;
  rival?: string;
  courtName?: string;
  date?: string;
  start?: string;
  end?: string;
};

export type MatchCancelledData = {
  userName: string;
  clubName: string;
  clubId: string;
  /** Un partido (compat) ou lista (REVISION-34 E3: un correo por club). */
  dayLabel?: string;
  matches?: MatchCancelledItem[];
  reason?: string;
  unsubscribeUrl?: string;
};

export function renderMatchCancelled(
  muni: Municipality,
  locale: Locale,
  data: MatchCancelledData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "clubs" });
  const items: MatchCancelledItem[] =
    data.matches && data.matches.length > 0
      ? data.matches
      : [
          {
            dayLabel: data.dayLabel ?? "",
            timeLabel: "",
          },
        ];
  const first = items[0]!;
  const subject =
    items.length > 1
      ? locale === "es"
        ? `${data.clubName}: ${items.length} partidos cancelados por el cierre`
        : `${data.clubName}: ${items.length} partidos cancelados polo peche`
      : locale === "es"
        ? `${data.clubName}: el partido del ${first.dayLabel} se canceló por el cierre`
        : `${data.clubName}: o partido do ${first.dayLabel} cancelouse polo peche`;
  const reason =
    data.reason?.trim() ||
    (locale === "es"
      ? "Cierre de la instalación."
      : "Peche da instalación.");
  const preheader =
    locale === "es"
      ? "Podéis pedir otra fecha desde el panel del club."
      : "Podedes pedir outra data desde o panel do club.";
  const clubHref = absolutePath(ctx, `/c/${muni.slug}/clubs/${data.clubId}`);

  const cards = items
    .map((m) => {
      const rows: { label: string; value: string }[] = [
        {
          label: locale === "es" ? "Cuándo" : "Cando",
          value: [m.dayLabel, m.timeLabel].filter(Boolean).join(" · "),
        },
      ];
      if (m.rival) {
        rows.push({ label: emailT(locale, "card.rival"), value: m.rival });
      }
      if (m.courtName) {
        rows.push({ label: emailT(locale, "card.court"), value: m.courtName });
      }
      rows.push({ label: emailT(locale, "card.reason"), value: reason });
      return dataCard(ctx, rows);
    })
    .join("");

  return finalizeKind(ctx, {
    subject,
    preheader,
    title:
      items.length > 1
        ? locale === "es"
          ? "Partidos cancelados"
          : "Partidos cancelados"
        : locale === "es"
          ? "Partido cancelado"
          : "Partido cancelado",
    pill: "closure",
    helloName: data.userName,
    bodyHtml:
      cards +
      helpBox(preheader) +
      primaryButton(
        ctx,
        locale === "es" ? "Abrir panel del club" : "Abrir panel do club",
        clubHref,
      ),
    textParts: [
      reason,
      ...items.map(
        (m) =>
          `${m.dayLabel} ${m.timeLabel}${m.rival ? ` · ${m.rival}` : ""}${m.courtName ? ` · ${m.courtName}` : ""}`,
      ),
      clubHref,
    ],
    footerKind: "A",
    notifyType: "partido_club",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
