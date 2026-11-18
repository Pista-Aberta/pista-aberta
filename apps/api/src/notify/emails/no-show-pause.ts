import type { Locale, Municipality } from "@pista-aberta/shared";
import { absolutePath, buildEmailContext } from "./context.js";
import { dataCard, helpBox, primaryButton } from "./blocks.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type NoShowPauseData = {
  userName: string;
  untilLabel: string;
  /** Datas dos non presentados (REVISION-34 E3). */
  noShowDates?: string[];
  fromLabel?: string;
};

export function renderNoShowPause(
  muni: Municipality,
  locale: Locale,
  data: NoShowPauseData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `No puedes reservar hasta el ${data.untilLabel}`
      : `Non podes reservar ata o ${data.untilLabel}`;
  const body =
    locale === "es"
      ? `Por no presentarte a varias reservas, no puedes reservar hasta el ${data.untilLabel}.`
      : `Por non presentarte a varias reservas, non podes reservar ata o ${data.untilLabel}.`;
  const home = absolutePath(ctx, `/c/${muni.slug}/`);
  const rows: { label: string; value: string }[] = [
    {
      label: locale === "es" ? "Hasta" : "Ata",
      value: data.untilLabel,
    },
  ];
  if (data.fromLabel) {
    rows.unshift({
      label: locale === "es" ? "Desde" : "Desde",
      value: data.fromLabel,
    });
  }
  if (data.noShowDates?.length) {
    rows.push({
      label: locale === "es" ? "No presentados" : "Non presentados",
      value: data.noShowDates.join(" · "),
    });
  }

  return finalizeKind(ctx, {
    subject,
    preheader: subject,
    title: subject,
    pill: "pause",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, rows) +
      helpBox(body) +
      primaryButton(
        ctx,
        locale === "es" ? "Ir al portal" : "Ir ao portal",
        home,
      ),
    textParts: [
      body,
      data.fromLabel ?? "",
      data.untilLabel,
      ...(data.noShowDates ?? []),
      home,
    ],
    footerKind: "T",
    notifyType: null,
  });
}
