import type { Locale, Municipality } from "@pista-aberta/shared";
import { buildEmailContext } from "./context.js";
import { codeBlock, helpBox } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type OtpData = {
  code: string;
};

export function renderOtp(
  muni: Municipality | null,
  locale: Locale,
  data: OtpData,
): RenderedEmail {
  /* REVISION-34 E8: marca do concello se hai municipalityId. */
  const ctx = buildEmailContext({
    muni,
    locale,
    headerMode: muni ? "reservas" : "platform",
  });
  const subject =
    locale === "es"
      ? `${data.code} es tu código para entrar`
      : `${data.code} é o teu código para entrar`;
  const preheader = emailT(locale, "otp.expires");
  const title =
    locale === "es" ? "Tu código de acceso" : "O teu código de acceso";

  return finalizeKind(ctx, {
    subject,
    preheader,
    title,
    pill: "code",
    bodyHtml: codeBlock(data.code) + helpBox(preheader),
    textParts: [`Código: ${data.code}`, preheader],
    footerKind: "T",
    notifyType: null,
  });
}
