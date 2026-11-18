import type { Locale, Municipality } from "@pista-aberta/shared";
import {
  absolutePath,
  buildEmailContext,
  reserveSlotPath,
} from "./context.js";
import { dataCard, helpBox, primaryButton, secondaryLink } from "./blocks.js";
import { emailT } from "./i18n.js";
import { finalizeKind } from "./kind-result.js";
import type { RenderedEmail } from "./types.js";

export type WaitlistOfferData = {
  userName: string;
  sport: string;
  facilityName: string;
  facilityId: string;
  dayLabel: string;
  timeLabel: string;
  date: string;
  slotId: string;
  holdUntilLabel: string;
  /** Ligazón autenticada para «Xa non a quero». */
  declineUrl: string;
  unsubscribeUrl?: string;
};

export function renderWaitlistOffer(
  muni: Municipality,
  locale: Locale,
  data: WaitlistOfferData,
): RenderedEmail {
  const ctx = buildEmailContext({ muni, locale });
  const subject =
    locale === "es"
      ? `Quedó libre: ${data.sport}, ${data.dayLabel} a las ${data.timeLabel}`
      : `Quedou libre: ${data.sport}, ${data.dayLabel} ás ${data.timeLabel}`;
  const preheader =
    locale === "es"
      ? `La guardamos para ti hasta las ${data.holdUntilLabel}.`
      : `Gardámola para ti ata as ${data.holdUntilLabel}.`;
  const takeHref = absolutePath(
    ctx,
    reserveSlotPath(muni.slug, data.facilityId, data.date, data.slotId),
  );
  const declineHref = absolutePath(ctx, data.declineUrl);

  return finalizeKind(ctx, {
    subject,
    preheader,
    title: locale === "es" ? "Plaza liberada" : "Praza liberada",
    pill: "free",
    helloName: data.userName,
    bodyHtml:
      dataCard(ctx, [
        { label: emailT(locale, "card.facility"), value: data.facilityName },
        {
          label: emailT(locale, "card.when"),
          value: `${data.dayLabel} · ${data.timeLabel}`,
        },
      ]) +
      helpBox(preheader) +
      primaryButton(ctx, emailT(locale, "cta.takeOffer"), takeHref) +
      secondaryLink(emailT(locale, "cta.declineOffer"), declineHref),
    textParts: [preheader, takeHref, declineHref],
    footerKind: "A",
    notifyType: "praza_liberada",
    unsubscribeUrl: data.unsubscribeUrl,
  });
}
