/**
 * REVISION-34 E1–E2 / E9 — datos e títulos compartidos dos correos de reserva.
 * REVISION-35 G2 / G7 — Antes de ir filtrado; .ics propio.
 */
import {
  buildAntesDeIrRuleLines,
  formatDate,
  type Locale,
  type Municipality,
  type UsageRules,
} from "@pista-aberta/shared";
import type { Facility } from "@pista-aberta/shared";
import { resolveFacilityRules, resolveRulesText } from "../../store/rules.js";
import { listUnits } from "../../store/db.js";
import { signBookingIcsToken } from "../../lib/booking-ics-token.js";
import { appBaseUrl } from "./context.js";
import { emailT } from "./i18n.js";

export function timeRangeLabel(start: string, end: string): string {
  return `${start}–${end}`;
}

export function longDateLabel(date: string, locale: Locale): string {
  return formatDate(date, locale);
}

/** «mércores» / «miércoles» a partir de YYYY-MM-DD. */
export function weekdayLong(date: string, locale: Locale): string {
  const full = formatDate(date, locale);
  return full.split(/\s+/)[0] ?? full;
}

export function designBookingTitle(
  locale: Locale,
  date: string,
  start: string,
): string {
  const wd = weekdayLong(date, locale);
  return locale === "es"
    ? `Tienes pista el ${wd} a las ${start}`
    : `Tes pista o ${wd} ás ${start}`;
}

/** REVISION-35 G7 / REVISION-37 I1 — .ics propio; path sen `.ics` no param (Hono). */
export function bookingCalendarIcsUrl(opts: {
  slug: string;
  bookingId: string;
}): string {
  const t = signBookingIcsToken(opts.bookingId);
  return `${appBaseUrl()}/api/c/${opts.slug}/reservas/${encodeURIComponent(opts.bookingId)}/calendario.ics?t=${encodeURIComponent(t)}`;
}

export function usageRulesForEmail(
  muni: Municipality,
  facility?: Facility | null,
): UsageRules {
  return resolveFacilityRules(muni, facility ?? null);
}

/** REVISION-35 G2 — cancelación, check-in, penalización, prezo + normas instalación. */
export function antesDeIrLines(
  muni: Municipality,
  locale: Locale,
  facility?: Facility | null,
): string[] {
  const rules = usageRulesForEmail(muni, facility);
  const lines = buildAntesDeIrRuleLines(rules, locale).map((l) => l.text);
  const textItems = resolveRulesText(muni, facility ?? null);
  const first = textItems.slice(0, 3).map((r) => (locale === "es" ? r.es : r.gl));
  return [...lines, ...first.filter(Boolean)];
}

export async function unitNameForBooking(
  facilityId: string,
  unitId: string,
): Promise<string> {
  const units = await listUnits(facilityId);
  return units.find((u) => u.id === unitId)?.name ?? "";
}

export function bookingCardRows(
  locale: Locale,
  data: {
    facilityName: string;
    unitName?: string;
    address?: string;
    date: string;
    start: string;
    end: string;
  },
): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  if (data.unitName) {
    rows.push({
      label: emailT(locale, "card.court"),
      value: data.unitName,
    });
  }
  rows.push({
    label: emailT(locale, "card.facility"),
    value: data.facilityName,
  });
  if (data.address) {
    rows.push({
      label: emailT(locale, "card.address"),
      value: data.address,
    });
  }
  rows.push({
    label: emailT(locale, "card.when"),
    value: `${longDateLabel(data.date, locale)} · ${timeRangeLabel(data.start, data.end)}`,
  });
  return rows;
}
