import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { dataCard, helpBox, primaryButton } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type SeasonDecisionData = {
  userName: string;
  clubName: string;
  clubId: string;
  approved: boolean;
  reason?: string;
  /** Horarios da proposta (ex. «mércores 18:00–20:00»). */
  schedules?: string[];
  note?: string;
  unsubscribeUrl?: string;
};

export function renderSeasonDecision(
  muni: Municipality,
  locale: Locale,
  data: SeasonDecisionData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "clubs" });
  const subject = data.approved
    ? locale === "es"
      ? `${data.clubName}: aprobamos vuestra propuesta de temporada`
      : `${data.clubName}: aprobamos a vosa proposta de tempada`
    : locale === "es"
      ? `${data.clubName}: no aprobamos la propuesta de temporada`
      : `${data.clubName}: non aprobamos a proposta de tempada`;
  const body = data.approved
    ? locale === "es"
      ? "La propuesta de temporada quedó aprobada."
      : "A proposta de tempada quedou aprobada."
    : data.reason?.trim() ||
      (locale === "es"
        ? "La propuesta de temporada no fue aprobada."
        : "A proposta de tempada non foi aprobada.");
  const clubHref = absolutePath(ctx, `/c/${muni.slug}/clubs/${data.clubId}`);
  const rows: { label: string; value: string }[] = [
    {
      label: locale === "es" ? "Club" : "Club",
      value: data.clubName,
    },
  ];
  if (data.schedules && data.schedules.length) {
    rows.push({
      label: emailT(locale, "card.schedules"),
      value: data.schedules.join(" · "),
    });
  }
  if (data.note?.trim()) {
    rows.push({
      label: emailT(locale, "card.note"),
      value: data.note.trim(),
    });
  }
  if (!data.approved && data.reason?.trim()) {
    rows.push({
      label: emailT(locale, "card.reason"),
      value: data.reason.trim(),
    });
  }

  return finalizeKind(ctx, {
    subject,
    preheader: body.slice(0, 90),
    title: data.approved
      ? locale === "es"
        ? "Propuesta de temporada aprobada"
        : "Proposta de tempada aprobada"
      : locale === "es"
        ? "Propuesta de temporada no aprobada"
        : "Proposta de tempada non aprobada",
    pill: data.approved ? "season_ok" : "season_no",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, rows) +
      helpBox(body) +
      primaryButton(
        ctx,
        locale === "es" ? "Abrir panel del club" : "Abrir panel do club",
        clubHref,
      ),
    textParts: [
      body,
      ...(data.schedules ?? []),
      data.note ?? "",
      data.reason ?? "",
      clubHref,
    ],
    footerKind: "A",
    notifyType: "partido_club",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}

/** REVISION-38 J6 / REVISION-39 L10 — contraproposta do concello ao club. */
export type ClubCounterData = {
  userName: string;
  clubName: string;
  clubId: string;
  whenLabel: string;
  /** Horario que pediu o club (L10). */
  askedLabel?: string;
  unsubscribeUrl?: string;
};

export function renderClubCounter(
  muni: Municipality,
  locale: Locale,
  data: ClubCounterData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "clubs" });
  const subject =
    locale === "es"
      ? "El ayuntamiento propone otro horario"
      : "O concello propón outro horario";
  const help =
    locale === "es"
      ? "Entra en avisos para aceptar o rechazar."
      : "Entra nos avisos para aceptar ou rexeitar.";
  const noticesHref = absolutePath(ctx, `/c/${muni.slug}/avisos`);
  const cardRows: Array<{ label: string; value: string }> = [
    { label: "Club", value: data.clubName },
  ];
  if (data.askedLabel?.trim()) {
    cardRows.push({
      label: locale === "es" ? "Pediste" : "Pediches",
      value: data.askedLabel.trim(),
    });
  }
  cardRows.push({
    label: locale === "es" ? "El ayuntamiento propone" : "O concello propón",
    value: data.whenLabel,
  });
  return finalizeKind(ctx, {
    subject,
    preheader: `${data.whenLabel}. ${help}`.slice(0, 90),
    title: subject,
    pill: "changed",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, cardRows) +
      helpBox(help) +
      primaryButton(
        ctx,
        locale === "es" ? "Ver avisos" : "Ver avisos",
        noticesHref,
      ),
    textParts: [
      data.askedLabel ? `Pediches: ${data.askedLabel}` : "",
      `Propón: ${data.whenLabel}`,
      help,
      noticesHref,
    ].filter(Boolean),
    footerKind: "A",
    notifyType: "partido_club",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
