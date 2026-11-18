import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { dataCard, helpBox, primaryButton } from "./blocks.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type PauseLiftedData = {
  userName: string;
  /** Data na que comezou / rematou a pausa. */
  pausedFrom?: string;
  pausedUntil?: string;
};

export function renderPauseLifted(
  muni: Municipality,
  locale: Locale,
  data: PauseLiftedData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es" ? "Ya puedes volver a reservar" : "Xa podes volver reservar";
  const body =
    locale === "es"
      ? "El ayuntamiento retiró la pausa. Ya puedes reservar de nuevo."
      : "O concello retirou a pausa. Xa podes volver reservar.";
  const home = absolutePath(ctx, `/c/${muni.slug}/`);
  const rows: { label: string; value: string }[] = [];
  if (data.pausedFrom) {
    rows.push({
      label: locale === "es" ? "Pausa desde" : "Pausa desde",
      value: data.pausedFrom,
    });
  }
  if (data.pausedUntil) {
    rows.push({
      label: locale === "es" ? "Pausa hasta" : "Pausa ata",
      value: data.pausedUntil,
    });
  }

  return finalizeKind(ctx, {
    subject,
    preheader: subject,
    title: subject,
    pill: "pause_lifted",
    helloName: data.userName,
    bodyHtml:
      (rows.length ? dataCard(ctx, rows) : "") +
      helpBox(body) +
      primaryButton(
        ctx,
        locale === "es" ? "Reservar" : "Reservar",
        home,
      ),
    textParts: [
      body,
      data.pausedFrom ?? "",
      data.pausedUntil ?? "",
      home,
    ],
    footerKind: "T",
    notifyType: null,
  });
}
