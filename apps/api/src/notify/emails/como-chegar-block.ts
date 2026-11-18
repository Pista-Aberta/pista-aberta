import {
  comoChegarHintLine,
  osmDirectionsUrl,
  type Locale,
} from "@pista-aberta/shared";
import { esc, secondaryButton } from "./blocks.js";
import { emailT } from "./i18n.js";
import type { EmailBlockContext } from "./types.js";

export type ComoChegarMailFields = {
  facilityName: string;
  facilityLat?: number;
  facilityLng?: number;
  parkingInfo?: string;
  entranceInfo?: string;
};

function hasCoords(lat?: number, lng?: number): boolean {
  return (
    lat != null &&
    lng != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
}

/** Botón secundario «Como chegar» + liña entrada/aparcamento se hai. */
export function comoChegarMailBlock(
  ctx: EmailBlockContext,
  locale: Locale,
  data: ComoChegarMailFields,
): { html: string; textParts: string[] } {
  const hint = comoChegarHintLine(
    {
      entranceInfo: data.entranceInfo,
      parkingInfo: data.parkingInfo,
    },
    locale === "es" ? "es" : "gl",
  );
  const textParts: string[] = [];
  let html = "";

  if (hasCoords(data.facilityLat, data.facilityLng)) {
    const href = osmDirectionsUrl(data.facilityLat!, data.facilityLng!);
    html += secondaryButton(emailT(locale, "cta.howToGet"), href, ctx);
    textParts.push(`${emailT(locale, "cta.howToGet")}: ${href}`);
  }

  if (hint) {
    html += `<p style="margin:0 0 14px 0;font:400 15px/1.45 Arial,Helvetica,sans-serif;color:#3B4A59">${esc(hint)}</p>`;
    textParts.push(hint);
  }

  return { html, textParts };
}
