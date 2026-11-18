/**
 * Normas de uso xeradas a partir dos datos (non a man).
 * Usada na caixa «Normas de uso» e nos correos.
 * As liñas opcionais desaparecen se a regra está desactivada.
 */
import type { Locale, UsageRules } from "./index.js";

export type UsageRulesLineKind =
  | "antelation"
  | "maxActive"
  | "maxHours"
  | "cancel"
  | "checkin"
  | "noShowRelease"
  | "penalty"
  | "price"
  | "approval";

export type UsageRulesLine = {
  kind: UsageRulesLineKind;
  text: string;
};

type Copy = Record<
  UsageRulesLineKind,
  { gl: (r: UsageRules) => string; es: (r: UsageRules) => string }
>;

const COPY: Copy = {
  antelation: {
    gl: (r) =>
      `Podes reservar con ata ${r.bookingAntelationDays} ${r.bookingAntelationDays === 1 ? "día" : "días"} de antelación`,
    es: (r) =>
      `Puedes reservar con hasta ${r.bookingAntelationDays} ${r.bookingAntelationDays === 1 ? "día" : "días"} de antelación`,
  },
  maxActive: {
    gl: (r) =>
      `Podes ter ata ${r.maxActiveBookings} ${r.maxActiveBookings === 1 ? "reserva activa" : "reservas activas"}`,
    es: (r) =>
      `Puedes tener hasta ${r.maxActiveBookings} ${r.maxActiveBookings === 1 ? "reserva activa" : "reservas activas"}`,
  },
  maxHours: {
    gl: (r) =>
      `Máximo ${r.maxHoursPerWeek} ${r.maxHoursPerWeek === 1 ? "hora" : "horas"} por semana`,
    es: (r) =>
      `Máximo ${r.maxHoursPerWeek} ${r.maxHoursPerWeek === 1 ? "hora" : "horas"} por semana`,
  },
  cancel: {
    gl: (r) => `Cancela ata ${r.cancelMinHours} h antes`,
    es: (r) => `Cancela hasta ${r.cancelMinHours} h antes`,
  },
  checkin: {
    gl: (r) =>
      `Presenta o QR entre ${r.checkInMarginMinutes} min antes e o final da franxa`,
    es: (r) =>
      `Presenta el QR entre ${r.checkInMarginMinutes} min antes y el final de la franja`,
  },
  noShowRelease: {
    gl: (r) =>
      `Sen check-in, a pista libérase aos ${r.noShowReleaseMinutes} min`,
    es: (r) =>
      `Sin check-in, la pista se libera a los ${r.noShowReleaseMinutes} min`,
  },
  penalty: {
    gl: (r) =>
      `Con ${r.noShowPenaltyCount} ${r.noShowPenaltyCount === 1 ? "non presentado" : "non presentados"} en ${r.noShowPenaltyWindowDays} ${r.noShowPenaltyWindowDays === 1 ? "día" : "días"} non poderás reservar durante ${r.noShowPenaltyDays} ${r.noShowPenaltyDays === 1 ? "día" : "días"}`,
    es: (r) =>
      `Con ${r.noShowPenaltyCount} ${r.noShowPenaltyCount === 1 ? "no presentado" : "no presentados"} en ${r.noShowPenaltyWindowDays} ${r.noShowPenaltyWindowDays === 1 ? "día" : "días"} no podrás reservar durante ${r.noShowPenaltyDays} ${r.noShowPenaltyDays === 1 ? "día" : "días"}`,
  },
  price: {
    gl: (r) => `Prezo orientativo: ${r.informativePrice}`,
    es: (r) => `Precio orientativo: ${r.informativePrice}`,
  },
  approval: {
    gl: () => `Esta reserva require aprobación do concello`,
    es: () => `Esta reserva requiere aprobación del ayuntamiento`,
  },
};

function localePick(locale: Locale): "gl" | "es" {
  return locale === "es" ? "es" : "gl";
}

/**
 * Xera as liñas da caixa «Normas de uso».
 * Penalización / prezo / aprobación / liberación sen check-in
 * só aparecen se están activadas nos datos.
 */
export function buildUsageRulesLines(
  rules: UsageRules,
  locale: Locale = "gl",
): UsageRulesLine[] {
  const lang = localePick(locale);
  const out: UsageRulesLine[] = [];

  const push = (kind: UsageRulesLineKind) => {
    out.push({ kind, text: COPY[kind][lang](rules) });
  };

  push("antelation");
  push("maxActive");
  if (rules.maxHoursPerWeek > 0) push("maxHours");
  push("cancel");
  /* REVISION-35 G2: check-in / liberación só se a instalación o esixe. */
  if (rules.checkInRequired) {
    if (rules.checkInMarginMinutes > 0) push("checkin");
    if (rules.noShowReleaseMinutes > 0) push("noShowRelease");
  }
  if (
    (rules.noShowPenaltyCount ?? 0) > 0 &&
    (rules.noShowPenaltyDays ?? 0) > 0
  ) {
    push("penalty");
  }
  if ((rules.informativePrice ?? "").trim()) push("price");
  if (rules.approvalRequired) push("approval");

  return out;
}

/** Kinds do correo «Antes de ir» (sen antelación / cupos / horas). */
export const ANTES_DE_IR_KINDS: ReadonlySet<UsageRulesLineKind> = new Set([
  "cancel",
  "checkin",
  "noShowRelease",
  "penalty",
  "price",
]);

/** Liñas para o correo «Antes de ir» (REVISION-35 G2). */
export function buildAntesDeIrRuleLines(
  rules: UsageRules,
  locale: Locale = "gl",
): UsageRulesLine[] {
  return buildUsageRulesLines(rules, locale).filter((l) =>
    ANTES_DE_IR_KINDS.has(l.kind),
  );
}
