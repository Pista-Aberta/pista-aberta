/**
 * Correos de partidos abertos (REVISION-40 M4/M10).
 * Texto de usuaria escapado vía bodyText/dataCard (`esc`).
 */
import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { bodyText, dataCard, helpBox, primaryButton } from "./blocks.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type OpenMatchMailData = {
  userName: string;
  matchTitle: string;
  dayLabel: string;
  timeLabel: string;
  facilityName?: string;
  reason?: string;
  matchPath: string;
  organizerName?: string;
  playerName?: string;
  previousLabel?: string;
  spotsLeft?: number;
  /** Convite a correo sen conta: «Ola!» sen o enderezo. */
  helloBare?: boolean;
  unsubscribeUrl?: string;
};

export function renderOpenMatchInvite(
  muni: Municipality,
  locale: Locale,
  data: OpenMatchMailData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "reservas" });
  const title =
    locale === "es" ? "Te invitaron a un partido abierto" : "Convidáronte a un partido aberto";
  const subject =
    locale === "es" ? `Convite: ${data.matchTitle}` : `Convite: ${data.matchTitle}`;
  const href = absolutePath(ctx, data.matchPath);
  const explain =
    locale === "es"
      ? [
          `${data.organizerName ?? "Alguien"} te invita a «${data.matchTitle}».`,
          "Si te apuntas, la plaza queda reservada en ese partido.",
        ]
      : [
          `${data.organizerName ?? "Alguén"} convidache a «${data.matchTitle}».`,
          "Se te apuntas, a praza queda reservada nese partido.",
        ];
  const rows = [
    {
      label: locale === "es" ? "Cuándo" : "Cando",
      value: `${data.dayLabel} · ${data.timeLabel}`,
    },
  ];
  if (data.facilityName) {
    rows.push({
      label: locale === "es" ? "Instalación" : "Instalación",
      value: data.facilityName,
    });
  }
  return finalizeKind(ctx, {
    subject,
    preheader: data.dayLabel,
    title,
    pill: "invite",
    helloName: data.helloBare ? undefined : data.userName,
    helloBare: data.helloBare,
    bodyHtml:
      bodyText(explain) +
      dataCard(ctx, rows) +
      primaryButton(ctx, locale === "es" ? "Ver partido" : "Ver partido", href) +
      helpBox(
        locale === "es"
          ? "Para apuntarte entra con tu certificado o Cl@ve."
          : "Para apuntarte entra co teu certificado ou Cl@ve.",
      ),
    textParts: [...explain, `${data.dayLabel} · ${data.timeLabel}`, href],
    footerKind: "T",
    notifyType: null,
    unsubscribeUrl: data.unsubscribeUrl,
  });
}

