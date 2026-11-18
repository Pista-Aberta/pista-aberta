import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { bodyText, dataCard, helpBox, primaryButton, stepsList } from "./blocks.js";
import { emailT, maskNif } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type InviteDeputacionData = {
  /** Admin dun concello novo vs xestora da Deputación. */
  variant: "muni_admin" | "deputacion_manager";
  acceptUrl: string;
  expiresLabel: string;
  nif?: string;
  /** Nome real da organización / concello (non o pseudo «Deputación (plataforma)»). */
  concelloName?: string;
  /** Nome da persoa (saúdo). */
  inviteeName?: string;
};

export function renderInviteDeputacion(
  muni: Municipality | null,
  locale: Locale,
  data: InviteDeputacionData,
): RenderedEmail {
  const displayName =
    data.concelloName ||
    (muni && !muni.settings.deputacionPlatform ? muni.name : null) ||
    (locale === "es" ? "Diputación" : "Deputación");
  /* Evitar remitente/cabeceira «Deputación (plataforma)». */
  const ctxMuni =
    muni && muni.settings.deputacionPlatform
      ? { ...muni, name: displayName }
      : muni;

  const ctx = buildEmailContext({
    muni: ctxMuni,
    locale,
    headerMode: data.variant === "deputacion_manager" ? "deputacion" : "panel",
  });

  const subject =
    data.variant === "muni_admin"
      ? locale === "es"
        ? `${displayName} ya tiene reservas en línea: eres la persona administradora`
        : `O ${displayName} xa ten reservas en liña: es a persoa administradora`
      : locale === "es"
        ? `Invitación a la gestión de ${displayName}`
        : `Convite á xestión da ${displayName}`;

  const preheader = emailT(locale, "invite.expires", {
    date: data.expiresLabel,
  });
  const acceptHref = absolutePath(ctx, data.acceptUrl);

  /* REVISION-37 I6 — deseño 13: título «Convidámoste á xestión…», non «Convite {nome}». */
  const title =
    data.variant === "muni_admin"
      ? locale === "es"
        ? "Eres administradora"
        : "Es administradora"
      : locale === "es"
        ? `Te invitamos a la gestión de ${displayName}`
        : `Convidámoste á xestión da ${displayName}`;

  const explain =
    data.variant === "muni_admin"
      ? locale === "es"
        ? [
            `El portal de ${displayName} está en preparación: te queda completar la puesta en marcha (horarios, personalización) y publicarlo.`,
            "Acepta la invitación con Cl@ve o certificado para entrar en el panel.",
          ]
        : [
            `O portal do ${displayName} está en preparación: quédache completar a posta en marcha (horarios, personalización) e publicalo.`,
            "Acepta o convite con Cl@ve ou certificado para entrar no panel.",
          ]
      : locale === "es"
        ? [
            `Te invitaron a gestionar los ayuntamientos adheridos en ${displayName}.`,
            "Desde el panel puedes dar de alta concellos, invitar administradoras y seguir el estado de cada uno.",
          ]
        : [
            `Convidáronte a xestionar os concellos adheridos na ${displayName}.`,
            "Desde o panel podes dar de alta concellos, convidar administradoras e seguir o estado de cada un.",
          ];

  const rows: { label: string; value: string }[] = [];
  if (data.nif) rows.push({ label: "NIF", value: maskNif(data.nif) });
  /* Caducidade unha soa vez (caixa de axuda), non na tarxeta. */

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "invite",
    helloName: data.inviteeName,
    bodyHtml:
      bodyText(explain) +
      (rows.length ? dataCard(ctx, rows) : "") +
      stepsList(
        locale === "es"
          ? [
              "Abre el enlace",
              "Identifícate con certificado o Cl@ve",
              "Completa la aceptación",
            ]
          : [
              "Abre a ligazón",
              "Identifícate con certificado ou Cl@ve",
              "Completa a aceptación",
            ],
      ) +
      helpBox(preheader) +
      primaryButton(ctx, emailT(locale, "cta.acceptInvite"), acceptHref),
    textParts: [...explain, preheader, acceptHref],
    footerKind: "P",
    notifyType: null,
  });
}
