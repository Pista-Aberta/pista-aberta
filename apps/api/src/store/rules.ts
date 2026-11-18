/**
 * Normas de uso: regras numéricas + texto GL/ES.
 * Fonte única: settings do concello (e sobrescrita opcional por instalación).
 */
import { createHash } from "node:crypto";
import type {
  Facility,
  Municipality,
  RulesTextItem,
  UsageRules,
} from "@pista-aberta/shared";
import {
  DEFAULT_ANONYMIZE_AFTER_DAYS,
  DEFAULT_MAX_ACTIVE_BOOKINGS,
  QR_CHECKIN_MARGIN_MINUTES,
} from "./business-rules.js";

export const DEFAULT_USAGE_RULES: UsageRules = {
  bookingAntelationDays: 7,
  maxActiveBookings: DEFAULT_MAX_ACTIVE_BOOKINGS,
  maxHoursPerWeek: 4,
  cancelMinHours: 2,
  checkInMarginMinutes: QR_CHECKIN_MARGIN_MINUTES,
  noShowReleaseMinutes: 30,
  anonymizeAfterDays: DEFAULT_ANONYMIZE_AFTER_DAYS,
  /** 0 = penalización desactivada. */
  noShowPenaltyCount: 0,
  noShowPenaltyDays: 0,
  noShowPenaltyWindowDays: 30,
  whoCanBook: "ambas",
  approvalRequired: false,
  informativePrice: "",
};

/** REVISION-50 X1: sen norma de pádel aquí (vai na instalación de pádel). */
export const DEFAULT_RULES_TEXT: RulesTextItem[] = [
  {
    id: "rt-calzado",
    order: 0,
    gl: "Calzado axeitado para a superficie da pista.",
    es: "Calzado adecuado para la superficie de la pista.",
  },
  {
    id: "rt-respecto",
    order: 1,
    gl: "Respecta o tempo da franxa e deixa a pista limpa.",
    es: "Respeta el tiempo de la franja y deja la pista limpia.",
  },
];

export function rulesFromSettings(
  settings: Municipality["settings"],
): UsageRules {
  return {
    bookingAntelationDays:
      settings.bookingAntelationDays ?? DEFAULT_USAGE_RULES.bookingAntelationDays,
    maxActiveBookings:
      settings.maxActiveBookings ?? DEFAULT_USAGE_RULES.maxActiveBookings,
    maxHoursPerWeek:
      settings.maxHoursPerWeek ?? DEFAULT_USAGE_RULES.maxHoursPerWeek,
    cancelMinHours:
      settings.cancelMinHours ?? DEFAULT_USAGE_RULES.cancelMinHours,
    checkInMarginMinutes:
      settings.checkInMarginMinutes ?? DEFAULT_USAGE_RULES.checkInMarginMinutes,
    noShowReleaseMinutes:
      settings.noShowReleaseMinutes ?? DEFAULT_USAGE_RULES.noShowReleaseMinutes,
    anonymizeAfterDays:
      settings.anonymizeAfterDays ?? DEFAULT_USAGE_RULES.anonymizeAfterDays,
    noShowPenaltyCount:
      settings.noShowPenaltyCount ?? DEFAULT_USAGE_RULES.noShowPenaltyCount,
    noShowPenaltyDays:
      settings.noShowPenaltyDays ?? DEFAULT_USAGE_RULES.noShowPenaltyDays,
    noShowPenaltyWindowDays:
      settings.noShowPenaltyWindowDays ??
      DEFAULT_USAGE_RULES.noShowPenaltyWindowDays,
    whoCanBook: DEFAULT_USAGE_RULES.whoCanBook,
    approvalRequired: DEFAULT_USAGE_RULES.approvalRequired,
    informativePrice: DEFAULT_USAGE_RULES.informativePrice,
  };
}

export function resolveFacilityRules(
  muni: Municipality,
  facility?: Facility | null,
): UsageRules {
  const base = rulesFromSettings(muni.settings);
  const over = facility?.rulesOverride;
  const merged = over ? { ...base, ...over } : base;
  /* REVISION-35 G2: checkInRequired vive na instalación, non nas UsageRules herdadas. */
  return {
    ...merged,
    checkInRequired: facility?.checkInRequired ?? false,
  };
}

export function resolveRulesText(
  muni: Municipality,
  facility?: Facility | null,
): RulesTextItem[] {
  if (facility?.rulesText && facility.rulesText.length > 0) {
    return [...facility.rulesText].sort((a, b) => a.order - b.order);
  }
  const fromSettings = muni.settings.rulesText;
  if (fromSettings && fromSettings.length > 0) {
    return [...fromSettings].sort((a, b) => a.order - b.order);
  }
  return DEFAULT_RULES_TEXT;
}

export function computeRulesVersion(
  rules: UsageRules,
  text: RulesTextItem[],
): string {
  const payload = JSON.stringify({ rules, text });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function mergeNormasIntoSettings(
  current: Municipality["settings"],
  patch: {
    rules?: Partial<UsageRules>;
    rulesText?: RulesTextItem[];
  },
): Municipality["settings"] {
  const nextRules = {
    ...rulesFromSettings(current),
    ...(patch.rules ?? {}),
  };
  const nextText = patch.rulesText ?? current.rulesText ?? DEFAULT_RULES_TEXT;
  const version = computeRulesVersion(nextRules, nextText);
  return {
    ...current,
    maxHoursPerWeek: nextRules.maxHoursPerWeek,
    bookingAntelationDays: nextRules.bookingAntelationDays,
    maxActiveBookings: nextRules.maxActiveBookings,
    anonymizeAfterDays: nextRules.anonymizeAfterDays,
    cancelMinHours: nextRules.cancelMinHours,
    checkInMarginMinutes: nextRules.checkInMarginMinutes,
    noShowReleaseMinutes: nextRules.noShowReleaseMinutes,
    noShowPenaltyCount: nextRules.noShowPenaltyCount,
    noShowPenaltyDays: nextRules.noShowPenaltyDays,
    rulesText: nextText,
    rulesVersion: version,
  };
}
