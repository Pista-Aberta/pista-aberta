import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { helpBox, primaryButton } from "./blocks.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type NoShowWarningData = {
  userName: string;
  count: number;
  limit: number;
  windowDays: number;
  penaltyDays: number;
};

export function renderNoShowWarning(
  muni: Municipality,
  locale: Locale,
  data: NoShowWarningData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `Llevas ${data.count} reservas sin presentarte`
      : `Levas ${data.count} reservas sen presentarte`;
  const preheader =
    locale === "es"
      ? `A la ${data.limit}.ª en ${data.windowDays} días no podrás reservar durante ${data.penaltyDays} días.`
      : `Á ${data.limit}ª en ${data.windowDays} días non poderás reservar durante ${data.penaltyDays} días.`;
  const body =
    locale === "es"
      ? `Si llegas a ${data.limit} no presentados en ${data.windowDays} días, no podrás reservar durante ${data.penaltyDays} días.`
      : `Se chegas a ${data.limit} non presentados en ${data.windowDays} días, non poderás reservar durante ${data.penaltyDays} días.`;
  const home = absolutePath(ctx, `/c/${muni.slug}/conta`);

  return finalizeKind(ctx, {
    subject,
    preheader,
    title: subject,
    pill: "warning",
    helloName: data.userName,
    bodyHtml:
      helpBox(body) +
      primaryButton(
        ctx,
        locale === "es" ? "Ver mi cuenta" : "Ver a miña conta",
        home,
      ),
    textParts: [body, home],
    footerKind: "T",
    notifyType: null,
  });
}