export function renderOpenMatchCancelled(
  muni: Municipality,
  locale: Locale,
  data: OpenMatchMailData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "reservas" });
  const title =
    locale === "es" ? "Partido abierto cancelado" : "Partido aberto cancelado";
  const reason =
    data.reason?.trim() ||
    (locale === "es" ? "Se canceló la reserva de la pista." : "Cancelouse a reserva da pista.");
  const subject =
    locale === "es" ? `Cancelado: ${data.matchTitle}` : `Cancelado: ${data.matchTitle}`;
  const href = absolutePath(ctx, data.matchPath);
  const explain =
    locale === "es"
      ? [`El partido «${data.matchTitle}» se canceló.`, reason]
      : [`O partido «${data.matchTitle}» cancelouse.`, reason];
  const rows = [
    {
      label: locale === "es" ? "Cuándo" : "Cando",
      value: `${data.dayLabel} · ${data.timeLabel}`,
    },
    { label: locale === "es" ? "Motivo" : "Motivo", value: reason },
  ];
  if (data.facilityName) {
    rows.push({
      label: locale === "es" ? "Instalación" : "Instalación",
      value: data.facilityName,
    });
  }
  return finalizeKind(ctx, {
    subject,
    preheader: reason,
    title,
    pill: "cancelled",
    helloName: data.userName,
    bodyHtml:
      bodyText(explain) +
      dataCard(ctx, rows) +
      primaryButton(ctx, locale === "es" ? "Ver reservas" : "Ver reservas", href),
    textParts: [...explain, `${data.dayLabel} · ${data.timeLabel}`, href],
    footerKind: "T",
    notifyType: "cancelacion",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}

export function renderOpenMatchMoved(
  muni: Municipality,
  locale: Locale,
  data: OpenMatchMailData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "reservas" });
  const title =
    locale === "es" ? "El partido cambió de hora" : "O partido cambiou de hora";
  const subject =
    locale === "es" ? `Cambio: ${data.matchTitle}` : `Cambio: ${data.matchTitle}`;
  const href = absolutePath(ctx, data.matchPath);
  const explain =
    locale === "es"
      ? [
          `El partido «${data.matchTitle}» se movió a ${data.dayLabel} · ${data.timeLabel}.`,
          data.previousLabel ? `Antes era ${data.previousLabel}.` : "",
        ].filter(Boolean)
      : [
          `O partido «${data.matchTitle}» moveuse a ${data.dayLabel} · ${data.timeLabel}.`,
          data.previousLabel ? `Antes era ${data.previousLabel}.` : "",
        ].filter(Boolean);
  return finalizeKind(ctx, {
    subject,
    preheader: `${data.dayLabel} · ${data.timeLabel}`,
    title,
    pill: "changed",
    helloName: data.userName,
    bodyHtml:
      bodyText(explain) +
      dataCard(ctx, [
        {
          label: locale === "es" ? "Nueva hora" : "Nova hora",
          value: `${data.dayLabel} · ${data.timeLabel}`,
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
      primaryButton(ctx, locale === "es" ? "Ver partido" : "Ver partido", href),
    textParts: [...explain, href],
    footerKind: "T",
    notifyType: "cambio",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}

export function renderOpenMatchJoined(
  muni: Municipality,
  locale: Locale,
  data: OpenMatchMailData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "reservas" });
  const player = data.playerName ?? "";
  const title =
    locale === "es" ? "Alguien se apuntó a tu partido" : "Alguén apuntouse ao teu partido";
  const subject =
    locale === "es"
      ? `${player} se apuntó a «${data.matchTitle}»`
      : `${player} apuntouse a «${data.matchTitle}»`;
  const href = absolutePath(ctx, data.matchPath);
  const explain =
    locale === "es"
      ? [
          `${player} se apuntó a «${data.matchTitle}» (${data.dayLabel} · ${data.timeLabel}).`,
        ]
      : [
          `${player} apuntouse a «${data.matchTitle}» (${data.dayLabel} · ${data.timeLabel}).`,
        ];
  return finalizeKind(ctx, {
    subject,
    preheader: player,
    title,
    pill: "confirmed",
    helloName: data.userName,
    bodyHtml:
      bodyText(explain) +
      primaryButton(ctx, locale === "es" ? "Ver partido" : "Ver partido", href),
    textParts: [...explain, href],
    footerKind: "A",
    notifyType: "cambio",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}

/** REVISION-41 O4: alguén saíu do partido (non «cambiou de hora»). */
export function renderOpenMatchLeft(
  muni: Municipality,
  locale: Locale,
  data: OpenMatchMailData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "reservas" });
  const player = data.playerName ?? "";
  const spots =
    typeof data.spotsLeft === "number" ? data.spotsLeft : undefined;
  const title =
    locale === "es" ? "Alguien salió de tu partido" : "Alguén saíu do teu partido";
  const subject =
    locale === "es"
      ? `${player} salió de «${data.matchTitle}»`
      : `${player} saíu de «${data.matchTitle}»`;
  const href = absolutePath(ctx, data.matchPath);
  const spotsPhrase =
    spots == null
      ? ""
      : spots === 1
        ? locale === "es"
          ? " Queda 1 plaza libre."
          : " Queda 1 praza libre."
        : locale === "es"
          ? ` Quedan ${spots} plazas libres.`
          : ` Quedan ${spots} prazas libres.`;
  const explain =
    locale === "es"
      ? [`${player} salió de «${data.matchTitle}».${spotsPhrase}`]
      : [`${player} saíu de «${data.matchTitle}».${spotsPhrase}`];
  return finalizeKind(ctx, {
    subject,
    preheader: player,
    title,
    pill: "changed",
    helloName: data.userName,
    bodyHtml:
      bodyText(explain) +
      primaryButton(ctx, locale === "es" ? "Ver partido" : "Ver partido", href),
    textParts: [...explain, href],
    footerKind: "A",
    notifyType: "cambio",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
