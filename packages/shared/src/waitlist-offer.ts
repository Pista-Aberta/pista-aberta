/** Contador en vivo da oferta de lista de espera (redeseno B6). */

export type OfferCountdown = {
  /** HH:MM na zona dada */
  untilLabel: string;
  /** Minutos restantes (enteiro ≥ 0) */
  minutesLeft: number;
  expired: boolean;
};

/**
 * Calcula a etiqueta «Apartada ata as HH:MM · quedan N min».
 * `offeredUntil` = ISO; `now` opcional para tests.
 */
export function offerCountdown(
  offeredUntil: string | Date | null | undefined,
  now: Date = new Date(),
  timeZone: string = "Europe/Madrid",
): OfferCountdown | null {
  if (!offeredUntil) return null;
  const until =
    typeof offeredUntil === "string" ? new Date(offeredUntil) : offeredUntil;
  if (Number.isNaN(until.getTime())) return null;

  const ms = until.getTime() - now.getTime();
  const minutesLeft = Math.max(0, Math.ceil(ms / 60_000));
  const expired = ms <= 0;

  let untilLabel = "";
  try {
    untilLabel = new Intl.DateTimeFormat("gl-ES", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(until);
  } catch {
    untilLabel = until.toISOString().slice(11, 16);
  }

  return { untilLabel, minutesLeft, expired };
}

/** Texto curto para UI: «Apartada ata as 18:57 · quedan 23 min». */
export function formatOfferCountdown(
  offeredUntil: string | Date | null | undefined,
  now: Date = new Date(),
  timeZone: string = "Europe/Madrid",
): string | null {
  const c = offerCountdown(offeredUntil, now, timeZone);
  if (!c) return null;
  if (c.expired) return null;
  return `Apartada ata as ${c.untilLabel} · quedan ${c.minutesLeft} min`;
}
