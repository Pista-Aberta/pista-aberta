import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { bodyText, dataCard, helpBox, primaryButton, stepsList } from "./blocks.js";
import { emailT, maskNif } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type InviteStaffData = {
  inviterName: string;
  roleLabel: string;
  acceptUrl: string;
  expiresLabel?: string;
  nif?: string;
  /** Nome da persoa convidada (saúdo). */
  inviteeName?: string;
  /**
   * REVISION-35 G4 — «Dar acceso» a persoa nova: xa ten acceso (sen caducidade).
   */
  accessGranted?: boolean;
};

export function renderInviteStaff(
  muni: Municipality,
  locale: Locale,
  data: InviteStaffData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale, headerMode: "panel" });
  const granted = !!data.accessGranted;
  const subject = granted
    ? locale === "es"
      ? `Tienes acceso a la ${data.roleLabel} de las reservas de ${muni.name}`
      : `Tes acceso á ${data.roleLabel} das reservas do ${muni.name}`
    : locale === "es"
      ? `${data.inviterName} te invitó a la ${data.roleLabel} de las reservas de ${muni.name}`
      : `${data.inviterName} convidoute á ${data.roleLabel} das reservas do ${muni.name}`;
  const preheader = granted
    ? locale === "es"
      ? `Entra con Cl@ve o certificado.`
      : `Entra con Cl@ve ou certificado.`
    : emailT(locale, "invite.expires", { date: data.expiresLabel ?? "" });
  const acceptHref = absolutePath(ctx, data.acceptUrl);
  const nifLine = data.nif
    ? emailT(locale, "nif.masked", {
        tail: maskNif(data.nif).replace(/^···/, ""),
      })
    : "";

  const title = granted
    ? locale === "es"
      ? `Tienes acceso a la ${data.roleLabel}`
      : `Tes acceso á ${data.roleLabel}`
    : locale === "es"
      ? `Invitación a la ${data.roleLabel}`
      : `Convite á ${data.roleLabel}`;

  const explain = granted
    ? locale === "es"
      ? [
          `${data.inviterName} te dio acceso a la ${data.roleLabel} de ${muni.name}.`,
          "Desde el panel puedes ver la hoja del día, hacer check-in y gestionar las reservas.",
        ]
      : [
          `${data.inviterName} deuche acceso á ${data.roleLabel} do ${muni.name}.`,
          "Desde o panel podes ver a folla do día, facer check-in e xestionar as reservas.",
        ]
    : locale === "es"
      ? [
          `${data.inviterName} te invitó a la ${data.roleLabel} de las reservas de ${muni.name}.`,
          "Acepta la invitación para entrar en el panel del ayuntamiento.",
        ]
      : [
          `${data.inviterName} convidoute á ${data.roleLabel} das reservas do ${muni.name}.`,
          "Acepta o convite para entrar no panel do concello.",
        ];

  const rows: { label: string; value: string }[] = [
    {
      label: locale === "es" ? "Rol" : "Papel",
      value: data.roleLabel,
    },
  ];
  if (nifLine) rows.push({ label: "NIF", value: maskNif(data.nif) });
  /* Caducidade unha soa vez (caixa de axuda), non na tarxeta. */

  const cta = granted
    ? locale === "es"
      ? "Entrar al panel"
      : "Entrar ao panel"
    : emailT(locale, "cta.acceptInvite");

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "invite",
    helloName: data.inviteeName,
    bodyHtml:
      bodyText(explain) +
      dataCard(ctx, rows) +
      (granted
        ? ""
        : stepsList(
            locale === "es"
              ? [
                  "Abre el enlace de la invitación",
                  "Identifícate con Cl@ve o certificado",
                  "Acepta el rol propuesto",
                ]
              : [
                  "Abre a ligazón do convite",
                  "Identifícate con Cl@ve ou certificado",
                  "Acepta o papel proposto",
                ],
          )) +
      (granted || !data.expiresLabel ? "" : helpBox(preheader)) +
      primaryButton(ctx, cta, acceptHref),
    textParts: [preheader, acceptHref, nifLine, ...explain],
    footerKind: "P",
    notifyType: null,
  });
}
